# Hermes Desktop bridge retired

The dedicated Hermes Desktop bridge was removed following the
[2026-10-03 policy change](https://github.com/kumakumapon/stack-chan/issues/57).
Its loopback authentication, JSON-RPC and audio adapters, Windows speech helper,
BLE configuration helper and launcher are no longer provided.

For existing installations, stop the old Gateway launcher and set
`conversation.backend=none` and `conversation.autoStart=0` on the robot.
Rebuilding does not remove previously generated files in `gateway/dist/`;
remove the retired outputs before reusing an old checkout. See the
[migration guide (Japanese)](../docs/operations/retired-integrations_ja.md)
for those paths and for restoring a robot with the old MiniStack MOD.

The generic [Conversation Gateway](./README.md) remains available. Its `hermes`
HTTP/NDJSON backend is a separate integration and does not connect to Desktop.
This change does not uninstall Hermes Desktop or alter its configuration.
