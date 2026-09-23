---
"stack-chan": patch
---

Send CoreS3 Gateway microphone PCM in 40 ms frames to reduce WebSocket queue
pressure and avoid capture pauses observed with 20 ms frames. Give the Hermes
Desktop bridge 700 ms of silence before ending a Japanese utterance, keeping
brief pauses within one recognition request.
