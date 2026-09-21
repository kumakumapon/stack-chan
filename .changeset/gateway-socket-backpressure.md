---
"stack-chan": patch
---

Honor the native WebSocket client's remaining payload capacity when sending
Gateway frames, including framing overhead. Report queued-write failures as
disconnects so the Gateway bridge can reconnect.
