// The AirPods stream.
//
// There is no web API for AirPods motion, so this buffer stays empty in a normal
// browser and the app runs on the phone's own sensor. The native shell in ios/ fills
// it by calling window.__head(sample) with the same shape the phone produces.
import { CONFIG } from './coach.js';

export const head = { samples: [], last: -Infinity, tap: null };

// Buds go quiet the moment they leave an ear, so treat silence as disconnected.
export const headLive = () => performance.now() - head.last < 2000;

window.__head = s => {
  head.last = performance.now();
  head.samples.push(s);
  const cutoff = s.t - CONFIG.windowSec * 1000;
  while (head.samples.length && head.samples[0].t < cutoff) head.samples.shift();
  head.tap?.(s);
};
