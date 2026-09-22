---
"stack-chan": patch
---

Retry a StackchanVoice reply once, with its symbols stripped, when the first
attempt has no reading for it; only symbols are ever removed, and only after
a failure. Apply the same text preparation on the WASM simulator path, which
previously ran on raw text and so could not reproduce or verify the device
reading behavior. Most importantly, a reply the local engine still cannot
pronounce after that retry no longer ends the conversation: it used to leave
the robot in a `blocked` state that ignored the microphone and every further
server message, so the next turn was never heard. The failure is now
reported and the robot keeps listening.
