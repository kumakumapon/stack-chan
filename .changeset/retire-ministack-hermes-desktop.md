---
"stack-chan": major
"stackchan-web": major
---

Remove the MiniStack-specific MOD, shared-key generator and browser connection
test, and the dedicated Hermes Desktop Gateway bridge with its Windows speech
and BLE setup helpers. These integrations can no longer be built or launched
from this version. Keep shared Local Peer and Conversation Gateway functionality,
including the separate Hermes HTTP backend and common audio/servo fixes.

Existing device installations and PC configuration are not automatically changed.
Stop the old MiniStack MOD or restore the host firmware; disable the device
conversation backend and stop the old Desktop Gateway launcher. See
`docs/operations/retired-integrations_ja.md` for migration and generated-file cleanup.
