/* WebWorker: classical page analysis off the UI thread. */
import { analyze, mergeAnalyses } from './imaging.js';

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'analyzeBitmap') {
      const bitmap = msg.bitmap;
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const result = analyze(canvas);
      bitmap.close && bitmap.close();
      self.postMessage({ id: msg.id, ok: true, result });
      return;
    }
    if (msg.type === 'merge') {
      self.postMessage({ id: msg.id, ok: true, result: mergeAnalyses(msg.list || []) });
      return;
    }
    self.postMessage({ id: msg.id, ok: false, error: 'unknown_type' });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: err.message || String(err) });
  }
};
