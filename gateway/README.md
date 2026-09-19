# Stack-chan Conversation Gateway

A resident service that sits between a Stack-chan and whatever intelligence you
want to drive it with.

```text
Stackchan = body + UI + sensors
Gateway   = conversation infrastructure
Agent     = the brain
MCP       = hands into the outside world
```

The robot stays free of any particular LLM, cloud or agent framework: swapping
OpenAI for a local model is a Gateway-side config change, and the firmware never
learns about it.

## Why it is not a new protocol stack

The firmware already speaks a Dock protocol over USB:

- `stackchan.event.v1` — `conversation.start/stop/result`, `approval.*`,
  `task.status`
- a realtime control plane — `session.created`, `session.update`/`session.updated`,
  `response.function_call_arguments.done`, `conversation.item.create`,
  `response.create`

The Gateway speaks **exactly those**, over WebSocket. That is what lets
`RemoteConversationSession`, `createRealtimeSession()` and the whole remote-session
runtime be reused without a line changed, and it is why device-hosted embodiment
tools need no new message type: the robot advertises them in `session.update`
and the Gateway invokes them with `response.function_call_arguments.done`.

Only what `stackchan.event.v1` genuinely lacks lives in a new sideband schema,
`stackchan.gateway.v1`: the handshake, the media plane, transcripts and agent
errors.

```text
device -> gateway : session.hello, audio.input, audio.input.end, text.input, response.cancel
gateway -> device : session.ready, transcript.input, transcript.output,
                    audio.started, audio.chunk, audio.completed,
                    agent.error, response.cancelled
reserved          : robot.directive (not executed)
```

See [implementation status (Japanese)](../docs/IMPLEMENTATION_STATUS_ja.md) for current behavior, tested targets and separate physical acceptance.

## Quick start

```bash
cd gateway
npm install
npm run build
node dist/main.js                      # offline echo backend, anonymous devices
node dist/main.js gateway.example.yaml # real backend and credentials
```

Point the robot at it with `conversation.backend = 'gateway'` and a
`gateway.endpoint` of `ws://<host>:8765/`. See
`docs/specs/conversation-gateway.md` for the device-side settings.

With no config file at all the Gateway runs the `echo` backend: enough to take a
Stack-chan through the whole start → listen → answer → speak → stop flow without
a single credential.

## Layout

```text
src/
  protocol/     stackchan.event.v1, stackchan.gateway.v1, realtime control plane
  server/       WebSocket front door, per-device session, auth, session registry
  conversation/ conversation state machine, media plane
  agent/        AgentBackend boundary: echo, openai, hermes
  audio/        PCM helpers, energy VAD, STT and TTS adapters
  tools/        ChatTool-compatible registry, MCP adapter, embodiment schemas
  approval/     approval.request -> presented -> response -> resolved, task.status
```

Everything below `server/gateway-server.ts` is transport-agnostic, which is why
the session, conversation and tool layers are unit-tested without a socket.

## Agent backends

```ts
interface AgentBackend {
  createSession(options: AgentSessionOptions): Promise<AgentSession>
}
```

A backend owns nothing but the intelligence. Sessions, media, tools and approval
stay with the Gateway, so a new backend never touches transport code.

| backend  | audio | notes |
| -------- | ----- | ----- |
| `echo`   | no    | offline; deterministic; also the integration-test double |
| `openai` | no    | Chat Completions with tool calling |
| `hermes` | no    | any HTTP + NDJSON agent; the wire contract is documented in `src/agent/hermes-backend.ts` |

## Tools and approval

Tools are `ChatTool`-compatible, so the same description serves a Direct-mode
`ChatService` session and a Gateway-mode Agent session.

- **Gateway-hosted** tools (MCP servers, built-ins) run in this process.
- **Device-hosted** tools run on the robot: `stackchan.say`,
  `stackchan.face.setEmotion`, `stackchan.motion.setPose`,
  `stackchan.motion.lookAt`, `stackchan.light.set`, `stackchan.camera.capture`.
  A schema for a tool the robot did not advertise is dropped — the Gateway never
  offers the Agent a body part the robot does not have.

Anything with a side effect can be put behind the robot's own approval UI with
`tools.requireApproval`; the Gateway then drives
`approval.request → presented → response → resolved` and brackets the run in
`task.status`.

## Security

- LLM credentials never reach the robot.
- Device tokens are compared in constant time; a per-device token overrides the
  shared one so a single robot can be revoked.
- Put it behind `wss://` on anything other than a trusted LAN. The server speaks
  plain WebSocket; terminate TLS in front of it.
- Every request carries a `requestId`, so a conversation and its tool calls can
  be traced end to end.

## Tests

```bash
npm test     # tsc + node --test over dist/
npm run lint
```
