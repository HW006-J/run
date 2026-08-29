// The one runnable check. `npm run check`.
//
// Two jobs:
//   1. synthetic runs with known cadence/bounce/asymmetry -> analyze() must recover them
//   2. replay any recorded fixtures/*.jsonl through the Coach and print the cue timeline
//
// This is how you develop the coach on a laptop while a teammate is on the track.

import { readdirSync, readFileSync } from 'node:fs';
import { analyze, Coach, CONFIG } from './coach.js';

const G = 9.81;

// A footfall is a sharp spike, not a sine. Model it as a narrow pulse per step so
// the synthetic trace has the same harmonic structure as a real one.
// `bounce` is a peak amplitude; the resulting RMS lands at roughly 0.6x it.
function synth({ spm, bounce = 10, asym = 0, sec = 30, fs = 60 }) {
  const s = [];
  const stepHz = spm / 60;
  for (let i = 0; i < sec * fs; i++) {
    const t = i / fs;
    const phase = (t * stepHz) % 1;
    const stepIndex = Math.floor(t * stepHz);
    const gain = 1 + (stepIndex % 2 ? asym / 2 : -asym / 2);
    // impact spike just after touchdown, gentle flight arc between
    const spike = Math.exp(-Math.pow((phase - 0.1) / 0.08, 2));
    const vert = bounce * gain * (2.2 * spike - 0.55 - 0.9 * Math.cos(2 * Math.PI * phase));
    const fore = 0.4 * bounce * Math.sin(2 * Math.PI * phase);
    s.push({
      t: i * 1000 / fs,
      ax: fore, ay: 0, az: vert,
      gx: fore, gy: 0, gz: vert + G,
    });
  }
  return s;
}

let failed = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) failed++;
};

console.log('-- analyze() recovers what we put in --');

for (const spm of [155, 170, 185]) {
  const m = analyze(synth({ spm }));
  ok(`cadence ${spm}`, m.moving && Math.abs(m.cadence - spm) < 4, `got ${m.cadence?.toFixed(1)}`);
}

{
  const quiet = analyze(synth({ spm: 175, bounce: 6 }));
  const heavy = analyze(synth({ spm: 175, bounce: 18 }));
  ok('bounce: light stays under the limit', quiet.bounce < CONFIG.bounceMax && heavy.bounce > CONFIG.bounceMax,
     `${quiet.bounce.toFixed(2)} vs ${heavy.bounce.toFixed(2)}`);
}

{
  const even = analyze(synth({ spm: 175, asym: 0 }));
  const limp = analyze(synth({ spm: 175, asym: 0.4 }));
  ok('asymmetry: even run reads clean', even.asymmetry < 0.1, `${even.asymmetry?.toFixed(3)}`);
  ok('asymmetry: limp is flagged', limp.asymmetry > CONFIG.asymmetryMax, `${limp.asymmetry?.toFixed(3)}`);
}

ok('standing still is not coached', !analyze(synth({ spm: 170, bounce: 0.3 })).moving);

console.log('\n-- Coach fires the right cue, and does not nag --');

// Slide a 6s window across the trace once per second, exactly as the app does.
function drive(samples) {
  const c = new Coach();
  const endT = samples[samples.length - 1].t;
  const cues = [];
  for (let now = CONFIG.windowSec; now * 1000 <= endT; now++) {
    const w = samples.filter(p => p.t >= (now - CONFIG.windowSec) * 1000 && p.t < now * 1000);
    const cue = c.update(analyze(w), now);
    if (cue) cues.push({ at: now, ...cue });
  }
  return cues;
}

{
  const cues = drive(synth({ spm: 150, sec: 100 }));
  ok('slow cadence gets coached', cues.length > 0 && cues[0].fault === 'cadence',
     cues[0] ? `first cue at ${cues[0].at}s: "${cues[0].text}"` : 'no cue');
  ok('waits before speaking', !cues.length || cues[0].at >= CONFIG.sustainSec, `at ${cues[0]?.at}s`);
  const gaps = cues.slice(1).map((c, i) => c.at - cues[i].at);
  ok('respects the cue gap', gaps.every(g => g >= CONFIG.cueGapSec), `gaps ${gaps.join(',') || 'n/a'}`);
}

{
  const cues = drive(synth({ spm: 176, bounce: 9, sec: 100 }));
  ok('good form is left alone', cues.length === 0, `${cues.length} cues`);
}

// Real recordings, once anyone has made one. Export them from the app.
const fixtures = readdirSync('fixtures').filter(f => f.endsWith('.jsonl'));
if (fixtures.length) {
  console.log('\n-- recorded fixtures --');
  for (const f of fixtures) {
    const samples = readFileSync(`fixtures/${f}`, 'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse);
    const m = analyze(samples.slice(0, CONFIG.windowSec * 60));
    console.log(`${f}  ${samples.length} samples  ${(samples[samples.length-1].t/1000).toFixed(0)}s` +
      `  cadence ${m.cadence?.toFixed(0) ?? '-'}  bounce ${m.bounce?.toFixed(2) ?? '-'}` +
      `  asym ${m.asymmetry?.toFixed(3) ?? '-'}`);
    for (const c of drive(samples)) {
      console.log(`   ${c.at}s  ${c.fault}: ${c.text}`);
    }
  }
} else {
  console.log('\nno recorded fixtures yet — export one from the app and drop it in fixtures/');
}

console.log(failed ? `\n${failed} FAILED` : '\nall good');
process.exit(failed ? 1 : 0);
