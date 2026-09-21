---
"stack-chan": patch
---

Preserve complete Gateway replies, including kanji and numbers, for the selected
local speech engine instead of silently filtering and truncating them. Restore a
30-second received-audio safety limit while retaining silence-based endpointing;
split boundary frames without losing samples. Unsupported text remains an explicit
TTS error. Persistent microphone noise can delay replies until the safety limit.
