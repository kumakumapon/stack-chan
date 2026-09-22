---
"stack-chan": patch
---

Make Japanese recognition and endpointing configurable in the Gateway
instead of silently depending on defaults. `stt.language` was previously
unset in the example configuration, so a deployment that followed it ran
speech recognition on automatic language detection; the example now sets
`ja` with a note that it matters. The voice-activity-detection thresholds
and the safety cap on one utterance were previously fixed in code; both are
now settable under `audio`, with their defaults spelled out and a warning
against tuning them from guesswork. The recognized utterance and the final
reply can be logged for debugging behind `diagnostics.logTranscripts`, off
by default since that is conversation content; the existing timing
diagnostics are unconditional and never carry text. The sample agent
instructions now ask for plain sentences the robot's own speech engine can
pronounce.
