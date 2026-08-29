// The coach's face — a grokbot.
//
// Expression data and the spring/blink/gaze mechanics come from LaoA-GrokBot
// (https://github.com/zhulin025/LaoA-GrokBot, MIT, (c) 2026 老A玩AI), trimmed to the
// states a running coach needs and recoloured to the app palette.
//
//   const bot = mountBot(el);
//   bot.state('happy');     // idle | listening | happy | proud | celebrate |
//                           // alerting | suspicious | sleeping | working
import { BODY, EXPR, POOLS, CADENCE, BLINK } from './bot-data.js';

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

export function mountBot(el, { size = 150 } = {}) {
  el.innerHTML = `
    <svg viewBox="-20 -24 269 269" style="width:${size}px;height:${size}px;display:block">
      <defs><clipPath id="bot-clip-${size}"><path d="${BODY}"/></clipPath></defs>
      <path d="${BODY}" fill="var(--card2, #1d1d21)" stroke="var(--line, #26262b)" stroke-width="3"/>
      <g clip-path="url(#bot-clip-${size})" transform="translate(0 12)">
        <path class="e0" fill="var(--brand, #ff5b14)"/>
        <path class="e1" fill="var(--brand, #ff5b14)"/>
      </g>
    </svg>`;
  const eyes = [el.querySelector('.e0'), el.querySelector('.e1')];

  let state = 'idle';
  let current = EXPR[POOLS.idle[0]].map(r => r.map(p => [...p]));
  let target = EXPR[POOLS.idle[0]];
  let morph = 1, vel = 0, last = performance.now();
  let nextExpr = 0, nextBlink = 0, blinkAt = 0;
  let gx = 0, gy = 0, tgx = 0, tgy = 0, nextGaze = 0;

  const pick = () => {
    const pool = POOLS[state] ?? POOLS.idle;
    current = shown();
    target = EXPR[pool[Math.floor(Math.random() * pool.length)]];
    morph = 0; vel = 0;
    const [lo, hi] = CADENCE[state] ?? [6000, 12000];
    nextExpr = performance.now() + rand(lo, hi);
  };

  const shown = () => current.map((ring, e) =>
    ring.map((p, i) => [p[0] + (target[e][i][0] - p[0]) * Math.min(morph, 1),
                        p[1] + (target[e][i][1] - p[1]) * Math.min(morph, 1)]));

  const path = ring => 'M' + ring.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z';

  // setInterval, not requestAnimationFrame: rAF freezes in occluded windows and
  // throttled iOS webviews, and a frozen coach face mid-blink looks broken.
  function frame() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    // same spring the lab uses: critically-damped-ish snap to the new expression
    vel += (-14 * vel - 49 * (morph - 1)) * dt;
    morph += vel * dt;
    if (!Number.isFinite(morph)) { morph = 1; vel = 0; }

    if (now > nextExpr) pick();
    if (now > nextBlink) {
      blinkAt = now;
      const [lo, hi] = BLINK[state] ?? [6000, 14000];
      nextBlink = now + rand(lo, hi);
    }
    const b = now - blinkAt;
    const bs = b < 140 ? Math.max(0.08, Math.abs(Math.cos(b / 140 * Math.PI))) : 1;

    if (now > nextGaze) { tgx = rand(-9, 9); tgy = rand(-5, 6); nextGaze = now + rand(1800, 4200); }
    gx += (tgx - gx) * dt * 3; gy += (tgy - gy) * dt * 3;

    const s = shown();
    s.forEach((ring, i) => {
      const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      eyes[i].setAttribute('d', path(ring));
      eyes[i].setAttribute('transform',
        `translate(${gx} ${gy}) translate(${c[0]} ${c[1]}) scale(1 ${bs}) translate(${-c[0]} ${-c[1]})`);
    });
  }
  const timer = setInterval(frame, 50);
  pick();

  return {
    state(next) {
      if (next === state || !(next in POOLS)) return;
      state = next;
      pick();
    },
    stop() { clearInterval(timer); el.innerHTML = ''; },
  };
}
