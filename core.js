/* VivLift web - core logic (no UI, no audio). Works in the browser and in Node for testing. */
(function (root) {
  const VL = {};

  VL.COLOURS = {
    "red": "#D62828", "blue": "#1D4ED8", "navy blue": "#1E3A8A", "sky blue": "#38BDF8",
    "light blue": "#60A5FA", "dark blue": "#1E3A8A", "green": "#16A34A", "light green": "#4ADE80",
    "dark green": "#166534", "yellow": "#EAB308", "orange": "#F97316", "purple": "#7E22CE",
    "violet": "#8B5CF6", "pink": "#EC4899", "black": "#111827", "white": "#9CA3AF",
    "gold": "#CA8A04", "silver": "#9CA3AF", "brown": "#92400E", "maroon": "#7F1D1D",
    "wine": "#7B1E3A", "cream": "#B8A472", "ash": "#9CA3AF", "grey": "#6B7280", "gray": "#6B7280",
    "teal": "#0D9488", "turquoise": "#14B8A6", "lemon": "#CA8A04", "peach": "#FB923C",
    "lilac": "#A78BFA", "indigo": "#4338CA", "magenta": "#C026D3", "cyan": "#0891B2"
  };

  const SUBJECT_ALIASES = {
    "maths": "Mathematics", "math": "Mathematics", "mathematics": "Mathematics",
    "further maths": "Further Mathematics", "further math": "Further Mathematics",
    "english": "English Language", "english language": "English Language",
    "lit": "Literature in English", "literature": "Literature in English",
    "literature in english": "Literature in English", "bio": "Biology", "chem": "Chemistry",
    "phy": "Physics", "civic": "Civic Education", "civic education": "Civic Education",
    "agric": "Agricultural Science", "agric science": "Agricultural Science",
    "agricultural science": "Agricultural Science", "econs": "Economics", "eco": "Economics",
    "govt": "Government", "computer": "Computer Studies", "computer science": "Computer Science",
    "ict": "ICT", "crs": "Christian Religious Studies", "irs": "Islamic Studies",
    "commerce": "Commerce", "accounting": "Financial Accounting", "account": "Financial Accounting",
    "geo": "Geography", "tech": "Technical Drawing"
  };

  VL.CLASS_EXAMPLES = { nigeria: "S S 2 or J S S 3", year: "Year 10", grade: "Grade 8", custom: "your class name" };

  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, first: 1, second: 2, third: 3 };

  // ---------------------------------------------------------------- parsing
  const clean = (t) => (t || "").trim().replace(/^[.,!?;:\s]+|[.,!?;:\s]+$/g, "").replace(/\s+/g, " ");
  VL.clean = clean;

  VL.parseName = function (text) {
    let t = clean(text);
    t = t.replace(/^(hello|hi|hey|good (morning|afternoon|evening))[, ]*/i, "");
    t = t.replace(/^(my (full )?name is|my name's|i am called|i am|i'm|it is|it's|this is|call me|they call me)\s+/i, "");
    t = clean(t.replace(/[^A-Za-z'\- ]/g, " "));
    const fillers = new Set(["mm", "mmm", "hmm", "hm", "um", "umm", "uh", "er", "erm", "ah", "oh", "yes", "no",
      "okay", "ok", "yeah", "sorry", "what", "huh"]);
    const words = t.toLowerCase().split(" ").filter(Boolean);
    if (!t || words.length > 6 || words.every((w) => fillers.has(w) || w.length < 2)) return null;
    return t.replace(/[A-Za-z]+/g, (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase());
  };

  VL.firstName = (full) => (full || "").split(" ")[0] || "";

  VL.parseClass = function (text, system) {
    system = system || "nigeria";
    let t = (text || "").toLowerCase().replace(/\./g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
    const num = (x) => WORD_NUM[x] || (/^\d+$/.test(x) ? parseInt(x, 10) : 0);
    if (system === "nigeria") {
      const m = t.match(/\b(j\s?s\s?s?|junior secondary(?: school)?|s\s?s\s?s?|senior secondary(?: school)?)\s?(one|two|three|first|second|third|[1-3])\b/);
      return m ? (m[1].startsWith("j") ? "JSS" : "SS") + num(m[2]) : null;
    }
    if (system === "year" || system === "grade") {
      const m = t.match(new RegExp("\\b(?:year|yr|grade)\\s?(\\d{1,2}|" + Object.keys(WORD_NUM).join("|") + ")\\b"));
      if (m && num(m[1]) > 0 && num(m[1]) <= 13) return system.charAt(0).toUpperCase() + system.slice(1) + " " + num(m[1]);
      return null;
    }
    t = t.replace(/^(i am in|i'm in|i am a|i'm a|am in|my class is|class)\s+/, "");
    return t ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  };

  VL.speakClass = function (cls) {
    const m = /^([A-Z]{2,3})(\d)$/.exec(cls || "");
    return m ? m[1].split("").join(" ") + " " + m[2] : cls;
  };

  VL.parseColour = function (text) {
    let t = clean(text).toLowerCase();
    const names = Object.keys(VL.COLOURS).sort((a, b) => b.length - a.length);
    for (const n of names) if (new RegExp("\\b" + n + "\\b").test(t)) return n;
    t = t.replace(/^(my )?(favou?rite )?colou?r (is|would be)\s+/, "").replace(/^(i like|i love|it is|it's)\s+/, "");
    t = t.replace(/[^a-z ]/g, "").trim();
    return t && t.split(" ").length <= 3 ? t : null;
  };

  const niceTitle = (s) =>
    s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(In|Of|And)\b/g, (m) => m.toLowerCase());

  VL.parseSubjects = function (text) {
    let t = clean(text).toLowerCase();
    t = t.replace(/^(my )?(current )?(best |top |strongest )?(three |3 )?(favou?rite )?subjects? (are|is)\s*/, "");
    t = t.replace(/^(they are|they're|i like|i love|my best are|it is|it's)\s+/, "");
    const out = [];
    for (let p of t.split(/,|\band\b|\bthen\b|\balso\b|\bplus\b|&/)) {
      p = p.replace(/[^a-z ]/g, "").trim().replace(/^(the|my)\s+/, "");
      if (!p) continue;
      const words = p.split(" ");
      const pieces = words.length > 1 && !(p in SUBJECT_ALIASES) && words.every((w) => w in SUBJECT_ALIASES) ? words : [p];
      for (const piece of pieces) {
        const name = SUBJECT_ALIASES[piece] || niceTitle(piece);
        if (!out.includes(name)) out.push(name);
      }
    }
    return out.slice(0, 3);
  };

  VL.yesNo = function (text) {
    const lower = (text || "").toLowerCase();
    const words = new Set(lower.match(/[a-z']+/g) || []);
    const any = (list) => list.some((w) => words.has(w));
    if (lower.includes("no problem")) return true;
    if (any(["no", "nope", "nah", "not", "wrong", "incorrect", "wait", "negative"])) return false;
    if (any(["yes", "yeah", "yep", "yup", "sure", "okay", "ok", "ready", "correct", "right", "absolutely",
      "definitely", "alright", "please", "certainly"])) return true;
    return null;
  };

  // ---------------------------------------------------------------- wording
  VL.joinList = (items) =>
    items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];

  VL.introText = function (d, school, spoken) {
    if (spoken === undefined) spoken = true;
    const first = VL.firstName(d.name), poss = first + "'s";
    const cls = spoken ? VL.speakClass(d.class) : d.class;
    const n = d.subjects.length;
    const phrase = n === 1 ? "strongest subject is" : n === 2 ? "two strongest subjects are" : "three strongest subjects are";
    return `Everyone, meet ${d.name}! ${first} is a student of ${school}, currently in ${cls}. ` +
      `${poss} favourite colour is ${d.colour}, and ${poss} ${phrase} ${VL.joinList(d.subjects)}. ` +
      `${first}, it's wonderful getting to know you. We wish you an exciting and rewarding experience at ${school}!`;
  };

  // ---------------------------------------------- PIN security (same scheme as the Windows app)
  const hexToBytes = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
  const bytesToHex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  VL.randomHex = (n) => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(n)));

  VL.hash = async function (secret, saltHex) {
    const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
    const bits = await globalThis.crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: 200000 }, key, 256);
    return bytesToHex(new Uint8Array(bits));
  };

  VL.setPin = async (s, pin) => { s.pin_salt = VL.randomHex(16); s.pin_hash = await VL.hash(pin, s.pin_salt); };
  VL.checkPin = async (s, pin) => !!s.pin_hash && (await VL.hash(pin, s.pin_salt)) === s.pin_hash;
  const normCode = (c) => (c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  VL.newRecoveryCode = async function (s) {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const pick = (n) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (x) => alphabet[x % alphabet.length]).join("");
    const code = `VL-${pick(4)}-${pick(4)}`;
    s.rec_salt = VL.randomHex(16);
    s.rec_hash = await VL.hash(normCode(code), s.rec_salt);
    return code;
  };
  VL.checkRecovery = async (s, code) => !!s.rec_hash && (await VL.hash(normCode(code), s.rec_salt)) === s.rec_hash;

  if (typeof module !== "undefined" && module.exports) module.exports = VL; else root.VL = VL;
})(typeof self !== "undefined" ? self : globalThis);
