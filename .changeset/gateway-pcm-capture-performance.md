---
"stack-chan": patch
---

Reduce Gateway microphone processing allocations with bulk mono copies, fixed
stereo sample carry storage, and native Base64 encoding when available. Preserve
PCM mixing, frame ownership, and UTF-8 queue limits while fast-pathing ASCII
audio envelopes.
