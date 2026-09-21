---
"stack-chan": patch
---

Improve experimental CoreS3 Gateway conversation with reusable mono microphone
buffers, bounded retries for invalid read sizes, device-local speech selection,
and removal of the temporary microphone timing overlay. Bound stuck-VAD turns
and adjust streamed audio buffering. Basic device conversation is confirmed;
long-running stability remains under investigation. Temporary three-second
utterance and kana-only local speech limits can truncate or alter replies.
