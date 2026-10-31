import { prepareRouting } from '../core/route.js';
import { routeBatch, slimBatch } from '../core/batch.js';

self.onmessage = event => {
  const { data, params, patients } = event.data;
  try {
    const model = prepareRouting(data, params);
    const batch = routeBatch(model, patients, {
      onProgress: (done, total) => self.postMessage({ type: 'progress', done, total })
    });
    self.postMessage({ type: 'result', batch: slimBatch(model, batch) });
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error && error.message ? error.message : error) });
  }
};
