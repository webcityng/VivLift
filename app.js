/* VivLift web - the friendly receptionist (PWA). Ears: Whisper in a worker. Mouth: the device's built-in voices. */
'use strict';

// ------------------------------------------------------------------ helpers
const $ = (s, root = document) => root.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

const SILENCE_SECONDS = 1.6, WAIT_FOR_SPEECH = 10, MAX_SECONDS = 25;
const SENSITIVITY = { low: 0.025, normal: 0.015, high: 0.008 };

const DEFAULTS = {
  school_name: '', say_as: '', class_system: 'nigeria', motto: '', logo_data: '', voice_mode: 'alternate',
  voice_female: '', voice_male: '', mic_sensitivity: 'normal', save_records: true, pronunciations: '',
  students_served: 0, pin_salt: '', pin_hash: '', rec_salt: '', rec_hash: '', fail_count: 0, lock_until: 0
};
let S = Object.assign({}, DEFAULTS);
try { Object.assign(S, JSON.parse(localStorage.getItem('vivlift_settings') || '{}')); } catch (e) { /* ignore */ }
const saveS = () => localStorage.setItem('vivlift_settings', JSON.stringify(S));
const configured = () => !!(S.school_name && S.pin_hash);

let running = false, cancelFlag = false, gender = 'female';
let state = 'idle', level = 0;
let modelState = 'loading', modelPercent = 0, modelError = '';
class Cancelled extends Error {}
const checkCancel = () => { if (cancelFlag) throw new Cancelled(); };

// -------------------------------------------------------------------- voices
let voices = [];
function loadVoices() { voices = (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => /^en/i.test(v.lang)); }
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

function voiceFor(g) {
  const chosen = g === 'female' ? S.voice_female : S.voice_male;
  const byName = voices.find((v) => v.name === chosen);
  if (byName) return byName;
  const rank = (v) => (/NG/i.test(v.lang) ? 0 : /GB/i.test(v.lang) ? 1 : 2);
  const list = voices.slice().sort((a, b) => rank(a) - rank(b));
  const fem = /female|zira|hazel|susan|serena|kate|samantha|victoria|karen|moira|tessa|fiona|libby|sonia|jenny|aria|emma|amy|martha/i;
  const mal = /\bmale\b|daniel|george|david|mark|alex|oliver|arthur|ryan|james|thomas|rishi|lee/i;
  const hit = list.find((v) => (g === 'female' ? fem : mal).test(v.name));
  return hit || (g === 'female' ? list[0] : list[1] || list[0]);
}

function speakOne(text, g) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const v = voiceFor(g);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
    u.rate = 0.95;
    let done = false;
    const end = () => { if (!done) { done = true; resolve(); } };
    u.onend = end; u.onerror = end;
    setTimeout(end, 3500 + text.length * 110);   // safety: some phones never fire onend
    speechSynthesis.speak(u);
  });
}

async function speak(text, g = gender) {
  const parts = text.match(/[^.!?]+[.!?]*/g) || [text];
  for (const p of parts) { if (cancelFlag) break; if (p.trim()) await speakOne(p.trim(), g); }
}

function spokenForm(text) {
  if (S.say_as && S.school_name) text = text.split(S.school_name).join(S.say_as);
  for (const line of (S.pronunciations || '').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) {
      const a = line.slice(0, i).trim(), b = line.slice(i + 1).trim();
      if (a && b) text = text.replace(new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), b);
    }
  }
  return text;
}

// ------------------------------------------------------------------- Whisper
let worker = null, rid = 0;
const pending = {};
function startWorker() {
  modelState = 'loading'; modelError = '';
  try {
    worker = new Worker('whisper-worker.js', { type: 'module' });
  } catch (e) { modelState = 'error'; modelError = 'This browser cannot run the speech engine. Please update it.'; return render(); }
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { modelPercent = m.percent; updateWelcomeStatus(); }
    else if (m.type === 'ready') { modelState = 'ready'; render(); if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); }
    else if (m.type === 'error') { modelState = 'error'; modelError = m.message; render(); }
    else if (m.type === 'result' && pending[m.id]) { pending[m.id](m.text); delete pending[m.id]; }
  };
  worker.onerror = () => { modelState = 'error'; modelError = 'The speech engine could not start.'; render(); };
  worker.postMessage({ type: 'load' });
}
function transcribe(audio) {
  return new Promise((resolve) => {
    const id = ++rid; pending[id] = resolve;
    worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  });
}

