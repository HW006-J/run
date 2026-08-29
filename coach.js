// Running form analysis. Pure, zero deps, runs unchanged in the browser and in node.
//
// Sample: { t, ax, ay, az, gx, gy, gz }
//   t        ms
//   a*       DeviceMotionEvent.acceleration          (gravity removed, m/s^2)
//   g*       DeviceMotionEvent.accelerationIncludingGravity

// ponytail: every threshold here is a guess until someone runs a lap. Tune on the
// track, not in a code review. These are the only numbers worth touching.
export const CONFIG = {
  windowSec: 6,
  minCadence: 130,      // autocorrelation search bounds, spm
  maxCadence: 210,
  lowCadence: 162,      // below this we coach
  bounceMax: 7.0,       // RMS vertical accel, m/s^2
  asymmetryMax: 0.15,   // 0..1, alternating step peak mismatch
  swayMax: 0.62,        // 0..1, head wobble across the direction of travel
  movingRms: 3.0,       // below this they are walking or standing
  cueGapSec: 20,        // never nag
  sustainSec: 8,        // fault must persist this long before we say anything
};

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const rms = a => Math.sqrt(mean(a.map(x => x * x)));

// Gravity direction from the low-frequency part of accelIncludingGravity.
// Over several strides the running acceleration averages out and what is left is g.
function gravityDir(s) {
  const v = [mean(s.map(p => p.gx)), mean(s.map(p => p.gy)), mean(s.map(p => p.gz))];
  const n = Math.hypot(...v);
  return n < 1e-6 ? [0, 0, 1] : v.map(x => x / n);
}

// Signed vertical acceleration. Orientation independent, so it does not matter
// whether the phone is in a hand, an armband or a pocket.
function verticalSeries(s) {
  const [ux, uy, uz] = gravityDir(s);
  const v = s.map(p => p.ax * ux + p.ay * uy + p.az * uz);
  const m = mean(v);
  return v.map(x => x - m);
}

// Cadence by autocorrelation of the vertical trace, with parabolic interpolation
// around the peak. Peak picking on raw accel is shorter but miscounts double
// impacts; autocorrelation does not.
function cadence(v, fs) {
  const lagLo = Math.max(2, Math.floor(fs * 60 / CONFIG.maxCadence));
  const lagHi = Math.min(v.length - 2, Math.ceil(fs * 60 / CONFIG.minCadence));
  if (lagHi <= lagLo) return null;

  const ac = lag => {
    let s = 0;
    for (let i = 0; i + lag < v.length; i++) s += v[i] * v[i + lag];
    return s / (v.length - lag);
  };

  let best = lagLo, bestVal = -Infinity;
  for (let lag = lagLo; lag <= lagHi; lag++) {
    const val = ac(lag);
    if (val > bestVal) { bestVal = val; best = lag; }
  }
  if (best <= lagLo || best >= lagHi) return 60 * fs / best;

  // sub-sample peak so we get ~1 spm resolution instead of ~9
  const [y0, y1, y2] = [ac(best - 1), bestVal, ac(best + 1)];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom === 0 ? 0 : 0.5 * (y0 - y2) / denom;
  return 60 * fs / (best + shift);
}

// Alternating footfalls should hit equally hard. They rarely do.
function asymmetry(v, fs, spm) {
  const period = fs * 60 / spm;
  const minGap = Math.max(2, Math.round(period * 0.6));
  const thresh = rms(v) * 0.8;

  const peaks = [];
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] > thresh && v[i] >= v[i - 1] && v[i] > v[i + 1]) {
      if (peaks.length && i - peaks[peaks.length - 1].i < minGap) {
        if (v[i] > peaks[peaks.length - 1].v) peaks[peaks.length - 1] = { i, v: v[i] };
      } else {
        peaks.push({ i, v: v[i] });
      }
    }
  }
  if (peaks.length < 6) return null;

  const odd = peaks.filter((_, k) => k % 2).map(p => p.v);
  const even = peaks.filter((_, k) => !(k % 2)).map(p => p.v);
  const [a, b] = [mean(odd), mean(even)];
  return Math.abs(a - b) / ((a + b) / 2);
}

