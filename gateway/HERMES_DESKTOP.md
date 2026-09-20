# Local Hermes Desktop bridge (Windows)

This optional launcher connects to a running Hermes Desktop backend, without
changing its configuration, accessing provider keys, or reusing existing chats.
It uses Desktop's loopback token handshake and `llm.oneshot` JSON-RPC method.
Conversation history is isolated in Gateway memory (last six completed turns).
The Hermes auxiliary task model/provider is used, which may differ from the model
selected in a Desktop chat. Existing provider usage limits and charges still apply.

This is a **conversation-only** bridge: no Hermes agent tools, shell, MCP,
delegation, or robot tool calls. Cancellation drops local output and closes the
request socket; it does not guarantee cancellation of remote model computation.
Do not expose the Hermes backend to the LAN. The bridge only accepts a literal
`http://127.0.0.1:PORT/` Hermes URL and never logs its credential.

## Run

From `gateway/`, run `npm run build`, then:

```powershell
./scripts/start-hermes-desktop.ps1 -ListenHost YOUR_LAN_IP
```

The script discovers the running local Hermes `serve` process. If discovery is
ambiguous, pass `-HermesUrl http://127.0.0.1:PORT/`. It runs in the foreground;
Ctrl+C stops it. Default bridge port: 8766 (8765 may be in use). Limit any Windows
Firewall exception to this port, the Private profile, and the local subnet.
Use only a trusted LAN; remote deployment requires TLS.

The robot credential is generated once in ignored `dist/runtime/device-token`.
Do not commit or publish it. Rebuilding preserves it; deleting `dist/` does not.
Set `conversation.backend=gateway`, the bridge URL, device/client IDs, and that
credential in the robot's startup Settings BLE screen. `gateway.microphone=1`
enables microphone transmission while listening; leave autoStart disabled until
you deliberately start the conversation. Wi-Fi credentials are not modified.
The optional BLE helper requires `bleak`; it discovers STK devices by default and
only writes when given an explicit `--address` and `--endpoint`.

## Audio

The Windows launcher uses installed Japanese System.Speech voices (offline) and
Hermes's configured STT via `/api/audio/transcribe`. Audio is PCM16 mono, 16 kHz.
The Python/local STT model may need a cold start. Recognition language/translation
depends on existing Hermes configuration; this bridge does not alter it.

The Node launcher can instead use Hermes TTS and FFmpeg (omit `STACKCHAN_TTS=windows`).
Set `FFMPEG_PATH` if FFmpeg is not on PATH. TTS is synthesized before paced delivery;
this is not token-streamed speech. Hermes audio provider failures are surfaced,
not silently replaced with a paid service.

Live microphone quality, feedback, and repeated start/stop must be verified on
the physical CoreS3 separately from synthetic-audio and mocked transport tests.