// --------------------------------------------------------------- microphone
let ctx = null, stream = null, node = null, capture = null, wakeLock = null;
const WORKLET = `class Cap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0;}
process(i){const c=i[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===this.b.length){this.port.postMessage(this.b.slice(0));this.n=0;}}}return true;}}
registerProcessor('vl-capture',Cap);`;

async function startMic() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume();
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
  const src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, 'vl-capture');
  node.port.onmessage = (e) => { if (capture) capture.onChunk(e.data); };
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
}
function stopMic() {
  capture = null;
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
  try { if (ctx) ctx.close(); } catch (e) { /* ignore */ }
  try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
  stream = ctx = node = wakeLock = null;
}

function resample(data, from, to) {
  if (from === to) return data;
  const ratio = from / to, n = Math.floor(data.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, data.length - 1), f = pos - i0;
    out[i] = data[i0] * (1 - f) + data[i1] * f;
  }
  return out;
}

let stopListening = null, typedHook = null;
function listen() {
  return new Promise((resolve) => {
    const frames = []; let spoke = false, quiet = 0, elapsed = 0, finished = false;
    const rate = ctx.sampleRate, threshold = SENSITIVITY[S.mic_sensitivity] || SENSITIVITY.normal;
    const finish = () => {
      if (finished) return; finished = true; capture = null; level = 0; stopListening = null;
      let total = 0; frames.forEach((f) => { total += f.length; });
      const all = new Float32Array(total); let o = 0; frames.forEach((f) => { all.set(f, o); o += f.length; });
      resolve({ audio: resample(all, rate, 16000), spoke });
    };
    capture = {
      onChunk(chunk) {
        frames.push(chunk);
        const dur = chunk.length / rate; elapsed += dur;
        let sum = 0; for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
        const rms = Math.sqrt(sum / chunk.length); level = rms;
        if (rms > threshold) { spoke = true; quiet = 0; }
        else if (spoke) { quiet += dur; if (quiet >= SILENCE_SECONDS) finish(); }
        else if (elapsed >= WAIT_FOR_SPEECH) finish();
        if (elapsed >= MAX_SECONDS) finish();
      }
    };
    stopListening = finish;
  });
}

async function hear() {
  checkCancel();
  setState('listening', 'Listening...');
  const typedPromise = new Promise((r) => { typedHook = r; });
  const res = await Promise.race([listen(), typedPromise]);
  typedHook = null;
  checkCancel();
  if (res && res.typed) { if (stopListening) stopListening(); return res.typed; }
  if (!res.spoke || res.audio.length < 16000 * 0.4) return '';
  setState('thinking', 'One moment...');
  let text = await transcribe(res.audio);
  text = text.replace(/\[.*?\]|\(.*?\)/g, '').trim();
  setHeard(text);
  return text;
}

async function waitTyped() {
  setState('typing', 'Please type your answer below and press Enter.');
  const el = $('#typed'); if (el) el.focus();
  const res = await new Promise((r) => { typedHook = r; });
  typedHook = null; checkCancel();
  return res.typed || '';
}

function useTyped() {
  const el = $('#typed'); if (!el) return;
  const v = el.value.trim();
  if (v && typedHook) { el.value = ''; typedHook({ typed: v }); }
}

function startOver() {
  if (running) {
    cancelFlag = true;
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (stopListening) stopListening();
    if (typedHook) typedHook({ cancel: true });
  } else render('welcome');
}

// ----------------------------------------------------------- conversation UI
function setState(st, status) {
  state = st;
  const o = $('#orb'); if (o) o.className = 'orb ' + st;
  const s = $('#status'); if (s) s.textContent = status || '';
}
const setCaption = (t) => { const c = $('#caption'); if (c) c.textContent = t; };
const setHeard = (t) => { const h = $('#heard'); if (h) h.textContent = t ? 'I heard: ' + t : ''; };
const setStage = (n, label) => { const s = $('#stage'); if (s) s.textContent = `Stage ${n} of 3 - ${label}`; };

(function loop() {   // live microphone level makes the green circle breathe while listening
  const o = $('#orb');
  if (o && state === 'listening') o.style.transform = 'scale(' + (1 + Math.min(level * 12, 0.9)).toFixed(2) + ')';
  else if (o) o.style.transform = '';
  requestAnimationFrame(loop);
})();

