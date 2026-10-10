# Companion Mode

The standard M5StackChan CoreS3 build and WASM simulator share Companion behavior. Boot shows the face and requests a greeting after 800 ms. The greeting is skipped while another activity owns the robot. Quiet idle reactions run every 30–90 seconds, avoid repeating the previous reaction, and yield to conversations, MODs, mini apps, audio, and active reactions/performances. Head touch remains dedicated to petting; a face tap interrupts a speaking/recognizing Gateway response, otherwise starts/stops a configured conversation or triggers a standalone greeting/cheer.

The drawer groups conversation controls, play (greeting, song, dance, cheer, rock-paper-scissors), settings, and diagnostics. Existing camera, servo, LED, tone, and recording diagnostics remain available.

## Setup

In Web Preferences, select `conversation.backend`: `none` (default), `gateway`, or `usb`. Set `conversation.autoStart` to start the selected conversation after boot. For Gateway, supply `gateway.endpoint`, `gateway.deviceId`, `gateway.clientId`, and `gateway.token`. Enable `gateway.microphone` explicitly for voice input. Save and restart. AI provider credentials stay on the Gateway; the robot stores only its Gateway credential.

Set `companion.greetingOnBoot` or `companion.idleReactions` to `0` to disable autonomous character actions. A `none` backend needs no network. Dedicated USB diagnostic manifests retain their default backend and auto-start settings when no preference overrides them.

### Low-battery notice

`companion.lowBatteryNotice` (default on; unset means on) makes Companion watch the battery level on devices that can report it. Starting a few seconds after boot, the level is polled every 60 seconds. A single dropped or out-of-range reading is ignored, and a change of state needs two consecutive readings (a first reading that is already low is reported immediately). The hysteresis uses separate enter and recover levels, so a level hovering near the limit does not toggle.

- When the level becomes low, the robot plays one sleepy yawn and shows a short balloon (「電池が少ないよ…充電してね」 / "Battery low... please charge me") for a few seconds, then removes only that balloon. It is not shown again until the level has recovered and dropped again.
- The notice is only shown when the robot is free (no conversation, audio, MOD, or active reaction/performance). Otherwise it is kept pending and retried on the next poll.
- While low, idle reactions are spaced three times further apart and limited to the calm yawn. Conversation, menu and touch actions are not restricted.
- Devices without a battery reader (for example the WASM simulator) do nothing: no timer is created.
- Setting `companion.lowBatteryNotice` to `0` disables both the notice and the idle reduction, and no polling is performed.
- Charging state is not detected. Interaction with the planned bedtime mode (#67) is undefined and left for follow-up work.

Caveat for the original M5Stack (IP5306): the chip reports only five coarse levels, and the reader returns `0` for an unknown value. A unit powered only over USB may therefore be reported as low; turn the setting off for such units.

The setting is on by default because it only reduces motion, does nothing where the level is unavailable, and can be switched off.

Real-device confirmation of discharge behavior (record result and date):

| Device | Result |
| --- | --- |
| AXP2101 (CoreS3) | not yet verified |
| Core2 (AXP192/AXP2101) | not yet verified |
| IP5306 (original M5Stack), on battery and USB-only | not yet verified |

## Simulator verification

From `firmware/`, run `npm run build:wasm` using the pinned Moddable/Emscripten setup. From `web/`, run `npm run dev` and open `/simulator/`. The Conversation panel applies a Gateway endpoint/token and restarts the firmware. Start, send text, and stop through this panel. The browser transports JSON; session state, tool execution, gestures, and speech run in the same firmware Dock as CoreS3.

Use an echo Gateway for offline checks (see `gateway/README.md`). Browser microphone input is optional and requires permission and a secure browser context (localhost works). Enable it only when testing voice. Automated tests use synthetic input and localhost, without recording a physical microphone or calling a paid provider.

## Audio behavior and limits

CoreS3 input uses PCM16 at 16 kHz, averaging native stereo channels into 20 ms mono frames. Capture is half duplex: it runs only while listening and stops during recognition, replies, other local audio, disconnect, and deactivation. The mic resumes after local TTS or streamed Gateway audio playback actually finishes. A reply arriving after stop cannot restart it.

Gateway PCM output starts as frames arrive. The Piu-independent sink keeps at most 64 KiB of queued PCM and drains native AudioOut or browser Web Audio before listening resumes. Gateway TTS sends paced 20 ms packets; a reply can exceed the former six-second limit without buffering the whole turn. Overflow, agent errors, disconnect and deactivation stop output.

Tap the face during recognition/speech or use **応答を中断 / Interrupt response** in the Web panel to cancel the current response and return to listening. **Stop conversation** still ends the session. Both Gateway and firmware must support `response.cancel` / `response.cancelled`; no acknowledgement within five seconds reports a blocked state. Microphone capture stays off until acknowledgement and local speech cleanup complete. Full duplex, voice-triggered interruption and AEC remain future work.

Gateway defaults to a short Japanese tabletop-robot personality; `agent.instructions` overrides it. Named `stackchan.react` and `stackchan.perform` tools use `{ "name": "delighted", "intensity": 0.7 }` and `{ "name": "cheer" }`, matching firmware tool schemas.

## Separate physical-device acceptance

Hardware is not connected for this implementation. Track the acceptance checklist in [Issue #43](https://github.com/kumakumapon/stack-chan/issues/43). Before device release, validate the CoreS3 input channel polarity/level, intelligible STT, no speaker feedback, TTS completion timing, servo motion range, petting and tap behavior, Wi-Fi recovery, and repeated start/stop. Confirm USB mode after changing backends. CI checks release compilation and the generated CoreS3 linker module table, and the installer bundle stages that same release binary.
