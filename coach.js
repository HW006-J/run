// Running form analysis. Pure, zero deps, runs unchanged in the browser and in node.
//
// Sample: { t, ax, ay, az, gx, gy, gz }
//   t        ms
//   a*       gravity-removed acceleration, m/s^2
//   g*       acceleration including gravity, m/s^2

// ponytail: every threshold here is a guess until someone runs a lap. Tune on the
// track, not in a code review. These are the only numbers worth touching.
export const CONFIG = {
  windowSec: 6,
  minCadence: 130,        // autocorrelation search bounds, spm
  maxCadence: 210,
  lowCadence: 162,        // below this we coach
  targetLo: 170,
  targetHi: 180,
  bounceMax: 7.0,         // RMS vertical accel, m/s^2
  impactMax: 3.0,         // peak vertical accel, g
  asymmetryMax: 0.15,     // 0..1, alternating step peak mismatch
  swayMax: 0.62,          // 0..1, head wobble across the direction of travel
  movingRms: 3.0,         // below this they are walking or standing
  cueGapSec: 20,          // never nag
  sustainSec: 8,          // fault must persist this long before we speak
};

export const G = 9.81;

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const rms = a => Math.sqrt(mean(a.map(x => x * x)));
const proj = (s, u) => s.ax * u[0] + s.ay * u[1] + s.az * u[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = v => { const n = Math.hypot(...v); return n < 1e-9 ? v : v.map(x => x / n); };

// Gravity direction from the low-frequency part of accelIncludingGravity.
// Over several strides the running acceleration averages out and what is left is g.
function gravityDir(s) {
  const v = [mean(s.map(p => p.gx)), mean(s.map(p => p.gy)), mean(s.map(p => p.gz))];
  return Math.hypot(...v) < 1e-6 ? [0, 0, 1] : unit(v);
}

// An orthonormal frame built from the data alone, with no compass and no assumption
// about how the sensor is held.
//
//   up    gravity
//   fore  the principal axis of horizontal acceleration, which is the direction of
//         travel by definition when you are running forwards
//   lat   the axis across it
//
// The ratio of the two horizontal eigenvalues is the wobble: 0 means everything you
// do is along the direction of travel, 1 means you are moving equally side to side.
function frame(s) {
  const up = gravityDir(s);
  const seed = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(seed, up));
  const e2 = cross(up, e1);

  const p = s.map(x => proj(x, e1)), q = s.map(x => proj(x, e2));
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

  const th = 0.5 * Math.atan2(2*pq, pp - qq);
  const c = Math.cos(th), sn = Math.sin(th);
  const fore = e1.map((x, i) => x*c + e2[i]*sn);
  const lat  = e1.map((x, i) => -x*sn + e2[i]*c);

  return { up, fore, lat, sway: hi <= 1e-9 ? null : Math.sqrt(Math.max(0, lo) / hi) };
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

// Footfalls, one entry per step.
function footfalls(v, fs, spm) {
  const minGap = Math.max(2, Math.round(fs * 60 / spm * 0.6));
  const thresh = rms(v) * 0.8;
  const out = [];
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] > thresh && v[i] >= v[i - 1] && v[i] > v[i + 1]) {
      if (out.length && i - out[out.length - 1].i < minGap) {
        if (v[i] > out[out.length - 1].v) out[out.length - 1] = { i, v: v[i] };
      } else {
        out.push({ i, v: v[i] });
      }
    }
  }
  return out;
}

// Alternating footfalls should hit equally hard. They rarely do.
//
// ponytail: the alternation is solid, but deciding WHICH group is the left foot is a
// heuristic — the sign of lateral acceleration at footstrike. Calibrate it by running
// a lap with a deliberate limp on a known side. Until then the split is right and the
// labels may be swapped.
function gait(steps, samples, lat) {
  if (steps.length < 6) return { asymmetry: null, left: null, right: null };

  const odd = steps.filter((_, k) => k % 2).map(p => p.v);
  const even = steps.filter((_, k) => !(k % 2)).map(p => p.v);
  const [a, b] = [mean(odd), mean(even)];
  const asymmetry = Math.abs(a - b) / ((a + b) / 2);

  const sideOf = group =>
    mean(steps.filter((_, k) => (k % 2) === group).map(p => proj(samples[p.i], lat)));
  const oddIsLeft = sideOf(1) < sideOf(0);

  const [l, r] = oddIsLeft ? [a, b] : [b, a];
  return { asymmetry, left: 100 * l / (l + r), right: 100 * r / (l + r) };
}

export function analyze(samples) {
  if (samples.length < 32) return { moving: false };

  const span = (samples[samples.length - 1].t - samples[0].t) / 1000;
  if (span <= 0) return { moving: false };
  const fs = (samples.length - 1) / span;

  const f = frame(samples);
  const v0 = samples.map(s => proj(s, f.up));
  const mv = mean(v0);
  const v = v0.map(x => x - mv);

  const level = rms(samples.map(p => Math.hypot(p.ax, p.ay, p.az)));
  if (level < CONFIG.movingRms) return { moving: false, fs, level };

  const spm = cadence(v, fs);
  const steps = spm ? footfalls(v, fs, spm) : [];
  const g = gait(steps, samples, f.lat);

  return {
    moving: true, fs, level, vertical: v,
    cadence: spm,
    bounce: rms(v),
    impact: Math.max(...v.map(Math.abs)) / G,   // peak vertical, in g
    asymmetry: g.asymmetry,
    balance: { left: g.left, right: g.right },
    sway: f.sway,
    steps: steps.length,
  };
}

// 0..100, and every deduction is explainable. Not a model, just a weighted distance
// from the thresholds above.
export function score(m) {
  if (!m.moving) return null;
  const pen = (v, ok, bad) => v == null ? 0 : Math.max(0, Math.min(1, (v - ok) / (bad - ok)));
  let s = 100;
  s -= 32 * pen(CONFIG.lowCadence - (m.cadence ?? CONFIG.lowCadence), 0, 25);
  s -= 28 * pen(m.bounce, CONFIG.bounceMax * 0.7, CONFIG.bounceMax * 1.6);
  s -= 24 * pen(m.asymmetry, CONFIG.asymmetryMax * 0.5, CONFIG.asymmetryMax * 2.5);
  s -= 16 * pen(m.sway, CONFIG.swayMax * 0.7, CONFIG.swayMax * 1.4);
  return Math.round(Math.max(0, s));
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

export const FAULT_LABEL = {
  cadence: 'Overstride',
  bounce: 'Vertical oscillation',
  asymmetry: 'Gait imbalance',
  sway: 'Head instability',
};

export const FOCUS = {
  cadence: 'Shorten stride slightly',
  bounce: 'Land softer, drive forward',
  asymmetry: 'Even out your footstrike',
  sway: 'Eyes forward, run tall',
};
