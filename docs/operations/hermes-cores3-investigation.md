# Hermes Desktop / CoreS3 conversation investigation (paused)

Status: work in progress; not a verified physical-device voice-conversation solution.
Paused at the user's request on 2026-09-20. No sub-agents were used.

## Implemented

- Optional Windows Hermes Desktop bridge using the local Desktop token handshake
  and `llm.oneshot`. It uses the configured auxiliary task provider, not necessarily
  the model selected in an existing Desktop chat. No existing chats or provider
  settings are changed; conversation history is held separately in Gateway memory.
- No agent tools, shell execution, MCP, delegation, or robot tool calling through
  this backend. Cancellation discards output locally but does not guarantee remote
  model computation stops.
- Hermes STT adapter and optional Hermes TTS/FFmpeg adapter. Existing Hermes Edge
  TTS returned HTTP 400 (no audio received), so the local setup uses Japanese
  Windows System.Speech instead. No provider credentials were copied to the robot.
- BLE helper for explicit-address conversation preference writes and acknowledgement
  checks. It does not alter Wi-Fi credentials. Microphone transmission is opt-in;
  the helper enables it and leaves automatic conversation start disabled.
- Optional Gateway diagnostics: incoming audio frame counts and maximum RMS every
  five seconds, without recording audio, transcripts, or tokens in these diagnostics.
- Temporary firmware diagnostics: boot-stage errors on screen and `Menu empty: N`
  when the drawer has no rendered children. These are diagnostic aids, not fixes.

## Verified

- Gateway build and 150 Node tests passed before the final handoff; see PR for the
  final rerun result. Tests cover isolated/bounded history, cancellation, loopback
  authentication, unrelated RPC notifications, and WAV input encoding.
- Live synthetic text through Gateway -> Hermes -> Japanese Windows TTS delivered
  a reply and 157 PCM audio chunks. This did not use a physical microphone.
- Windows-generated Japanese speech was accepted by Hermes local STT, but its
  transcript came back in English. Language/translation behavior remains unresolved.
- CoreS3 connected and authenticated over Wi-Fi; the screen reached the listening
  state. Conversation settings were written and acknowledged through BLE.
- Physical-device microphone packets arrived intermittently: observed windows had
  0-12 frames per five seconds, versus approximately 250 expected at 20 ms/frame.
  This is evidence of a problem, not proof of a particular root cause. Reconnection
  and duplicate-session replacement were also observed.
- Diagnostic firmware built, flashed, hash-verified, and reset successfully.
- User could later operate recording/playback diagnostics and hear the song.
  Recording takes about two seconds, and the recorded voice is intelligible with a
  **small high-pitched tone in the background**. Earlier assumptions that the beep
  replaced the voice or that recording was extremely slow were incorrect.

## Unresolved

- Physical conversation stays in the listening state instead of recognizing speech.
  Compare finite recording with the separate Gateway microphone implementation,
  capture scheduling, PCM framing, socket flow control, and server VAD/STT.
- Do not assume microphone hardware failure from the faint tone. Local recording
  and playback work intelligibly; song playback also works but uses a different
  output API from recorded PCM playback.
- Drawer sometimes opened without items while the face continued moving. Disabling
  the conversation backend did not restore it at that point. After the diagnostic
  reflash, the user could access recording/playback, but no boot-error text or menu
  count was reported. Root cause and repeatable recovery are not established.
- Temporary diagnostics need review/removal or conversion into opt-in supported
  diagnostics before a production merge. Do not treat this draft as a release fix.

## State left for resumption

- Stack-chan Gateway is stopped. Hermes Desktop itself was not stopped.
- Device `conversation.backend=none`, `conversation.autoStart=0`; Gateway endpoint,
  token, microphone preference and Wi-Fi credentials remain stored. Do not enable
  listening unexpectedly when resuming.
- The diagnostic firmware is still installed. No flash erase was performed during
  this investigation. Earlier removal of the legacy MiniStack MOD is separate.
- With explicit user approval, this PC's Wi-Fi profile was changed to Private and
  a TCP 8766 inbound firewall rule was added for its LAN address and LocalSubnet.
  That rule remains; it does not itself start a listener. Do not broaden it.
- Device token, runtime logs, Python dependencies, and generated firmware live in
  ignored build directories and are not included in the PR. Do not publish them.
- The machine-specific `gateway/scripts/allow-lan.ps1` is left locally, excluded
  from the portable PR. An existing line-ending-only theme change is also excluded.

## Next safe steps

1. Check the current device menu and diagnostic text before changing firmware.
2. Inspect/reproduce packet starvation with metadata-only diagnostics; avoid
   arbitrary gain or VAD-threshold changes without measured evidence.
3. Separate recorded input quality from the two playback implementations; test
   known PCM through the same player before diagnosing ADC hardware.
4. Confirm Japanese STT behavior without changing the user's global Hermes config.
5. Restore conversation mode only for an explicitly started test, then verify
   sustained capture, recognition, playback, cancellation and repeated start/stop.

Setup and limitations: [Hermes Desktop bridge](../../gateway/HERMES_DESKTOP.md).