async function say(text, caption = true) {
  checkCancel();
  if (caption) { setCaption(text); setHeard(''); }
  setState('speaking', '');
  await speak(spokenForm(text));
  await sleep(250);
  checkCancel();
}

async function ask(question, validate, retry = "Sorry, I didn't quite catch that. Could you say it once more?", raw = (t) => t) {
  await say(question);
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await hear();
    const val = text ? validate(text) : null;
    if (val && (!Array.isArray(val) || val.length)) return val;
    if (attempt < 2) await say(retry);
  }
  await say('No problem. Please type your answer on the screen.');
  const typed = await waitTyped();
  const v = validate(typed);
  return v && (!Array.isArray(v) || v.length) ? v : raw(typed);
}

async function yesNo() {
  for (let i = 0; i < 2; i++) {
    const text = await hear();
    const r = text ? VL.yesNo(text) : null;
    if (r !== null) return r;
    if (i === 0) await say('Sorry, was that a yes or a no?');
  }
  return false;
}

async function conversation() {
  const school = S.school_name, d = { voice: gender };

  // Stage 1 - the Welcomer
  setStage(1, 'Welcome');
  await say(`Hello! Welcome to ${school}. It's lovely to have you here.`);
  await say("I'd like to get to know you a little better. I will ask you a few simple questions. All you need to do is speak naturally. Are you ready?");
  let ready = false;
  for (let i = 0; i < 4; i++) {
    const t = await hear(); const r = t ? VL.yesNo(t) : null;
    if (r === true) { ready = true; break; }
    if (r === false) await say('No problem, take your time. Just say yes when you are ready.');
    else await say("Sorry, I didn't quite catch that. Are you ready?");
  }
  if (!ready) { await say('That is alright. Please type yes on the screen when you are ready.'); await waitTyped(); }
  await say("Brilliant! Let's get started.");

  // Stage 2 - the Listener
  setStage(2, 'Getting to know you');
  let name = null;
  for (let attempt = 0; attempt < 2 && !name; attempt++) {
    const q = attempt === 0 ? 'First, could you tell me your full name, please?' : "Let's try that once more. Please tell me your full name.";
    const n = await ask(q, VL.parseName, undefined, (t) => t.replace(/\b\w/g, (c) => c.toUpperCase()));
    await say(`I heard ${n}. Is that right?`);
    if (await yesNo()) name = n;
  }
  if (!name) {
    await say("I'm sorry about that. Please type your full name on the screen.");
    const typed = await waitTyped();
    name = VL.parseName(typed) || typed;
  }
  d.name = name;
  await say(`Thank you, ${VL.firstName(name)}. That's a lovely name!`);

  d.class = await ask('Which class are you currently in?', (t) => VL.parseClass(t, S.class_system),
    `Sorry, I didn't catch your class. You can say it like ${VL.CLASS_EXAMPLES[S.class_system]}.`, (t) => t.trim().toUpperCase());
  await say(`${pickOne(['Wonderful', 'Lovely', 'Great'])}! ${VL.speakClass(d.class)}. Let's move on.`);

  d.colour = await ask("Now, just out of curiosity, what's your favourite colour?", VL.parseColour, undefined, (t) => t.trim().toLowerCase());
  const cap = d.colour.replace(/\b\w/g, (c) => c.toUpperCase());
  await say(`${cap}! ${pickOne(['Excellent choice.', 'Lovely choice.', 'Beautiful choice.'])}`);

  let subjects = await ask('Finally, which three subjects would you say are your strongest or favourite subjects at the moment?',
    VL.parseSubjects, undefined, (t) => [t.trim()]);
  if (subjects.length < 3) {
    await say(`I caught ${VL.joinList(subjects)}. Could you tell me all three subjects once more?`);
    const t = await hear(); const again = t ? VL.parseSubjects(t) : [];
    if (again.length > subjects.length) subjects = again;
  }
  d.subjects = subjects;
  await say('Very good! Thank you for sharing that with me.');

  // Stage 3 - the Presenter
  setStage(3, 'Introducing you');
  await say("Now that I've got to know you a little better, allow me to introduce you!");
  if (S.save_records) saveRecord(d);
  stopMic();
  render('card', d);
  const again = $('#again'); if (again) again.disabled = true;
  await speak(spokenForm(VL.introText(d, school)));
  const a2 = $('#again'); if (a2) a2.disabled = false;
}

