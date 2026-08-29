// The only thing that makes noise. Track B owns this file; nothing else needs to change.
//
// Now: speechSynthesis. Free, offline, already on the phone.
// Next: pre-render each CUES string to an ElevenLabs mp3 once, ship them in audio/,
// and play the clip. The cue vocabulary is fixed and tiny, so there is never an
// API call mid-run and it still works with no signal on the back straight.

// The native shell speaks through AVSpeechSynthesizer instead: it ducks under music,
// keeps playing with the screen off, and does not depend on WKWebView's patchy
// speechSynthesis support.
const native = () => window.webkit?.messageHandlers?.say;

export function unlock() {
  if (native()) return;
  try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch {}
}

export function say(text) {
  const n = native();
  if (n) { n.postMessage(text); return; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch {}
}
