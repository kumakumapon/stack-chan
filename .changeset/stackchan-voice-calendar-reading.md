---
"stack-chan": patch
---

Prepare common quotation marks and numeric readings specifically for the CoreS3
StackchanVoice text frontend. Preserve reply words while reading calendar days
such as 14日 as じゅうよっか, instead of digit-by-digit or missing numeric content.
Raw koe input and other TTS engines are unchanged. Unknown symbols can still fail
explicitly; this is not a complete Japanese pronunciation engine.
