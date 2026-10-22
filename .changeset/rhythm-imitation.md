---
"stack-chan": minor
"stackchan-web": minor
---

Add an offline Rhythm Imitation Mini App with six rounds, head/LCD tap timing, visual and sound cues, replay, silent play and Japanese/English labels. Add owner-scoped short-tone cancellation on hardware and in the WASM simulator so closing the game or starting other audio releases its cue without stopping another caller's playback.

Keep the new game out of the classic non-touch 4 MB M5Stack build to preserve its flash layout. Update Vite and Vitest to patched releases for the web dependency audit.
