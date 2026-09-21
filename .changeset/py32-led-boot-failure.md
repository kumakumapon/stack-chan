---
"stack-chan": patch
---

Keep booting when PY32 LED configuration or initial clearing fails. Disable that
LED instance until reboot without closing the shared servo bus, so optional LED
initialization failures no longer prevent menu registration.
