---
"stack-chan": patch
---

Reduce dropouts when the robot plays Gateway-synthesized reply audio.
Playback used to start on the very first received chunk with no cushion
against sender jitter; it now buffers about 192 ms before the first write,
and always flushes whatever is queued once a reply completes so short
replies are never held back. Exceeding the queue's byte cap used to discard
the whole reply and block the conversation; it now drops only the oldest
not-yet-sent audio and keeps draining.