async function begin() {
  if (running) return;
  if (!configured()) return openSettings(true);
  if (modelState !== 'ready') return;
  try { await startMic(); }
  catch (e) { return notice('Microphone', 'VivLift needs the microphone. Please allow microphone access and try again.'); }
  gender = S.voice_mode === 'female' || S.voice_mode === 'male' ? S.voice_mode : (S.students_served % 2 === 0 ? 'female' : 'male');
  S.students_served += 1; saveS();
  cancelFlag = false; running = true;
  render('conversation');
  try { await conversation(); }
  catch (e) {
    stopMic();
    if (e instanceof Cancelled) render('welcome');
    else { await notice('VivLift', 'Something went wrong: ' + (e && e.message ? e.message : e)); render('welcome'); }
  } finally { running = false; setState('idle', ''); }
}

// ------------------------------------------------------------------- records
const getRecords = () => { try { return JSON.parse(localStorage.getItem('vivlift_records') || '[]'); } catch (e) { return []; } };
function saveRecord(d) {
  const r = getRecords();
  r.push({ saved: new Date().toISOString().slice(0, 16).replace('T', ' '), school: S.school_name, name: d.name,
    class: d.class, colour: d.colour, subjects: d.subjects.join('; '), voice: d.voice });
  try { localStorage.setItem('vivlift_records', JSON.stringify(r)); } catch (e) { /* storage full */ }
}
function download(filename, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}
function exportCsv() {
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const rows = [['Saved', 'School', 'Full name', 'Class', 'Favourite colour', 'Best subjects', 'Voice used']]
    .concat(getRecords().map((r) => [r.saved, r.school, r.name, r.class, r.colour, r.subjects, r.voice]));
  download('vivlift-students.csv', '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv');
}

// -------------------------------------------------------------------- screens
function renderHeader() {
  $('#hdr').innerHTML = (S.logo_data ? `<img src="${S.logo_data}" alt="">` : '') +
    `<div class="school">${esc(S.school_name || 'VivLift')}</div><div class="brand" id="brand">VivLift</div>`;
  let taps = 0, timer = null;   // tap "VivLift" five times to open Settings
  $('#brand').onclick = () => { taps++; clearTimeout(timer); timer = setTimeout(() => { taps = 0; }, 3000); if (taps >= 5) { taps = 0; openSettings(); } };
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (!running) render('welcome'); });

function welcomeStatusText() {
  if (modelState === 'ready') return 'Ready. VivLift now works without internet.';
  if (modelState === 'error') return 'Speech engine problem: ' + modelError;
  return 'Getting ready (first time needs internet)... ' + (modelPercent ? modelPercent + '%' : '');
}
function updateWelcomeStatus() { const n = $('#wstatus'); if (n) n.textContent = welcomeStatusText(); }

