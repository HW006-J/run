# Why the coach behaves the way it does

Findings from open-source running apps, gait-analysis libraries and the sports-science
literature, and what we changed because of them. Kept short; URLs at the bottom.

## What the field actually does

- **RunnerUp** (the only OSS app with real-time target coaching) evaluates on a
  **20 s ring buffer with a 5% trimmed mean**, mutes the first **20 s** of a run, and
  enforces a **30 s cooldown** between voice cues. Silence means in-zone.
- **OpenTracks / GadgetBridge / FitTrackee**: interval announcements or nothing —
  no realtime form coaching exists there.
- **Garmin's public zones**: cadence green 164–173, red < 153. Vertical oscillation
  orange > 9.8 cm, red > 11.5 cm. Gait balance red beyond ~52.2/47.8.
- **Cadence science** (Heiderscheit 2011): the fix is **+5–10% of the runner's own
  cadence**, not the 180 spm myth. Absolute targets mislabel tall runners.
- **Motor learning**: a gait correction takes **~300 strides (~3 min)** to appear.
  Re-cueing the same fault after 20 s is nagging, not coaching. Feedback should fade.
- **Asymmetry**: an 800-runner RCT found asymmetry did not predict injury — so it is
  our lowest-priority cue, never outranking the others.
- **Ear-worn IMUs** (EarGait, earbud validation studies): cadence from the head is
  excellent even at 25–50 Hz; there is **no published absolute head-sway threshold**,
  so ours is a per-runner baseline, not a universal number.

## What changed in coach.js because of this

| Was | Now | Why |
|---|---|---|
| cue on one 6 s window | cue on a ~20 s trimmed mean (`smoothTicks`) | RunnerUp; one bad window is a pothole, not a fault |
| lowCadence 162 absolute | < 95% of the runner's own session baseline, floor 153 | Heiderscheit; Garmin red zone as the floor |
| bounceMax 7 m/s² RMS | 10.5 m/s² RMS | 7 flagged runners Garmin calls green (~6.5 cm VO) |
| asymmetryMax 0.15 | 0.10, and always the lowest-priority cue | Robinson SI convention; weak injury evidence |
| swayMax 0.62 fixed | mean + 2 SD of this runner's session, 0.62 as fallback | no literature anchor exists; baseline beats guess |
| cueGapSec 20 | 30, plus `repeatGapSec` 90 per fault | RunnerUp cooldown; ~300 strides to land a fix |
| sustainSec 8 | 12, plus `graceSec` 20 start-of-run mute | RunnerUp initialGrace; hills and turns stop triggering |

Still deliberately ours: one fault per utterance, fixed short directives, silence when
form is good. The literature agrees with all three.

Worth trying if there is time: a cadence **metronome burst** instead of words —
continuous auditory pacing beat verbal instruction in trials (PaceGuard).

## Sources

- RunnerUp TargetTrigger / WorkoutBuilder: https://github.com/jonasoreland/runnerup
- Garmin running dynamics zones: https://www8.garmin.com/manuals/webhelp/forerunner945/EN-US/GUID-EE9E7F6F-49BE-4452-82E6-B40371D0AEC1.html
- Heiderscheit 2011, cadence +5–10%: https://pmc.ncbi.nlm.nih.gov/articles/PMC3022995/
- Feedback timing (~300 cycles): https://pmc.ncbi.nlm.nih.gov/articles/PMC7892879/
- Asymmetry vs injury RCT: https://pmc.ncbi.nlm.nih.gov/articles/PMC10773390/
- EarGait (ear-worn IMU gait): https://github.com/mad-lab-fau/eargait
- Earbud IMU validation: https://pmc.ncbi.nlm.nih.gov/articles/PMC8659722/
- GaitPy (VO by double integration): https://github.com/matt002/GaitPy
- sensormotion (autocorrelation symmetry): https://github.com/sho-87/sensormotion
- PaceGuard (auditory cadence pacing): https://www.researchgate.net/publication/231556680
