# MiniStack and Hermes Desktop integration removal

Release impact: major.

The MiniStack MOD and browser connection test, and the dedicated Hermes Desktop
Gateway adapter and launcher, have been removed. Shared Local Peer, the generic
Conversation Gateway, its Echo/OpenAI/Hermes HTTP backends, and common audio and
servo fixes remain available.

Existing device installations, stored preferences and PC configuration are not
modified automatically. Follow the [migration guide (Japanese)](../operations/retired-integrations_ja.md)
to stop or replace an installed integration and remove stale generated launchers.
