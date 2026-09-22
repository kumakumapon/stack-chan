---
"stack-chan": patch
---

Apply the same StackchanVoice text preparation on the WASM simulator path,
which previously ran on raw text and so could not reproduce or verify the
device reading behavior. Most importantly, a reply the local engine cannot
pronounce no longer ends the conversation: it used to leave the robot in a
`blocked` state that ignored the microphone and every further server
message, so the next turn was never heard. The failure is now reported and
the robot keeps listening.
