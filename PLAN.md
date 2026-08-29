# Form Coach

An AirPods running-form coach. It listens to your body through whatever IMU it can
reach, and speaks one correction at a time while you run.

RUN/HACK, London Stadium, Sat 29 Aug. Hands in 18:00.

Live: https://form-coach-production.up.railway.app

## The one architectural decision

**No native app on the critical path, and no server.**

The whole thing is a static web page. Motion comes from `DeviceMotionEvent` in
Safari, the analysis runs in JS on the phone, and the coach speaks through
`speechSynthesis`. That buys three things that matter today:

- **It ships in minutes, not hours.** No Xcode, no provisioning, no TestFlight, no cable.
- **It works with no signal.** A track has dead spots. Nothing round-trips to a server,
  so laps are never lost mid-run.
- **It is iterable while someone is running.** Push to main, Vercel redeploys, the
  runner pulls to refresh. That is the entire CI loop.

AirPods motion does need native code, because there is no web API for it. That is
Track A, and it is additive: a WKWebView shell that loads this same page and injects
head samples. The page works without it.

## What is built (core, done)

| File | What it is |
|---|---|
| `coach.js` | All the analysis. Pure, no deps, runs identically in the browser and in node. |
| `index.html` | The app. Sensor, live readout, cue display, session recorder. |
| `voice.js` | The only thing that makes noise. One seam, so Track B never touches the app. |
| `replay.js` | The check. `npm run check`. |

### What it actually measures

From a single IMU, projected onto gravity so it does not care how the phone is held:

- **Cadence** — autocorrelation of vertical acceleration, sub-sample interpolated.
  Under ~162 spm and you are overstriding.
- **Bounce** — RMS vertical acceleration. High means you are going up, not forward.
- **Balance** — alternating footfall peaks compared. Uneven means you are favouring a side.

### Cue policy

One fault at a time. It must persist 8 seconds before anything is said, and never
two cues inside 20 seconds. A coach that talks constantly gets muted, and a muted
coach demos badly.

### Thresholds

`CONFIG` in `coach.js`. Every number in it is a guess until someone runs a lap. It
is the calibration knob — tune it on the track, from real recordings, not from
reasoning about it.

## Deploy

```
railway up           # served by server.js, no build step
```

Live at https://form-coach-production.up.railway.app

Must be HTTPS. iOS refuses motion sensors otherwise, and Railway gives it for free.

## CI, such as it is

Three things, and deliberately nothing else:

1. **`npm run check`** — synthetic runs at known cadence, bounce and asymmetry, plus
   the cue timing rules. Runs in under a second, no test framework. It fails if the
   maths breaks.
2. **Push to main → Vercel auto-deploys.** That is the config. There isn't a file.
3. **Recorded fixtures.** Hit Record in the app, run a lap, Export, drop the `.jsonl`
   in `fixtures/`. `npm run check` replays every fixture and prints the cue timeline.

Point 3 is the important one and it should happen in the **first lap anyone runs**.
Once there are real recordings of good form, overstriding and a deliberate limp,
everyone can develop the coach on a laptop with no one on the track. Record early.

Skipped GitHub Actions. Add it if a judge asks to see a green tick.

## Scoring

`FINAL = BUILD(0..35) + KM/2`. Build dominates, but kilometres are free points and
this product is only real if we run with it. Every lap is both distance and a
recorded fixture. Record every lap.

Existing projects are disqualified. This repo started from `git init` on the day.
