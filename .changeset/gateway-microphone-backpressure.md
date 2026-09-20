---
"stack-chan": patch
---

Keep the Gateway connection open when its bounded socket queue fills. Pause
microphone capture and retry one unaccepted frame before resuming, with a bounded
retry budget. Discard locally queued microphone frames when conversation input
is stopped or disconnected, preserving queued control messages.
