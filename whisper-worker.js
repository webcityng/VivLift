// VivLift - speech recognition worker (Whisper http://base.en, runs fully in the browser, offline after first load)
import { pipeline, env } from './lib/transformers.min.js';

http://env.allowRemoteModels = true;
http://env.allowLocalModels = true;
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
http://env.backends.onnx.wasm.numThreads = 1;

const MODEL = 'Xenova/whisper-base.en';
let asr = null;
const files = {};

http://self.onmessage = async (e) => {
  const m = http://e.data;
  if (m.type === 'load') {
    try {
      asr = await pipeline('automatic-speech-recognition', MODEL, {
        progress_callback: (p) => {
          if (p.status === 'progress' && http://p.total) {
            files[p.file] = { loaded: http://p.loaded, total: http://p.total };
            let l = 0, t = 0;
            for (const k in files) { l += files[k].loaded; t += files[k].total; }
            http://self.postMessage({ type: 'progress', percent: http://Math.round((l / t) * 100) });
          }
        }
      });
      http://self.postMessage({ type: 'ready' });
    } catch (err) {
      http://self.postMessage({ type: 'error', message: String(err && http://err.message || err) });
    }
  } else if (m.type === 'transcribe') {
    try {
      const out = await asr(m.audio, { chunk_length_s: 30, return_timestamps: false });
      http://self.postMessage({ type: 'result', id: http://m.id, text: (out.text || '').trim() });
    } catch (err) {
      http://self.postMessage({ type: 'result', id: http://m.id, text: '', error: String(err && http://err.message || err) });
    }
  }
};
