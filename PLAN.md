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

Core and Track A are done. Each remaining track is written so an agent (human or
Claude) can start cold: goal, files owned, the contract with the rest of the app,
definition of done. No track edits another track's files. Everyone runs
`npm run check` before committing — it is under a second.

### Track B — Voice · open

**Goal:** the coach sounds like a coach, not a satnav. ElevenLabs prize.

**Owns:** `voice.js`, `audio/` (new).

**Contract:** `say(text)` and `unlock()` keep their signatures. The cue vocabulary is
the fixed `CUES` map in `coach.js` — do not grow it without also growing `FAULT_LABEL`
and `FOCUS`.

**Build:**
1. Script (Node, one file, run once at build time): call the ElevenLabs TTS API for
   each string in `CUES`, save `audio/<fault>.mp3`. Commit the mp3s — they are tiny
   and the run must never depend on the network.
2. In `voice.js`, prefer the clip: `new Audio('audio/'+fault+'.mp3').play()`, keep
   `speechSynthesis` as fallback, keep the native `say` bridge as the first branch.
   `say()` gains an optional second arg `fault` — the app already knows it.
3. Stretch: two urgency takes per cue, picked by how far past threshold the fault is.

**Done when:** cues on the deployed site play ElevenLabs audio with WiFi off after
first load, and `npm run check` still passes.

### Track C — Session review & the pitch · open

**Goal:** proof the coaching works, on screen, for judges.

**Owns:** `review.html` (new). Read-only use of `session.js` (`loadRuns`) and
`coach.js`.

**Contract:** runs live in localStorage under `runs:1|2|3`, shape is in
`session.js::Session.stop()`. Each run has a per-second `timeline` and a `cues` log.

**Build:**
1. Page that loads a chosen runner's latest run and renders cadence over time with
   cue markers, then the headline stat: cadence in the 15s before the first cadence
   cue vs the 30s after. "Cadence rose N spm after the cue" is the money line.
2. Team view: all three runners side by side, total km, cue counts.
3. Owns the demo assets: a screen recording of a live run, and the vlog for the
   special challenge prize.

**Done when:** `review.html` on the deployed site shows a before/after-cue delta from
a real recorded run.

### Track D — Calibration · open, highest value per minute

**Goal:** replace every guessed threshold in `CONFIG` with a measured one.

**Owns:** `fixtures/`, threshold values in `coach.js` (values only, not code), and the
fixture section of `replay.js`.

**Build:**
1. On the track, record with Record/Export in the app: one good-form lap, one
   deliberate overstride, one deliberate limp (note which side!), one head-wobble
   lap in AirPods mode. Both modes where possible. AirDrop the `.jsonl` files into
   `fixtures/`, named `<mode>-<fault>.jsonl`.
2. `npm run check` prints metrics and the cue timeline per fixture. Tune `CONFIG`
   until each fixture triggers its own fault and only its own fault.
3. Settle the left/right question: the gait sign heuristic in `coach.js::gait` is
   uncalibrated — the limp fixture tells you if the labels are swapped.
4. Encode the tuned expectations as asserts in `replay.js` so they cannot regress.

**Done when:** four fixtures are committed and `npm run check` asserts the right cue
fires on each.

## Scoring

`FINAL = BUILD(0..35) + KM/2`. Build dominates, but kilometres are free points and
this product is only real if we run with it. Every lap is both distance and a
recorded fixture. Record every lap.

Existing projects are disqualified. This repo started from `git init` on the day.
