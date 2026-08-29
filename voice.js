// The only thing that makes noise.
//
// Priority: ElevenLabs clip (pre-rendered at build time, offline after first load)
// -> native AVSpeechSynthesizer (survives a locked screen) -> speechSynthesis.
// The cue vocabulary is fixed, so the clips are a complete lookup table.

const native = () => window.webkit?.messageHandlers?.say;

const clips = {};
for (const fault of ['cadence', 'bounce', 'asymmetry', 'sway']) {
  const a = new Audio(`audio/${fault}.mp3`);
  a.preload = 'auto';
  clips[fault] = a;
}

export function unlock() {
  // iOS unlocks audio per user gesture; prime one muted clip and speech both
  try { const a = clips.cadence; a.muted = true; a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => {}); } catch {}
  if (native()) return;
  try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch {}
}

function fallback(text) {
  const n = native();
  if (n) { n.postMessage(text); return; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch {}
}

export function say(text, fault) {
  const clip = clips[fault];
  if (clip) {
    clip.currentTime = 0;
    clip.play().catch(() => fallback(text));
    return;
  }
  fallback(text);
}