function render(view, data) {
  view = view || (running ? 'conversation' : 'welcome');
  renderHeader();
  const app = $('#app');
  if (view === 'welcome') {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const label = !configured() ? 'Set up VivLift' : 'Begin';
    app.innerHTML = `<h1>Hello, and welcome!</h1>
      <p class="sub">I'm your VivLift receptionist${S.school_name ? ' at ' + esc(S.school_name) : ''}.<br>Press the button, and let's get to know each other.</p>
      <div class="center">
        <button class="btn big" id="begin" ${configured() && modelState !== 'ready' ? 'disabled' : ''}>${label}</button>
        <div class="note" id="wstatus">${esc(welcomeStatusText())}</div>
        ${modelState === 'error' ? '<button class="btn grey" id="retry">Try again</button>' : ''}
        ${deferredInstall ? '<button class="btn green" id="install">Install VivLift on this device</button>' : ''}
        ${isIos && !standalone ? '<div class="note">To install: tap Share, then "Add to Home Screen".</div>' : ''}
      </div>${S.motto ? `<div class="motto">"${esc(S.motto)}"</div>` : ''}`;
    $('#begin').onclick = begin;
    const r = $('#retry'); if (r) r.onclick = startWorker;
    const i = $('#install'); if (i) i.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render('welcome'); };
  } else if (view === 'conversation') {
    app.innerHTML = `<div class="stage" id="stage"></div><div class="orbwrap"><div class="orb" id="orb"></div></div>
      <div class="caption" id="caption"></div><div class="heard" id="heard"></div><div class="status" id="status"></div>
      <div class="typebar"><input id="typed" type="text" placeholder="Prefer to type? Type here" autocomplete="off">
        <button class="btn" id="useTyped">Use</button><button class="btn red" id="over">Start over</button></div>`;
    $('#typed').addEventListener('keydown', (e) => { if (e.key === 'Enter') useTyped(); });
    $('#useTyped').onclick = useTyped; $('#over').onclick = startOver;
  } else if (view === 'card') {
    const d = data, accent = VL.COLOURS[d.colour.toLowerCase()] || '#1D4ED8', school = S.school_name;
    app.innerHTML = `<div class="card" style="border-left-color:${accent}">
        <div class="kicker">GETTING TO KNOW OUR STUDENT</div><h2 style="color:${accent}">${esc(d.name.toUpperCase())}</h2>
        <div class="line">${esc(school)} | ${esc(d.class)}</div>
        <table><tr><th>Personal Profile</th><th>Information</th></tr>
          <tr><td>Full Name</td><td>${esc(d.name)}</td></tr><tr><td>Class</td><td>${esc(d.class)}</td></tr>
          <tr><td>Favourite Colour</td><td>${esc(d.colour.replace(/\b\w/g, (c) => c.toUpperCase()))}</td></tr>
          <tr><td>Best Subjects</td><td>${esc(VL.joinList(d.subjects))}</td></tr></table>
        <p class="intro">${esc(VL.introText(d, school, false))}</p><div class="foot">VivLift | ${esc(school)}</div></div>
      <div class="row"><button class="btn green" id="again">Hear it again</button><button class="btn" id="next">Next student</button></div>`;
    $('#again').onclick = async (e) => { e.target.disabled = true; cancelFlag = false; await speak(spokenForm(VL.introText(d, school))); e.target.disabled = false; };
    $('#next').onclick = () => { cancelFlag = true; if (window.speechSynthesis) speechSynthesis.cancel(); render('welcome'); };
  }
}

// -------------------------------------------------------------- modal helpers
function showModal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; return m; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
function notice(title, text) {
  return new Promise((resolve) => {
    showModal(`<h3>${esc(title)}</h3><p style="white-space:pre-line">${esc(text)}</p><div class="btns"><button class="btn" id="ok">OK</button></div>`);
    $('#ok').onclick = () => { closeModal(); resolve(); };
  });
}
function askText(title, text, password) {
  return new Promise((resolve) => {
    showModal(`<h3>${esc(title)}</h3><p style="white-space:pre-line">${esc(text)}</p>
      <input id="ans" type="${password ? 'password' : 'text'}" autocomplete="off"><div class="btns">
      <button class="btn" id="ok">OK</button><button class="btn grey" id="cancel">Cancel</button></div>`);
    const done = (v) => { closeModal(); resolve(v); };
    $('#ok').onclick = () => done($('#ans').value.trim());
    $('#cancel').onclick = () => done(null);
    $('#ans').addEventListener('keydown', (e) => { if (e.key === 'Enter') done($('#ans').value.trim()); });
    $('#ans').focus();
  });
}

// ------------------------------------------------------------------ PIN gate
const lockRemaining = () => Math.max(0, Math.ceil((S.lock_until - Date.now()) / 1000));
function failure() { S.fail_count++; if (S.fail_count >= 5) { S.fail_count = 0; S.lock_until = Date.now() + 300000; } saveS(); }
const success = () => { S.fail_count = 0; S.lock_until = 0; saveS(); };

async function pinGate() {
  const rem = lockRemaining();
  if (rem > 0) { await notice('Settings locked', `Too many wrong attempts. Try again in ${Math.ceil(rem / 60)} minute(s).`); return false; }
  const entry = await askText('VivLift Settings', 'Enter the Settings PIN\n(or your recovery code if the PIN is forgotten):', true);
  if (entry === null) return false;
  if (/^vl/i.test(entry)) {
    if (!(await VL.checkRecovery(S, entry))) { failure(); await notice('VivLift', 'That recovery code is not correct.'); return false; }
    for (let i = 0; i < 3; i++) {
      const p1 = await askText('New PIN', 'Choose a new PIN (4-6 digits):', true); if (p1 === null) return false;
      const p2 = await askText('New PIN', 'Repeat the new PIN:', true); if (p2 === null) return false;
      if (p1 === p2 && /^\d{4,6}$/.test(p1)) { await VL.setPin(S, p1); success(); await notice('VivLift', 'Your PIN has been reset.'); return true; }
      await notice('New PIN', 'The PINs must match and be 4 to 6 digits.');
    }
    return false;
  }
  if (await VL.checkPin(S, entry)) { success(); return true; }
  failure(); await notice('VivLift', 'That PIN is not correct.'); return false;
}

