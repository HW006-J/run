# Form Coach

**A running form coach that talks to you through your AirPods while you run.**

### → [form-coach-production.up.railway.app](https://form-coach-production.up.railway.app)

Built at RUN/HACK, London Stadium, Saturday 29 August. First commit was made on the day.

---

## For the judges: try it in 30 seconds

1. Open the link **on your phone**. It has to be a phone, and it has to be Safari or Chrome on iOS.
2. Hold the phone in one hand, or clip it to an armband.
3. Tap **Start** and allow motion access.
4. Run. Down the corridor, on the spot, round the track. Ten seconds is enough.

It will start reading your cadence, your bounce and your left/right balance, and it
will tell you, out loud, the one thing you should fix. It stays quiet when your form
is fine.

To see it correct you on purpose: run with deliberately long, slow strides. It will
tell you to pick your feet up.

---

## What it measures

One inertial sensor, projected onto gravity so it does not care how you hold the phone.

| Signal | How | Why it matters |
|---|---|---|
| **Cadence** | Autocorrelation of vertical acceleration, sub-sample interpolated | Under about 162 steps per minute means you are overstriding and braking on every step. It is the single most correctable fault in distance running. |
| **Bounce** | RMS vertical acceleration | Energy going up instead of forward. |
| **Balance** | Alternating footfall peaks compared | A persistent left/right mismatch is how running injuries announce themselves. |
| **Head** *(AirPods only)* | Principal axes of horizontal acceleration | How much of your movement is *across* the direction of travel instead of along it. A hand cannot tell you this, because the arm swing is the lateral motion. A head can. |

### It does not nag

This is the part we spent the most time on. A fault has to persist for 8 seconds
before anything is said, only one fault is ever spoken at a time, and there is a
20 second floor between cues. A coach that talks constantly gets muted, and a muted
coach is not a coach.

---

## The thing we found out

The original plan was one AirPod in each hand, giving two independent arm sensors.

**That is not possible.** `CMHeadphoneMotionManager` delivers motion from one bud at a
time. `sensorLocation` tells you which bud it currently is, and the system switches
between them based on in-ear state. There is no parallel left/right stream and no way
to ask for one.

So the two modes became:

- **AirPods.** Head-mounted IMU, roughly 25 Hz, one bud at a time. It measures the thing
  nothing else can: whether your head stays pointed where you are going. We take the
  principal axis of horizontal acceleration, which is fore-aft by definition when you
  are running forwards, and the ratio to the other axis is your wobble. No compass
  required.
- **Phone in hand.** Held or strapped on. Cadence, bounce and left/right balance.

Both modes are in the app. Tap between them.

## The thing we decided

**No server, and no native app on the critical path.** The whole product is a static
page. Motion comes from `DeviceMotionEvent`, the analysis runs in JavaScript on the
phone, and the coach speaks through the phone's own speech synthesis.

Three reasons, all of them about today:

- **It works with no signal.** A running track has dead spots. Nothing round-trips to
  a server, so a lap is never lost because the connection dropped on the back straight.
- **It ships in minutes.** No Xcode, no provisioning, no TestFlight review, no cable.
- **It can be changed while someone is running.** Push to main, Railway redeploys, the
  runner pulls to refresh. That is the entire deployment pipeline, and it is the only
  one that works when the person writing the code is also the person doing laps.

AirPods motion genuinely does need native code, because there is no web API for it. So
that became a track rather than a blocker: a `WKWebView` shell that loads this same page
and injects head samples through it. The page works on its own without it.

## What is real and what is not

Real: the signal processing, the cue policy, the web app, the offline behaviour, the
recorder, the checks, and the native AirPods shell. The web app runs on any phone at
the link above. AirPods mode needs the app in `ios/` on a real device, because a
simulator has no buds to read.

Not yet real: the voice is the phone's built-in synthesis, not ElevenLabs (Track B).
Session review is not built (Track C). Every threshold in `CONFIG` is an informed
guess that wants tuning against recorded runs.

We would rather tell you that than have you find it.

---

## The three tracks

The core is finished, so these run in parallel. Each owns its own files, and each one
touches at most two lines of `index.html`, so nobody blocks anybody.

### Track A — AirPods · **built**

`ios/FormCoach/FormCoach.swift`, one file. A `WKWebView` holding the same page you can
open in Safari, plus the two things a browser cannot do:

- `CMHeadphoneMotionManager` feeding head samples into `window.__head()` through
  `evaluateJavaScript`, converted from g to m/s² so they are the same shape the phone
  already produces.
- `AVSpeechSynthesizer` behind a `say` message handler, on a `.playback` audio session
  with `duckOthers`, so cues keep coming with the screen off and cut through your music
  instead of stopping it.

The page is bundled inside the app too, so a cold start with no signal still works.

```bash
brew install xcodegen
cd ios && xcodegen generate && open FormCoach.xcodeproj
```

Run it on a **real device**; a simulator has no buds. Set your signing team in Xcode.
Then turn **off** Automatic Ear Detection in Settings, or the motion stream dies the
moment a pod leaves an ear.

Still open: the head stream is roughly 25 Hz, which is coarse for cadence, and the neck
damps the impact spike. Cadence from the head will want its own thresholds. That is
what the recorder is for.

### Track B — Voice

Owns `voice.js` and `audio/`.

The cue vocabulary is fixed and tiny by design. Pre-render each line to an ElevenLabs
clip once, ship the files, and there is never an API call during a run. It stays
offline and it sounds like a coach instead of a satnav. Built-in speech synthesis
stays as the fallback.

Then make it good: urgency that scales with how bad the fault is, and ducking under
music.

### Track C — Session review

Owns `review.html`.

Load an exported session and play the run back. Cadence over time, where each cue
fired, and whether the runner actually responded to it.

"Your cadence rose 9 steps per minute within 15 seconds of the first cue" is the most
convincing thing this project can show, because it is evidence that the coaching
worked rather than a claim that it might.

---

## Running it yourself

```bash
npm run check     # the whole test suite, no framework, under a second
npm start         # serve locally on :3000
```

`npm run check` builds synthetic runs at known cadence, bounce and asymmetry and
asserts the analysis recovers them, then asserts the cue timing rules hold. It also
replays every real recording in `fixtures/` and prints the cue timeline.

To make a recording: hit **Record** in the app, run, hit **Export**, drop the `.jsonl`
into `fixtures/`. That is how the thresholds get tuned, and it is why the recorder is
in the first version instead of a later one.

## Repo

| File | |
|---|---|
| `coach.js` | All the analysis and the cue policy. Pure, no dependencies, runs identically in the browser and in node. |
| `index.html` | The app. Sensor, live readout, cues, session recorder. |
| `head.js` | The AirPods stream. Empty in a normal browser; filled by the native shell. |
| `voice.js` | The only thing that makes noise. Native speech when the shell is present, `speechSynthesis` otherwise. |
| `ios/` | The native shell. One Swift file and an XcodeGen config. |
| `replay.js` | The checks. |
| `server.js` | Static file server, `node:http` only. |
| `PLAN.md` | Team plan and the reasoning behind the architecture. |
