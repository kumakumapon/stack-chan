---
"stack-chan": minor
---

Add an offline Memory Mini App to the standard host and WASM simulator. Repeat three numbered cues with LCD taps, advance through twelve rounds, and retry after a mistake. Optional small named reactions are off by default; leaving the app clears its timers and cancels only its own reaction. The app coexists with Virtual Pet and the focus timer without a separate MOD, network, or AI provider.

Add optional `reaction.playOwned()` for non-interrupting playback with owner-scoped cancellation. Existing `play()` and `cancel()` behavior is unchanged.
