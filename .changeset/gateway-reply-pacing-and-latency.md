---
"stack-chan": patch
---

Pace Gateway reply audio against an absolute clock instead of sleeping a
fixed duration per frame: a `setTimeout`-based per-frame sleep always
over-sleeps a little, and on a long reply that drift accumulated into a
noticeable lag behind real time, which the device played back as dropouts.
An over-sleeping timer now corrects itself on the next frame instead of
pushing every later frame back. Raise the reply-audio prebuffer from 256 ms
to 512 ms, comfortably under the device's 2.05 s receive queue. Log how long
recognition, reply generation, and the first audio frame took, carrying only
timings, sizes, and frame counts, never transcript text.
