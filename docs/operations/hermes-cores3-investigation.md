# Hermes Desktop / CoreS3 conversation investigation

Status: basic physical-device conversation confirmed by the user on 2026-09-21;
long-running stability remains unverified. No sub-agents were used.

## Latest conversation milestone (2026-09-21)

Latest review fixes (supersede the temporary limits described below): local TTS
now receives the complete reply, preserving kanji, numbers and text beyond 32
characters. Natural Japanese replaces the kana-only instruction. Unsupported
text still surfaces the selected engine's conversion error rather than silently
changing meaning. Gateway endpointing uses silence plus a 30-second received-audio
safety limit, splitting frames at the boundary without losing samples. Persistent
noise can therefore delay replies longer than before and needs physical testing.
Gateway tests: 157 passed; Gateway Dock: 57 passed. Earlier 10-turn, 15-minute,
restart and reboot user confirmations predate these two changes and do not validate
the new long-utterance/mixed-text behavior.

Follow-up fixes: the LED test now includes shared testing/implementation manifests
and uses timer return types compatible with its fake. The socket test selects the
actual text encoder manifest; socket types no longer require the whole bridge
dependency graph. Linux CI must confirm XS behavior (local Windows architecture
tests also contain unrelated path-separator assumptions).

Gateway regression tests now cover discarding short noise after VAD releases,
rejecting oversized individual audio frames, and discarding stale input when
reset occurs during manual overflow transcription. All 155 Gateway tests pass.
These changes do not tune VAD thresholds or remove the temporary three-second cap.

This section supersedes the historical pause records below.

- The user confirmed simple conversation after the latest CoreS3 firmware was
  built, flashed, hash-verified and reset. The working path uses Hermes recognition
  and replies with device-local StackchanVoice, not the still-problematic PC PCM
  playback path. Use `-Tts device` with the Hermes Desktop launcher.
- Microphone reads now reuse bounded mono PCM storage. Only `invalid size`
  rejections retry smaller sample-aligned reads; other errors still surface.
  The permanent on-screen microphone timing overlay was removed.
- The CoreS3 initial chunk allocation is 512 KiB. This and buffer reuse are
  mitigations, not proof that the reported memory exhaustion is permanently fixed.
- A stuck VAD submits bounded audio after three seconds. This temporary global
  limit can truncate longer utterances. Local speech filtering removes kanji,
  Latin letters and digits and truncates to 32 characters; it can change meaning.
  Kana-only reply instructions are also temporary and apply to the Gateway dock.
- Japanese STT was configured in this PC's Hermes settings, outside the repository.
  Credentials, recordings, runtime logs and machine-specific settings are excluded.
- Gateway tests: 152 passed. Gateway Dock tests: 56 passed, including four pure
  microphone-read tests. Test TypeScript compilation and changed-code checks passed.
  Native read behavior and extended conversation still need hardware soak testing.
- Remaining checks: repeated start/stop and reboot, long conversations, recognition
  accuracy, response latency, and recurrence of memory, Mic read, socket-full or
  text-to-koe conversion (105) errors. Other hardware has not been validated.
- This milestone is included in draft PR #46; it is not a production-ready release.

## Latest pause state (2026-09-21)

This section supersedes the historical pause state below.

- The user confirmed reboot no longer shows the LED boot error. The underlying
  intermittent I2C fault is not proven fixed, and a complete voice conversation
  has not yet succeeded.
- The user identified the intermittent microphone send failure as `socket-full`.
  The latest bounded backpressure change was built, flashed with hash verification,
  and reset successfully, but the user paused before physically retesting it.
  Recovery on the device is therefore unverified; capture pauses can lose audio.
- Gateway Dock Node tests: 51 passed sequentially. Native socket and LED behavioral
  tests passed using Node substitutes, not XS; local xst crashes even on a trivial
  program. The earlier Gateway server run passed 150 tests.
- The test Gateway process was stopped for this pause. Hermes Desktop was left
  running. Device preferences remain `conversation.backend=gateway`, `autoStart=0`,
  and `gateway.microphone=1`: conversation is manually started, not disabled in
  preferences. Endpoint, credentials, Wi-Fi, and the existing scoped firewall rule
  were retained. Temporary on-device diagnostics remain installed.
