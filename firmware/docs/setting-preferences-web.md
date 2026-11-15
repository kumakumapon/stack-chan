# Configure M5StackChan CoreS3 in a web browser

[日本語](./setting-preferences-web_ja.md)

M5StackChan CoreS3 is the supported device. Use a Web Bluetooth browser such as Chrome.
The connection uses BLE, so the device does not need Wi-Fi credentials first.

## Connect and save

1. Touch the device screen during startup and open Settings from the startup screen.
2. Open [Web Preferences](https://kumakumapon.github.io/stack-chan/develop/web/preference/), select **Connect with BLE**, and choose `STK`.
3. Review the values read from the device, edit them, and choose **Save settings**. Only changed fields are sent.
4. Restart the device after saving. Language, time zone, and volume also update in its settings screen immediately.

Editing is disabled during a save. Disconnecting resets the form; reconnect to read the device again.
The confirmed Wi-Fi clear action sends empty SSID/password values for offline boot.

## Settings

| Group | Settings |
| --- | --- |
| Wi-Fi | SSID, password, clear saved credentials |
| Appearance | Simple, dog, image, or small face; Japanese or English |
| Time | The same 17 fixed-offset time zones as the firmware, used for the clock and quiet hours |
| Speech synthesis | Service, volume, and fields used by that service |
| Conversation | Off, Gateway, or USB; startup connection. Endpoint, IDs, token, and microphone appear for Gateway |
| Companion | Boot greeting, idle reactions, low-battery notice, quiet-hours window |
| MOD settings | Expand for compatible AI MOD credentials/speech-recognition host and the MCP Server bearer token |

Time zones do not switch daylight saving time automatically. Volume is 0–1 in steps of 0.01 (1%).
Quiet-hour choices include the current stored minute value even if it is between the half-hour choices.

### Speech services

| Service | Fields in addition to volume |
| --- | --- |
| stackchan-voice | Normal/cute voice and integer speech rate (normal: 100) |
| VOICEVOX | Host, port, speaker ID |
| VOICEVOX Web (tts.quest) | Service token and speaker ID |
| Remote WAV | Host and port |
| ElevenLabs | Service token, voice ID, model |
| OpenAI | Service token, voice ID, model, speech rate (normal: 1), instructions for supported models |
| Local audio resources | None |

Switching services resets service-specific defaults and clears the previous provider's token.
These edits reach the device only when saved. Review the endpoint and credentials before saving.

AI MOD credentials apply to compatible MODs. Configure Gateway AI credentials and system instructions on the Gateway.
Some AI MODs share their speech-recognition hostname with the speech-synthesis host.

## Retired settings

The old driver selector, pan/tilt offsets, generic servo baud rate, nonexistent Google TTS option,
and unused AI system-role setting have been removed. The dedicated CoreS3 driver manages its
UART, zero positions, limits, and power. Existing stored preferences are not bulk-erased.

## Verification

`web/preference-contract.test.mjs` compares the web and firmware key contracts.
The CI pages suite exercises the built form and real BLE client against a UART/GATT emulator:
readback, changed-field saves, reconnect, conditional fields, 1% volume steps, and responsive layout.

WASM's `PreferenceServer` is a Bluetooth-free stub. WASM startup/regression tests and the browser
BLE-emulator tests cover different parts. Physical BLE roundtrips, real speech-provider calls,
and device clock/quiet-hours behavior still require separate device checks.
