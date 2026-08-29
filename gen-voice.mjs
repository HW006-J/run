// Track B build step: render the fixed cue vocabulary to ElevenLabs clips, once.
// Run: ELEVENLABS_API_KEY=... node gen-voice.mjs
// The mp3s are committed; the app never calls the API at run time.
import { writeFile } from 'node:fs/promises';
import { CUES } from './coach.js';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error('set ELEVENLABS_API_KEY');

const VOICE = 'pNInz6obpgDQGcFmaJgB'; // Adam: deep, direct — a coach, not a satnav

for (const [fault, text] of Object.entries(CUES)) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.6 },
    }),
  });
  if (!res.ok) throw new Error(`${fault}: ${res.status} ${await res.text()}`);
  await writeFile(`audio/${fault}.mp3`, Buffer.from(await res.arrayBuffer()));
  console.log(`audio/${fault}.mp3  ${text}`);
}
