---
"stack-chan": minor
---

Add an opt-out low-battery notice to Companion Mode. When the battery level drops to the low threshold, the robot shows a sleepy reaction and a short balloon once (not while a conversation is active), then idle reactions become rarer and calmer until the level recovers. Devices that cannot report a battery level are unaffected. Set `companion.lowBatteryNotice` to `0` to disable the notice and the idle reduction.