- Resume with a short physical microphone/conversation test of this flashed build.
  Check queue recovery versus send-wait timeout and actual received frame counts;
  do not assume either performance improvement or successful dialogue yet.
- Follow-up is tracked in issue #45 and draft PR #46. Keep the PR draft; overall
  release impact remains minor for the experimental backend, with patch changesets
  for the subsequent firmware fixes.

## Resumed: boot failure

- User reported `Boot context: write failed` after restarting and authorized
  disabling the legacy MiniStack MOD if it conflicts.
- This stage is inside `createStackchanContext`, before mini-app registration
  and context-created menu behaviors. It does not identify the failing component
  or establish a MOD conflict. Earlier records say the legacy MOD was removed;
  current presence still needs confirmation on the device.
- Added temporary per-component boot-stage reporting and `MOD: present/none`
  on the error screen. Initialization order and failure handling are unchanged.
- The local ESP32 SDK can emit this exact message for I2C writes (among other
  operations); hardware bus failure is a candidate, not a confirmed root cause.
- Conversation remains disabled while investigating boot. No preferences or MOD
  partitions have been erased during this resumed investigation.

### LED initialization failure isolated

- After another reboot the user confirmed `Boot led: write failed` and
  `MOD: none`. This identifies the LED construction stage, not a legacy MOD
  conflict. The physical cause of the intermittent write failure remains unknown.
- `PY32Led` guarded expander discovery but not its subsequent configuration and
  initial clear. Those writes could throw before context/menu registration.
- Guarded the entire LED configuration/initial clear; on failure only this LED
  instance becomes inert until reboot. The shared expander is not closed or reset
  because the servo driver also uses it. Healthy initialization is unchanged.
- Added an XS-compatible behavioral regression manifest covering every initial
  write, inert operations/effects after failure, shared-bus preservation, and
  healthy/recovered construction. Nine injected write failures passed with the
  real LED/expander implementations and fake SMBus/timer under Node after type
  stripping. Native Windows `xst.exe` crashed with access violation even for a
  trivial print, so this is not an XS runtime test pass. Biome checks passed.
- The same regression test reproduced the uncaught `write failed` against the
  pre-fix implementation. The patched CoreS3 firmware built and was flashed on
  COM3 with hash verification and reset; on-screen results await user confirmation.
- This contains boot failure; it does not fix the underlying bus fault, guarantee
  physical LEDs are off after a partial write, or handle later runtime LED errors.
  Repeated physical reboot verification is still required.

### Resumed conversation transport investigation

- User subsequently confirmed reboot without the LED boot error. Physical LED
  communication recovery itself is not confirmed.
- Found a separate Gateway socket defect: payload-only subtraction ignored the
  native WebSocket client's returned remaining payload capacity (which accounts
  for frame/mask overhead). Queued writes could exceed the native capacity.
- Changed the adapter to use the write return value and report failures while
  draining queued frames in `onWritable` through the normal disconnect callback.
- Added an XS-compatible socket regression manifest. Under Node with only types
  stripped and TextEncoder mapped, the pre-fix adapter reproduced capacity
  overflow; the fixed adapter passed backpressure/resume and asynchronous failure
  notification/close checks. XS runtime execution remains unavailable on this PC.
- Gateway build and all 150 tests passed again. Live voice improvement is not yet
  verified; the Hermes backend was not detected during the initial resumption
  check. User was asked to start Hermes and open the robot's startup BLE Settings.

### Live retry on 2026-09-21

- Hermes Desktop was found on loopback port 53000. Started the LAN Gateway with
  metadata-only diagnostics (node PID 30092 at start, TCP 8766). Logs are ignored
  `gateway/dist/hermes-resume-20260921.log` and `.error.log`.
- Restored conversation preferences over BLE with acknowledgements for every key;
  autoStart remains 0. BLE dependencies require the installed CPython 3.11, not
  the default Miniforge Python. Wi-Fi settings were not changed.
- After manual conversation start the user still reported the listening state.
  Gateway received only 0-15 audio frames per five seconds, with reconnects and
  session replacement. Thus the socket fix did not resolve the live starvation.
