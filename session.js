// One run: GPS distance, a per-second metric timeline, cue log, and persistence.
// History lives in localStorage — this is a coach, not a cloud.

// Relay teams share one phone, so runs are keyed per user.
export function activeUser() {
  try { return +localStorage.getItem('user') || 1; } catch { return 1; }
}
export function setUser(n) {
  try { localStorage.setItem('user', n); } catch {}
}
export function loadRuns(user = activeUser()) {
  try { return JSON.parse(localStorage.getItem('runs:' + user)) ?? []; } catch { return []; }
}

export class Session {
  constructor(mode) {
    this.mode = mode;
    this.user = activeUser();

    // Live telemetry to the server every 10s so a teammate (or a Claude session) can
    // watch and tune mid-run: curl <site>/telemetry/<runner>. Fire and forget — a
    // dead spot on the back straight must never touch the run.
    this._tel = setInterval(() => {
      const recent = this.timeline.slice(-12);
      if (!recent.length) return;
      const body = JSON.stringify({
        user: this.user, mode: this.mode, at: this.startedAt,
        km: +this.km.toFixed(2), cues: this.cues.slice(-5), window: recent,
      });
      try {
        navigator.sendBeacon?.(`/telemetry/${this.user}`, body) ||
          fetch(`/telemetry/${this.user}`, { method: 'POST', body, keepalive: true }).catch(() => {});
      } catch {}
    }, 10000);
    this.startedAt = Date.now();
    this.timeline = [];      // one entry/sec: {t, cadence, bounce, impact, asym, sway, score}
    this.cues = [];          // {t, fault}
    this.km = 0;
    this.gpsOk = false;
    this._last = null;

    this._watch = navigator.geolocation?.watchPosition(
      p => {
        this.gpsOk = true;
        const { latitude: lat, longitude: lon, accuracy } = p.coords;
        if (accuracy > 30) return;                    // urban canyon junk
        if (this._last) {
          const d = haversine(this._last, { lat, lon });
          if (d < 50) this.km += d / 1000;            // teleports are not laps
        }
        this._last = { lat, lon };
      },
      () => {},   // no GPS is fine; distance just stays at 0
      { enableHighAccuracy: true, maximumAge: 1000 },
    );
  }

  tick(t, m, sc) {
    this.timeline.push({
      t: Math.round(t),
      cadence: m.cadence ?? null, bounce: m.bounce ?? null, impact: m.impact ?? null,
      asym: m.asymmetry ?? null, sway: m.sway ?? null, score: sc,
      balL: m.balance?.left ?? null,
    });
  }

  cue(t, fault) { this.cues.push({ t: Math.round(t), fault }); }

  stop() {
    clearInterval(this._tel);
    if (this._watch != null) navigator.geolocation?.clearWatch(this._watch);
    const moving = this.timeline.filter(x => x.score != null);
    const avg = k => {
      const xs = moving.map(x => x[k]).filter(x => x != null);
      return xs.length ? xs.reduce((a, b) => a + b) / xs.length : null;
    };
    const run = {
      at: this.startedAt,
      mode: this.mode,
      user: this.user,
      sec: Math.round((Date.now() - this.startedAt) / 1000),
      km: +this.km.toFixed(2),
      score: avg('score') != null ? Math.round(avg('score')) : null,
      cadence: avg('cadence'), bounce: avg('bounce'), impact: avg('impact'),
      asym: avg('asym'), sway: avg('sway'), balL: avg('balL'),
      cues: this.cues,
      timeline: this.timeline,
    };
    if (moving.length >= 5) {
      // ponytail: keep the last 20 runs whole, timelines included. localStorage is
      // ~5MB; trim timelines first if anyone ever hits it.
      try { localStorage.setItem('runs:' + this.user, JSON.stringify([run, ...loadRuns(this.user)].slice(0, 20))); }
      catch {}
    }
    return run;
  }
}

function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat/2)**2 +
            Math.cos(a.lat*r) * Math.cos(b.lat*r) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
