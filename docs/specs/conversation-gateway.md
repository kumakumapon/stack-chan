# Conversation Gateway

日本語版: [conversation-gateway_ja.md](./conversation-gateway_ja.md)

## Purpose

Stack-chan's conversation stack splits into four layers:

```text
Stackchan = body + UI + sensors
Gateway   = conversation infrastructure
Agent     = the brain
MCP       = hands into the outside world
```

`Stackchan` is the firmware: microphone, speaker, face, servos, touch panel,
camera and LEDs. `Gateway` is a resident service — the `gateway/` package at
the repository root — that owns sessions, the media plane, the tool registry
and the approval handshake. `Agent` is whatever intelligence answers a
conversation: an offline echo backend for testing, OpenAI's Chat Completions
API, or any HTTP + NDJSON agent that implements the Hermes wire contract.
`MCP` is how an Agent reaches tools outside the robot (GitHub, calendars, home
automation, ROS, ...).

The goal is that Stack-chan is never bound to one LLM, one cloud or one agent
framework. Swapping OpenAI for a local model, or adding a new Agent Backend,
is a Gateway-side config change; the firmware never learns about it, because
it never talks to the Agent directly. See `gateway/README.md` for the
package's own quick-start and layout; this document is the protocol and
behavior spec.

## Design decision: the Gateway is a Dock over WebSocket

The firmware already had a Dock protocol for exactly this shape of problem:
the Android USB Dock exchanges audio and control with an external Realtime
session over USB, using two wire contracts that predate this feature:

- `stackchan.event.v1` — `conversation.start/stop/result`, `approval.*`,
  `task.status` (`firmware/host/app/remote-session/application-event.ts`).
- a realtime control plane shaped like the OpenAI Realtime API —
  `session.created`, `session.update`/`session.updated`,
  `response.function_call_arguments.done`, `conversation.item.create`,
  `response.create` (`firmware/host/app/remote-session/realtime-session.ts`).

The Conversation Gateway speaks **exactly those same two contracts**, over
WebSocket instead of USB. Concretely:

- `gateway/src/protocol/stackchan-event-v1.ts` is a Gateway-side mirror of the
  device's `stackchan.event.v1` codec.
- `gateway/src/protocol/realtime-control.ts` is a Gateway-side implementation
  of the same realtime control plane the Android USB Dock speaks.

Because the wire shapes are unchanged, `RemoteConversationSession`,
`createRealtimeSession()` (in `realtime-session.ts`) and
`createRemoteSessionRuntime()` (in `firmware/host/app/remote-session/runtime.ts`,
via `firmware/host/app/remote-session/conversation-session.ts`) are reused by
the Gateway Dock without a line changed. Direct-mode `ChatService` sessions are
untouched: a target's MOD picks exactly one Dock, and the Gateway Dock
(`firmware/host/app/docks/gateway/`) only starts when
`conversation.backend = 'gateway'` and a Gateway endpoint is configured.