// ------------------------------------------------------------------ settings
async function openSettings(first) {
  if (running) return;
  if (!first && configured() && !(await pinGate())) return;
  const needPin = !S.pin_hash;
  const radio = (name, val, label, cur) => `<label><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}> ${label}</label>`;
  const voiceOpts = (cur) => '<option value="">(automatic)</option>' + voices.map((v) =>
    `<option value="${esc(v.name)}" ${v.name === cur ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  let logo = S.logo_data;
  showModal(`<h3>${first || !configured() ? 'Set up VivLift for your school' : 'Settings'}</h3>
    <label>School name *</label><input type="text" id="f_school" value="${esc(S.school_name)}">
    <label>How to say it (optional)</label><input type="text" id="f_say" value="${esc(S.say_as)}">
    <label>School motto (optional)</label><input type="text" id="f_motto" value="${esc(S.motto)}">
    <label>Class system</label><div class="opts">${radio('cls', 'nigeria', 'JSS / SS (SS2)', S.class_system)}${radio('cls', 'year', 'Year (Year 10)', S.class_system)}${radio('cls', 'grade', 'Grade (Grade 8)', S.class_system)}${radio('cls', 'custom', 'Any class name', S.class_system)}</div>
    <label>School logo (optional)</label><input type="file" id="f_logo" accept="image/*"><div class="hint" id="logo_hint">${logo ? 'Logo saved.' : 'No logo.'}</div>
    <label>Receptionist voice</label><div class="opts">${radio('vm', 'alternate', 'Alternate female / male', S.voice_mode)}${radio('vm', 'female', 'Always female', S.voice_mode)}${radio('vm', 'male', 'Always male', S.voice_mode)}</div>
    <label>Female voice on this device</label><select id="f_vf">${voiceOpts(S.voice_female)}</select>
    <label>Male voice on this device</label><select id="f_vm">${voiceOpts(S.voice_male)}</select>
    <div class="btns"><button class="btn grey" id="t_f">Test female</button><button class="btn grey" id="t_m">Test male</button></div>
    <div class="hint">Voices come from the phone itself. On Android, English (Nigeria) and English (UK) voices are the closest match; install more in the phone's text-to-speech settings.</div>
    <label>Microphone sensitivity</label><select id="f_mic"><option value="low">Low (noisy room)</option><option value="normal">Normal</option><option value="high">High (soft voices)</option></select>
    <label>Say-it-this-way list (one per line: Name=Respelling)</label><textarea id="f_pron" rows="3">${esc(S.pronunciations)}</textarea>
    <label><input type="checkbox" id="f_save" ${S.save_records ? 'checked' : ''}> Save each student's record on this device</label>
    <label>${needPin ? 'New PIN (4-6 digits) *' : 'New PIN (leave blank to keep)'}</label><input type="password" id="f_pin" inputmode="numeric" autocomplete="new-password">
    <label>Repeat PIN</label><input type="password" id="f_pin2" inputmode="numeric" autocomplete="new-password">
    <div class="btns"><button class="btn" id="s_save">Save</button><button class="btn grey" id="s_cancel">Cancel</button>
      <button class="btn grey" id="s_import">Import school pack</button>
      ${configured() ? '<button class="btn grey" id="s_export">Export school pack</button><button class="btn grey" id="s_csv">Export records (CSV)</button><button class="btn red" id="s_clear">Clear records</button>' : ''}</div>
    <input type="file" id="packfile" accept=".vlpack,application/json" hidden>`);
  $('#f_mic').value = S.mic_sensitivity;

  const testVoice = (g) => { S[g === 'female' ? 'voice_female' : 'voice_male'] = $(g === 'female' ? '#f_vf' : '#f_vm').value;
    const school = $('#f_say').value.trim() || $('#f_school').value.trim() || 'your school';
    speechSynthesis.cancel(); speakOne(`Hello! Welcome to ${school}. It's lovely to have you here.`, g); };
  $('#t_f').onclick = () => testVoice('female'); $('#t_m').onclick = () => testVoice('male');

  $('#f_logo').onchange = (e) => {   // shrink the logo so it fits comfortably in storage
    const f = e.target.files[0]; if (!f) return;
    const img = new Image(); img.onload = () => {
      const h = Math.min(96, img.height), w = Math.round(img.width * (h / img.height));
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      logo = c.toDataURL('image/png'); $('#logo_hint').textContent = 'Logo ready - press Save.';
    };
    img.src = URL.createObjectURL(f);
  };

  $('#s_cancel').onclick = closeModal;
  $('#s_save').onclick = async () => {
    const name = $('#f_school').value.trim(), pin = $('#f_pin').value.trim(), pin2 = $('#f_pin2').value.trim();
    if (!name) return alert('Please type the school name.');
    if (needPin && !pin) return alert('Please create a PIN (4 to 6 digits).');
    if (pin && !/^\d{4,6}$/.test(pin)) return alert('The PIN must be 4 to 6 digits.');
    if (pin && pin !== pin2) return alert('The two PINs do not match.');
    Object.assign(S, { school_name: name, say_as: $('#f_say').value.trim(), motto: $('#f_motto').value.trim(),
      class_system: ($('input[name=cls]:checked') || {}).value || 'nigeria', logo_data: logo,
      voice_mode: ($('input[name=vm]:checked') || {}).value || 'alternate', voice_female: $('#f_vf').value, voice_male: $('#f_vm').value,
      mic_sensitivity: $('#f_mic').value, save_records: $('#f_save').checked, pronunciations: $('#f_pron').value.trim() });
    let code = null;
    if (pin) { await VL.setPin(S, pin); code = await VL.newRecoveryCode(S); }
    saveS(); closeModal();
    if (code) await notice('Write down your recovery code', `Your recovery code is:\n\n${code}\n\nKeep it somewhere safe. If the PIN is forgotten, type this code instead of the PIN to set a new one.`);
    render('welcome');
  };

  $('#s_import').onclick = () => $('#packfile').click();
  $('#packfile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const pack = JSON.parse(await f.text());
      if (pack.format !== 'vivlift-school-pack' || !pack.school_name) throw new Error('This is not a valid VivLift school pack.');
      ['school_name', 'say_as', 'class_system', 'motto', 'voice_mode', 'save_records', 'pronunciations', 'pin_salt', 'pin_hash', 'rec_salt', 'rec_hash']
        .forEach((k) => { if (k in pack) S[k] = pack[k]; });
      if (pack.logo_b64) { const ext = (pack.logo_file || 'logo.png').split('.').pop().toLowerCase(); S.logo_data = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${pack.logo_b64}`; }
      saveS(); closeModal(); await notice('Imported', `School set to ${S.school_name}.`); render('welcome');
    } catch (err) { notice('Import failed', String(err.message || err)); }
  };
  const ex = $('#s_export'); if (ex) ex.onclick = () => {
    const pack = { format: 'vivlift-school-pack' };
    ['school_name', 'say_as', 'class_system', 'motto', 'voice_mode', 'save_records', 'pronunciations', 'pin_salt', 'pin_hash', 'rec_salt', 'rec_hash'].forEach((k) => { pack[k] = S[k]; });
    if (S.logo_data) { pack.logo_file = 'logo.png'; pack.logo_b64 = S.logo_data.split(',')[1]; }
    download('school.vlpack', JSON.stringify(pack, null, 2), 'application/json');
  };
  const csv = $('#s_csv'); if (csv) csv.onclick = exportCsv;
  const clr = $('#s_clear'); if (clr) clr.onclick = () => { if (confirm('Delete all saved student records on this device?')) { localStorage.removeItem('vivlift_records'); notice('Done', 'Records cleared.'); } };
}

window.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); openSettings(); } });

// ---------------------------------------------------------------------- start
async function boot() {
  render('welcome');
  if ('serviceWorker' in navigator) {   // let the offline cache take control BEFORE the speech model downloads, so it gets saved
    try {
      await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 3000); });
      }
    } catch (e) { /* needs https; the app still works online */ }
  }
  startWorker();
  if (!configured()) setTimeout(() => openSettings(true), 400);
}
boot();
