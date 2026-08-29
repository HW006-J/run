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

## Tracks

The core is done, so these run in parallel. Each owns its own files. The only shared
file is `index.html`, and each track touches at most two lines of it.

### Track A — AirPods

The reason the project exists.

`CMHeadphoneMotionManager` delivers motion from **one bud at a time**. `sensorLocation`
tells you which, and the system switches based on in-ear state. There is no parallel
left/right stream, so "one AirPod in each hand" cannot work as two sensors. Two
positions that do:

- **Ears** — head IMU. Head bob, lateral sway, torso stability. Nothing else on the
  market coaches from the head.
- **Hand** — AirPods in the ears for audio, phone gripped in one hand for arm swing.
  Cross-body arm swing is a real, common, correctable fault.

Build: a SwiftUI app that is a `WKWebView` pointed at the deployed URL, plus
`CMHeadphoneMotionManager` feeding samples in through `evaluateJavaScript`. Roughly
100 lines. It adds a sensor; it does not reimplement anything.

Contract: call `window.__head(sample)` with the same `{t,ax,ay,az,gx,gy,gz}` shape.
Add `head.js` to merge that stream. One `<script>` tag in `index.html`.

First: turn **off** Automatic Ear Detection, or the motion stream dies the moment a
pod leaves an ear.

### Track B — Voice

Owns `voice.js` and `audio/`.

Pre-render each string in `CUES` to an ElevenLabs mp3 **once**, at build time, and
ship them. The vocabulary is fixed and tiny, so there is no API call during a run and
it works with no signal. Keep `speechSynthesis` as the fallback.

Then make it good: coach personality, urgency that scales with how bad the fault is,
ducking under music. This is the ElevenLabs prize and the cue vocabulary is already
the right shape for it.

### Track C — Session review and the pitch

Owns `review.html`.

Load an exported `.jsonl` and show the run back: cadence over time, where each cue
fired, a form score, and whether the runner actually responded to a correction.
"Your cadence rose 9 spm after the first cue" is the single most convincing thing we
can put in front of a judge, because it shows the coaching *worked*.

Also owns the demo: screen recording of the phone mid-lap, and the vlog for the
special challenge.

## Scoring

`FINAL = BUILD(0..35) + KM/2`. Build dominates, but kilometres are free points and
this product is only real if we run with it. Every lap is both distance and a
recorded fixture. Record every lap.

Existing projects are disqualified. This repo started from `git init` on the day.
