---
"stack-chan": minor
---

Make the standard firmware a Companion: boot greeting, quiet idle reactions, play menus, and grouped settings/diagnostics. Face taps start or stop conversations; head swipes remain dedicated to petting.

Add persisted Gateway/USB backend selection to the standard CoreS3 firmware and Web Preferences. Gateway microphone input downmixes PCM16 stereo to 16 kHz mono frames and runs half duplex, pausing during recognition and speech. Add named reaction/performance tools and default conversation personality.

The Web simulator uses the same firmware conversation flow with Gateway configuration, text controls, and optional browser microphone input. Physical hardware validation remains separate; full duplex, barge-in, AEC, and incremental speaker playback are future work.
