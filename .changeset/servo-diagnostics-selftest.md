---
"stack-chan": patch
"stackchan-web": patch
---

Add servo diagnostics that separate an issued command from an acknowledged one and from actual head movement: cumulative SCServo command and bus counters, a read-only MiniStack `servo.diag` request, a diagnostics panel and automatic reconnect on the MiniStack test page, and a `servo_selftest` MOD that names the failing layer in one flash. The SCSCL packet encoding moves to a pure codec covered by transport-fault tests (lost acknowledgement, fragmented and noisy responses, corrupt checksums) so those failures no longer need a device to reproduce.