// Head-only. How much of the horizontal movement is across the direction of travel
// rather than along it. A hand cannot tell you this, because the arm swing *is* the
// lateral motion. A head can: it should stay pointed where you are going.
//
// No compass needed. The principal axis of horizontal acceleration is fore-aft by
// definition when you are running forwards, so the ratio of the two eigenvalues of
// the 2x2 horizontal covariance is the wobble.
function sway(s) {
  const u = gravityDir(s);
  const t = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const unit = v => { const n = Math.hypot(...v); return n < 1e-9 ? v : v.map(x => x / n); };
  const e1 = unit(cross(t, u));
  const e2 = cross(u, e1);

  const p = s.map(x => x.ax*e1[0] + x.ay*e1[1] + x.az*e1[2]);
  const q = s.map(x => x.ax*e2[0] + x.ay*e2[1] + x.az*e2[2]);
  const mp = mean(p), mq = mean(q);

  let pp = 0, qq = 0, pq = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] - mp, b = q[i] - mq;
    pp += a*a; qq += b*b; pq += a*b;
  }
  pp /= p.length; qq /= p.length; pq /= p.length;

  const tr = pp + qq, det = pp*qq - pq*pq;
  const d = Math.sqrt(Math.max(0, tr*tr/4 - det));
  const [hi, lo] = [tr/2 + d, tr/2 - d];
  return hi <= 1e-9 ? null : Math.sqrt(Math.max(0, lo) / hi);
}

export function analyze(samples) {
  if (samples.length < 32) return { moving: false };

  const span = (samples[samples.length - 1].t - samples[0].t) / 1000;
  if (span <= 0) return { moving: false };
  const fs = (samples.length - 1) / span;

  const v = verticalSeries(samples);
  const level = rms(samples.map(p => Math.hypot(p.ax, p.ay, p.az)));
  if (level < CONFIG.movingRms) return { moving: false, fs, level };

  const spm = cadence(v, fs);
  return {
    moving: true,
    fs,
    level,
    cadence: spm,
    bounce: rms(v),
    asymmetry: spm ? asymmetry(v, fs, spm) : null,
    sway: sway(samples),
  };
}

// Which faults each sensor position can honestly report.
// Sway is head-only: from a hand, the arm swing is the lateral motion.
export const FAULTS = {
  hand: ['cadence', 'bounce', 'asymmetry'],
  ears: ['cadence', 'bounce', 'asymmetry', 'sway'],
};

// One fault at a time, only once it has persisted, never twice in a row.
export class Coach {
  constructor(cfg = CONFIG, enabled = FAULTS.ears) {
    this.cfg = cfg;
    this.enabled = enabled;
    this.since = {};      // fault -> seconds when we first saw it
    this.lastCueAt = -Infinity;
    this.lastFault = null;
  }

  faults(m) {
    if (!m.moving) return [];
    const f = [];
    if (m.cadence != null && m.cadence < this.cfg.lowCadence) f.push('cadence');
    if (m.bounce != null && m.bounce > this.cfg.bounceMax) f.push('bounce');
    if (m.asymmetry != null && m.asymmetry > this.cfg.asymmetryMax) f.push('asymmetry');
    if (m.sway != null && m.sway > this.cfg.swayMax) f.push('sway');
    return f.filter(k => this.enabled.includes(k));
  }

  // now: seconds. Returns { fault, text } or null.
  update(m, now) {
    const active = this.faults(m);
    for (const k of Object.keys(this.since)) if (!active.includes(k)) delete this.since[k];
    for (const k of active) if (!(k in this.since)) this.since[k] = now;

    if (now - this.lastCueAt < this.cfg.cueGapSec) return null;

    const ripe = active
      .filter(k => now - this.since[k] >= this.cfg.sustainSec)
      .sort((a, b) => (a === this.lastFault) - (b === this.lastFault));
    if (!ripe.length) return null;

    const fault = ripe[0];
    this.lastCueAt = now;
    this.lastFault = fault;
    delete this.since[fault];
    return { fault, text: CUES[fault] };
  }
}

// Fixed vocabulary. Small on purpose: it can be pre-rendered to audio once and
// played offline, which matters on a track with no signal.
export const CUES = {
  cadence: 'Quicker feet. Shorten your stride.',
  bounce: 'Too much bounce. Run softer, drive forward.',
  asymmetry: "You're favouring one side. Even it out.",
  sway: 'Your head is rocking. Eyes forward, run tall.',
};