- Added temporary on-screen microphone counters: elapsed seconds, C (readable
  callbacks), F (frames produced), P (maximum read/frame/send processing ms).
  These contain no audio/transcripts and are removed when capture stops. Compare
  device counters with Gateway arrivals before altering gain or VAD thresholds.
- User read the first counter screen as `10 12 123 7518` (display was difficult
  to read), provisionally corresponding to 10s, 12 callbacks, 123 frames and
  7518ms maximum processing time. Treat this transcription as provisional.
- Expanded the diagnostic to six white-background, 24px-font rows. READ measures
  native read time, FRAME measures remaining framing time excluding nested
  encoding/send, BASE64 and SEND sum their time within each readable callback,
  TOTAL measures the whole callback. Each displayed value is its own maximum
  since capture started, so displayed maxima need not sum to TOTAL. SEND is
  synchronous submission time, not network delivery latency. No capture format,
  gain, VAD threshold or framing algorithm was changed for this measurement.

### PCM processing optimization

- User confirmed READ=129ms, FRAME=2841ms, BASE64=1952ms, SEND=3159ms and
  TOTAL=7800ms on the expanded screen. These are independent per-callback maxima,
  not a single additive breakdown. They include synchronous processing only.
- Replaced per-byte grow/shrink arrays in the framer with bulk mono copies and
  fixed stereo carry storage; completed frame buffers are transferred without
  copying. Stereo averaging and arbitrary-byte chunk semantics are preserved.
- Prefer native Uint8Array.toBase64 when present (confirmed in the local XS SDK);
  fallback joins encoded groups once. Fast-path printable ASCII envelope byte
  counting through a native regexp, retaining UTF-8 accounting for other data.
- PCM/bridge regression tests: 25 passed, including independent reference mixing,
  multiple-frame ownership, arbitrary chunk/view boundaries, native/fallback
  Base64 equivalence and exact ASCII/Japanese/emoji outbound limits. Firmware
  test TypeScript compilation and targeted Biome checks passed.
- Keep expanded on-device timing visible to measure actual effect after flashing.
  No claim of live voice recovery or measured speedup yet; input format and VAD
  thresholds are unchanged.

### Intermittent microphone send failures after optimization

- User reports intermittent `Microphone send failed`. Gateway shows batches of
  35-51 frames followed by zero-frame intervals and reconnects; this does not
  prove whether queue capacity or a transport exception caused each failure.
- Added local `lastSendFailure` categories to the bridge and changed the blocked
  message to `Mic send: bridge-full/socket-full/write-error/disconnected`.
  Capture the category before stopping the microphone, since shutdown may send
  another control message. No payload, token or arbitrary remote error text is
  exposed in this display. Queue limits and recovery behavior are unchanged.
- Diagnostic category/reset tests added. Gateway Dock tests: 47 passed with
  `--test-concurrency=1`; an initial parallel run failed in pcm-stream test setup,
  so do not report that parallel run as passing. Targeted Biome and test TypeScript
  compilation passed. Physical failure category is still awaiting observation.

### Confirmed socket-full and bounded backpressure handling

- User observed `socket-full`, identifying the local WebSocket adapter's 32 KiB
  queue limit. This confirms the immediate failure, not why transport drains
  slower than capture.
- Socket capacity rejection now returns false without accepting the frame or
  closing the connection. The bridge releases its provisional byte accounting
  and reports overflow without scheduling a reconnect.
- Microphone input pauses with only the first unaccepted frame retained. Polls
  retry that frame with its original sequence, then resume capture on acceptance.
  Further callbacks while paused are not buffered; capture during a pause can be
  lost. This is bounded backpressure, not a lossless recording guarantee.
- At most 250 scheduled retry polls are attempted (nominally 20ms apart, not a
  strict five-second deadline when the device is busy). Persistent blockage
  reports `Mic send: send wait timeout` instead of accumulating audio indefinitely.
- Input stop/disconnect/deactivation drops retained audio and unsent audio entries
  in the adapter while preserving control entries. Bytes already handed to TCP
  cannot be recalled. Queue capacity is unchanged.
- Gateway Dock regression tests: 51 passed sequentially. Real adapter tests with
  fake native transport passed under Node after type stripping, including capacity
  rejection, no disconnect, selective audio clearing and resume. Native XS runner
  remains unavailable; live recovery still needs user verification.

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