**The consequence the issue did not anticipate:** device-hosted embodiment
tools (`stackchan.say`, `stackchan.face.setEmotion`, ...) need no new message
type of their own. The issue's sideband candidate list included `tool.request`
/ `tool.result`, but those turned out to be unnecessary — the robot already
had a channel for exactly this: it advertises the tools it can run in
`session.update` (built by `firmware/host/app/realtime-tools.ts`, a
`RealtimeToolProvider`), and the Gateway invokes one with
`response.function_call_arguments.done`, the same event the USB Dock's Android
peer already sends. `gateway/src/conversation/conversation-session.ts` treats
`session.update` as the source of truth for which device tools exist at all
(see [Tools and approval](#tools-and-approval)).

That reuse has one required detail: `functionCallArgumentsDone()`
(`gateway/src/protocol/realtime-control.ts`) stamps every function call with
`stackchan_session_update_id`, set to the `event_id` of the `session.update`
that advertised the tool. The device
(`firmware/host/app/remote-session/realtime-session.ts`, `executeFunction()`)
discards a call whose `stackchan_session_update_id` does not match the
`session.update` it most recently acknowledged. This closes a race: if the
device's tool provider changes (a new `session.update`) while a call from the
previous generation is still in flight, the device drops the stale call
instead of running a tool against a provider that has already been replaced.

Only what `stackchan.event.v1` and the realtime control plane genuinely lack —
the session handshake, capability negotiation, the media plane, transcripts
and agent errors — lives in a new sideband schema, `stackchan.gateway.v1`,
described next.

## `stackchan.gateway.v1` sideband

Defined in `gateway/src/protocol/stackchan-gateway-v1.ts` (Gateway side) and
mirrored in `firmware/host/modules/conversation/gateway/gateway-protocol.ts`
(device side). `STACKCHAN_GATEWAY_PROTOCOL_VERSION` is `1`. Every message
carries `schema: 'stackchan.gateway.v1'` and a `type`.

| type | direction | required fields |
| --- | --- | --- |
| `session.hello` | device → gateway | `protocolVersion`, `deviceId`, `clientId`, `capabilities` (`audioInput`, `audioOutput`, `embodiment`, `approval`); `token` optional |
| `audio.input` | device → gateway | `seq`, `payload` (base64 PCM16 frame) |
| `audio.input.end` | device → gateway | `seq` |
| `text.input` | device → gateway | `text` |
| `session.ready` | gateway → device | `protocolVersion`, `sessionId`, `audio.input`, `audio.output`, `features` (`audioInput`, `audioOutput`, `approval`, `tools`) |
| `transcript.input` | gateway → device | `text`, `final` |
| `transcript.output` | gateway → device | `text`, `final` |
| `audio.started` | gateway → device | `responseId`, `format` |
| `audio.chunk` | gateway → device | `responseId`, `seq`, `payload` (base64 PCM16 frame) |
| `audio.completed` | gateway → device | `responseId` |
| `agent.error` | gateway → device | `code`, `message`, `fatal` |
| `robot.directive` | gateway → device | `directive`, `params` |

`GatewayAudioFormat` is `{ codec: 'pcm16', sampleRate, channels }` throughout;
V1 only ever negotiates `codec: 'pcm16'`. `GatewayErrorCode` is one of
`unauthorized`, `unsupportedProtocol`, `unsupportedAudioFormat`,
`agentUnavailable`, `sttFailure`, `ttsFailure`, `toolFailure`, `internal`.

`robot.directive` is documented as the fire-and-forget variant for directives
that expect no result — the schema exists on both sides, but nothing in this
change sends or handles it yet (see
[What is implemented and what is not](#what-is-implemented-and-what-is-not)).
Device-hosted tool calls are explicitly **not** part of this schema; they ride
the realtime control plane described above.

### Independently maintained mirrors

`gateway/src/protocol/stackchan-gateway-v1.ts` and
`firmware/host/modules/conversation/gateway/gateway-protocol.ts` are two
separate files with near-identical bodies, not a shared package. The firmware
copy is deliberately free of Node types and any non-XS API, because it has to
compile and run on the Moddable XS runtime; the Gateway copy runs under
Node.js. The header comment in each file says explicitly to keep the wire
shapes byte-identical across the pair when either side changes. The analogous
statement holds for `stackchan.event.v1`: the Gateway's mirror
(`gateway/src/protocol/stackchan-event-v1.ts`) is pinned against the device's
own copy (`firmware/host/app/remote-session/application-event.ts`) by
`gateway/src/protocol/contract.test.ts`, which asserts the shared wire
constants match.

## Handshake and capability negotiation

1. The device opens a WebSocket to the Gateway's configured endpoint and sends
   `session.hello` with its `deviceId`, `clientId`, optional `token`, and
   `capabilities` (the audio formats it can send/play, the embodiment tool
   names it hosts, and whether it can present an approval UI).
2. `gateway/src/server/device-session.ts` (`handshake()`) validates the
   message in order:
   - **Protocol version.** If `hello.protocolVersion` is newer than the
     Gateway's `STACKCHAN_GATEWAY_PROTOCOL_VERSION`, the Gateway refuses with
     `agent.error(code: 'unsupportedProtocol', fatal: true)` and closes the
     socket (WebSocket code `1008`). The device-side bridge
     (`firmware/host/modules/conversation/gateway/gateway-bridge.ts`) applies
     the symmetric check on `session.ready`: if the Gateway's
     `protocolVersion` is newer than the device's own constant, the bridge
     flips `transportState` to `unsupported` and synthesizes the same
     `agent.error` locally, without ever reaching `session.ready`'s normal
     handling.
   - **Authentication.** `options.authenticate(...)` is called with
     `deviceId`, `clientId` and `token`; a rejection sends
     `agent.error(code: 'unauthorized', fatal: true)` and closes the socket.
     See [Security](#security) for how tokens are compared.
   - **Audio format negotiation.** `negotiateAudioFormat()` picks the first
     format the device offered (in `hello.capabilities.audioInput` /
     `audioOutput`) that the Gateway also supports, checking `codec`,
     `sampleRate` and `channels` for an exact match. An empty intersection on
     either direction sends `agent.error(code: 'unsupportedAudioFormat',
     fatal: true)` and closes the socket.
3. On success the Gateway creates a session id, builds a fresh tool registry
   and `ConversationSession`, then sends `session.ready` with the negotiated
   `audio.input`/`audio.output` formats and `features`. `features.audioOutput`
   is `true` only when the configured TTS adapter's name is not `'null'` —
   this is the flag the device uses to decide who speaks (see
   [Media plane](#media-plane)). `features.approval` echoes back whatever the
   device claimed in its `capabilities.approval`.
4. Only after `session.ready` does the Gateway open the realtime control
   plane, sending `session.created`. The device answers with `session.update`,
   which is what advertises its embodiment tools and lets the conversation
   actually start handling tool calls.

A second `session.hello` on an already-handshaken connection is ignored (it is
a protocol error, logged and dropped, not treated as a reset). A message of
any kind that arrives before the handshake completes is likewise dropped with
a log line rather than causing an error.

## Conversation state

The Gateway and the firmware share one state machine,
`RemoteConversationState`: `standby / connecting / listening / recognizing /
speaking / blocked`. It is defined in both protocol mirrors
(`stackchan-event-v1.ts` on each side) and is the same enum the Android USB
Dock has always reported.

**Gateway side.** `gateway/src/conversation/conversation-session.ts` drives
this machine explicitly: `connecting` while the Agent session is being
created, `listening` once it is up, `recognizing` when a final input
transcript or a `text.input` arrives, `speaking` while assistant audio or a
final output transcript is being delivered, back to `listening` when a turn
ends, and `blocked` on a fatal `agent.error` (from which only a fresh
`conversation.start` can recover, via `conversation.result`).

**Device side.** A USB Dock gets its state from a single status byte pushed
over the wire (`onStatusChanged(status: number)` in
`firmware/host/app/docks/android-usb-audio/runtime.ts`, mapped by
`usbAudioConversationState()`). The Gateway Dock has no such byte: it derives
the state itself from the `stackchan.gateway.v1` sideband it is already
receiving. That mapping lives in `gatewayConversationState()`
(`firmware/host/app/docks/gateway/runtime.ts`):

| sideband message | resulting state (unless already `standby`/`blocked`) |
| --- | --- |
| `transcript.input` | `recognizing` |
| `transcript.output` | `speaking` |
| `audio.started` | `speaking` |
| `audio.completed` | `listening` |
| `agent.error` with `fatal: true` | `blocked` |
| anything else | no change |

The guard against `standby`/`blocked` matters both ways: once the
conversation is fully stopped or has faulted, sideband traffic (e.g. a
late-arriving `audio.completed` for a turn that was already torn down) cannot
silently resurrect a state transition. The function is exported specifically
because, per its own comment, "this mapping is the contract between the two
planes, and a regression here is invisible in every other test."

## Media plane

V1's only audio format is PCM signed 16-bit little-endian, mono, negotiated at
16 kHz by default (`DEFAULT_INPUT_AUDIO_FORMAT` / `DEFAULT_OUTPUT_AUDIO_FORMAT`
in `stackchan-gateway-v1.ts`), carried as base64 text inside the same JSON
envelope as everything else — there is no binary WebSocket framing in V1.
`gateway/src/server/gateway-server.ts` drops any binary frame it receives with
a log line rather than attempting to parse it.

On the Gateway, `gateway/src/conversation/audio-session.ts` buffers incoming
`audio.input` frames, runs them through an energy-based VAD
(`gateway/src/audio/vad.ts`, hysteresis between an activation and a release
RMS level plus a hangover window) to find utterance boundaries, and hands a
completed utterance to the configured `SttAdapter`
(`gateway/src/audio/stt.ts`) to turn into text. `audio.input.end` also flushes
whatever is buffered, for the case where the device (rather than the Gateway's
VAD) is the one delimiting the turn. The resulting text is fed to the Agent as
a normal input turn, exactly like `text.input`.

The full loop the issue described — **VAD → STT → Agent → TTS** — is real on
the Gateway side: `conversation-session.ts` turns the Agent's `text`/`audio`
events into `transcript.output` plus either streamed `audio.chunk`s (if the
Agent produces audio itself) or a call to the configured `TtsAdapter`
(`gateway/src/audio/tts.ts`) that synthesizes the final text and streams the
result as `audio.started` / `audio.chunk` / `audio.completed`.

**When the Gateway has no TTS adapter** (`tts.type: none`, the default), the
adapter is `createNullTts()`, whose `synthesize()` yields no chunks at all.
`session.ready.features.audioOutput` is then `false`, and the Gateway sends
only `transcript.output` — the robot is expected to speak it with its own
local TTS. This is exactly how the Phase 0 text MVP works end to end with zero
audio infrastructure on either side. The Gateway Dock's presentation layer
(`firmware/host/app/docks/gateway/presentation.ts`) implements this contract:
it starts in "speak locally" mode by default, and `runtime.ts` re-reads
`features.audioOutput` on every `session.ready` to flip `setSpeakLocally()`
accordingly — the Gateway decides who speaks, per session, not a static
device config flag.

## Tools and approval

`gateway/src/tools/tool-registry.ts` keeps one merged tool set per
conversation, `ChatTool`-compatible so the same tool description can serve a
Direct-mode `ChatService` session and a Gateway-mode Agent session
(`gateway/src/tools/tool-types.ts`). Tools are `gateway`-hosted or
`device`-hosted (`ToolHost`):

- **Gateway-hosted** tools run in the Gateway process: MCP servers reached
  through `gateway/src/tools/mcp-adapter.ts` (enabled with `tools.mcp: true`
  and a `tools.servers` list in config) plus any built-ins.
- **Device-hosted** tools run on the robot itself, invoked over the realtime
  control plane described above. The canonical eight are the embodiment tools,
  defined once with rich JSON-Schema parameters in
  `gateway/src/tools/stackchan-tools.ts` and implemented on the device in
  `firmware/host/app/realtime-tools.ts`:

  | tool | parameters |
  | --- | --- |
  | `stackchan.say` | `text` (string, required) |
  | `stackchan.face.setEmotion` | `emotion` (string enum, required): `neutral`, `angry`, `sad`, `happy`, `sleepy`, `doubtful`, `cold`, `hot` |
  | `stackchan.motion.setPose` | `yaw` (number, required), `pitch` (number, required), `durationSeconds` (number) |
  | `stackchan.motion.lookAt` | `x`, `y`, `z` (number, all required) |
  | `stackchan.light.set` | `r`, `g`, `b` (number, all required), `durationMs` (number) |
  | `stackchan.camera.capture` | (no parameters) |
  | `stackchan.react` | `name` (reaction enum, required), `intensity` (0–1) |
  | `stackchan.perform` | `name` (performance enum, required), `intensity` (0–1) |

  The gateway-side schema in the table above is the one an Agent actually
  sees; the device's own `realtime-tools.ts` implementation additionally
  accepts an optional `volume` on `stackchan.say`, structures
  `stackchan.motion.setPose` as `position {x,y,z}` / `rotation {r,p,y}` plus
  an optional `time`, and adds an optional `led` name and `on`/`duration` to
  `stackchan.light.set`. `mergeDeviceTools()` (`stackchan-tools.ts`)
  reconciles the two: **the device's own advertisement always wins for which
  tools exist**, and the canonical schema only fills in a richer
  description/parameters for a name the device also advertised. A canonical
  schema for a tool name the device did **not** advertise is dropped
  entirely — the Gateway never offers the Agent a body part the robot does
  not actually have. `realtime-tools.ts` enforces the same rule from the
  device side: each tool is included in `session.update` only when the
  capability it needs exists on that build's `StackchanContext` (e.g. no
  `stackchan.light.set` is advertised unless `context.lighting` and an LED are
  present).

Anything with a side effect can be put behind approval with
`tools.requireApproval` in the Gateway config, matching a tool name exactly or
by a trailing `*` wildcard, split into `command` and `fileChange` kinds
(`toolPermissionFor()` in `tool-registry.ts`). When a tool's resolved
permission is not `safe`, `gateway/src/tools/tool-invoker.ts` routes the call
through `gateway/src/approval/approval-controller.ts` before running it:

1. `approval.request` is sent to the device (`requestId`, `kind`, `title`,
   `summary`, a JSON `detail` truncated to 2000 characters by default with
   `truncated: true` if so).
2. The device answers `approval.presented` when it has shown the request to
   the operator, then `approval.response` with `decision: 'approve' |
   'decline'`.
3. The controller sends `approval.resolved` and settles the pending call:
   `approve` runs the tool, `decline` returns a declined outcome without
   running it. No response within `approvalTimeoutMs` (default 120 000 ms,
   configurable per Gateway) sends `approval.suspended` instead and declines
   the call, so a caller can never hang forever.

Independent of approval, every tool invocation is bracketed in
`task.status(state: 'running')` / `task.status(state: 'idle')`
(`beginTask()` in `approval-controller.ts`), whether or not it needed
approval — this is the signal the robot uses to show "the Agent is doing
something" activity.

## Configuration

**Device side** (`firmware/host/modules/conversation/gateway/gateway-config.ts`,
type `GatewayConfig`), read from the host's `gateway` config block or enabled
by a MOD via `resolveGatewayConfig()`:

| key | meaning |
| --- | --- |
| `enabled` | Starts the Gateway Dock at all. A MOD can force this on even if the host config leaves it off. |
| `endpoint` | A `ws://` or `wss://` URL; parsed into host/port/path by `parseGatewayEndpoint()`, defaulting port to 80/443 and path to `/`. |
| `deviceId` | This robot's stable id, sent in `session.hello`. |
| `clientId` | The client instance id, also sent in `session.hello`. |
| `token` | Optional device token; see [Security](#security). |
| `autoStart` | Activates the remote conversation session as soon as the Stack-chan context is created, instead of waiting for a head-touch gesture. |
| `presentationEnabled` | Whether the Dock renders its own balloon/TTS presentation at all (`false` disables it, e.g. for a MOD that presents differently). |
| `microphone` | Opt-in microphone streaming over the gateway media plane; default off (see [What is implemented and what is not](#what-is-implemented-and-what-is-not)). |

`endpoint`, `deviceId` and `clientId` are all required to activate; a missing
one fails fast at Dock start-up with the specific field named
(`requireGatewayIdentity()`), rather than opening a socket the device cannot
identify itself on.

**Gateway side**: see `gateway/gateway.example.yaml` and
`gateway/src/config.ts` for the full schema — `gateway.listen`, `gateway.token`
/ `gateway.devices`, `agent.*`, `stt.*`, `tts.*`, `tools.*`. Every string value
in the YAML may reference an environment variable as `${NAME}`, and an unset
reference fails at start-up rather than silently becoming empty.

**LLM credentials stay on the Gateway.** The device config above has no field
for an OpenAI key, a Hermes endpoint token, or any other cloud credential —
those live only in the Gateway's own config (`agent.apiKey`, `stt.apiKey`,
`tts.apiKey`, `tools.servers[].token`, ...). The robot's Gateway-side identity
is limited to its URL, device id and Gateway token.

## Security

- **Constant-time token comparison.** `gateway/src/server/authenticator.ts`
  compares the presented token against the expected one with
  `node:crypto`'s `timingSafeEqual`, and on a length mismatch still runs a
  same-cost comparison against itself so the answer does not leak information
  through timing.
- **Per-device token overrides the shared one.** A device listed in
  `gateway.devices` with its own `token` is checked against that token only;
  a shared `gateway.token` is the fallback for devices with none, so revoking
  one robot never requires rotating the whole fleet's credential.
- **`wss://` is expected off a trusted LAN.** The Gateway server itself speaks
  plain WebSocket; TLS termination is expected to happen in front of it (a
  reverse proxy or load balancer), not inside `gateway-server.ts`.
- **Tool permission policy.** `tools.requireApproval` (see
  [Tools and approval](#tools-and-approval)) is the mechanism for keeping
  side-effecting tools — shell commands, file writes, anything reaching an
  external service — behind the robot's own approval UI rather than letting
  an Agent run them unattended.
- **`requestId` tracing.** Every `stackchan.event.v1` message and every
  approval carries a `requestId`, so a conversation and the tool calls it
  triggered can be correlated end to end in logs.

## What is implemented and what is not

**Implemented:**

- The full `stackchan.gateway.v1` control plane (handshake, media plane,
  transcripts, agent errors) and reuse of the existing `stackchan.event.v1`
  and realtime control plane, on both the Gateway and the firmware.
- The `session.hello` → `session.ready` handshake, including protocol-version
  refusal in both directions and PCM audio-format negotiation.
- Text conversations end to end: `text.input` or Gateway-side STT → Agent →
  `transcript.output`, with the device speaking locally when the Gateway has
  no TTS adapter configured. This is the Phase 0 path, and it needs no audio
  transport at all.
- Device-hosted embodiment tools: `stackchan.say`, `stackchan.face.setEmotion`,
  `stackchan.motion.setPose`, `stackchan.motion.lookAt`, `stackchan.light.set`,
  `stackchan.camera.capture`, advertised conditionally on what the device's
  `StackchanContext` actually supports and invoked over the realtime control
  plane.
- Gateway-hosted MCP tools via `tools/mcp-adapter.ts`.
- Approval: the full `approval.request → presented → response → resolved`
  handshake, with `approval.suspended` on timeout, and `task.status`
  bracketing every tool call.
- Three Agent Backends: `echo` (offline, deterministic, also the integration
  test double), `openai` (Chat Completions with tool calling), and `hermes`
  (any HTTP + NDJSON agent implementing the contract in
  `gateway/src/agent/hermes-backend.ts`).
- Gateway-side audio pipeline: energy-based VAD, an `SttAdapter` /
  `TtsAdapter` pair (OpenAI-backed or a null passthrough), and PCM resampling
  on the way out to match the negotiated output format.
- Device-side reconnect with exponential backoff
  (`gateway-bridge.ts`: 1 s initial delay doubling up to 30 s), so a dropped
  WebSocket recovers without operator intervention.
- Device-side playback of a streamed assistant turn: `presentation.ts`
  buffers `audio.chunk` payloads and plays them as one contiguous buffer on
  `audio.completed`, because Piu has no PCM sink that can be fed frame by
  frame.

Companion Mode adds opted-in CoreS3 microphone capture, stereo-to-mono 20 ms
PCM frames, half-duplex gating, and the same Gateway flow in WASM with text
and optional browser microphone input. See [Companion setup and verification](../operations/companion-mode.md).

**Not implemented, deliberately deferred:**

- **Full duplex, barge-in, and AEC.** The microphone pauses during recognition
  and speech, and resumes only after playback completes.
- **Frame-by-frame playback.** The device buffers a whole turn's `audio.chunk`
  frames and plays them only once `audio.completed` arrives; there is no
  streaming PCM sink yet, so the audible latency is one full assistant turn,
  not the first chunk.
- **`robot.directive` handling on the device.** The message type exists in
  both protocol mirrors, but nothing sends or handles it: embodiment is
  expressed exclusively through the tool-calling path described above, not
  through this fire-and-forget directive channel.

Nothing in this change has been run against physical Stack-chan hardware; the
firmware-side pieces (`gateway-bridge.ts`, `gateway-protocol.ts`,
`gateway-config.ts`, the Gateway Dock itself) are exercised by `node --test`
against pure logic and mocked transports, not on a device.

## Phase map

The issue laid out four phases. What actually landed:

- **Phase 0 — Gateway Text MVP.** Fully implemented: Gateway connection,
  `conversation.start`/`stop`, conversation-state sync via the sideband
  mapping, text LLM responses through any of the three Agent Backends, and
  the robot reading the answer with its own TTS.
- **Phase 1 — Voice.** Half-duplex capture and buffered reply playback are
  implemented. VAD/STT/TTS remain Gateway-owned. Physical microphone and speaker
  quality verification is separate; incremental playback and AEC remain future work.
- **Phase 2 — Embodiment.** Mostly implemented: all eight embodiment tools
  exist, are conditionally advertised based on device capability, and are
  invocable by any Agent Backend. Touch/IMU context being fed to the Agent as
  input (as opposed to the Agent driving output through tools) is not part of
  this change.
- **Phase 3 — Agent / MCP.** Implemented: the `hermes` and `openai` Agent
  Backends beyond `echo`, the MCP tool registry, approval, and `task.status`
  are all present and wired end to end.
