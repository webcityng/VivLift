// VivLift - speech recognition worker (Whisper base.en, runs fully in the browser, offline after first load)
import { pipeline, env } from './lib/transformers.min.js';

env.allowRemoteModels = false;               // never go to the internet: use files hosted with the app
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', self.location.href).href;
env.backends.onnx.wasm.wasmPaths = new URL('./lib/', self.location.href).href;
env.backends.onnx.wasm.numThreads = 1;       // multi-threading needs special server headers; 1 is safe everywhere

const MODEL = 'Xenova/whisper-base.en';
let asr = null;
const files = {};

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      asr = await pipeline('automatic-speech-recognition', MODEL, {
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            files[p.file] = { loaded: p.loaded, total: p.total };
            let l = 0, t = 0;
            for (const k in files) { l += files[k].loaded; t += files[k].total; }
            self.postMessage({ type: 'progress', percent: Math.round((l / t) * 100) });
          }
        }
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  } else if (m.type === 'transcribe') {
    try {
      const out = await asr(m.audio, { chunk_length_s: 30, return_timestamps: false });
      self.postMessage({ type: 'result', id: m.id, text: (out.text || '').trim() });
    } catch (err) {
      self.postMessage({ type: 'result', id: m.id, text: '', error: String(err && err.message || err) });
    }
  }
};
