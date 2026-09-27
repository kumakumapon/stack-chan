# Stack-chan Virtual Pet MOD

This MOD adds an offline growth loop without requiring Wi-Fi, a Gateway, or an
AI provider. Install it on an already deployed host from `firmware/`:

```console
npm run mod -- mods/examples/stackchan_pet/manifest.json
```

The face remains the main screen. Swipe forward then backward on a supported
head touch panel to pet Stack-chan. On targets without head touch, open the
`ｽﾀｯｸﾁｬﾝ 育成` Mini App and tap `なでる`. The Mini App shows bond, energy,
curiosity, level, experience and total interactions. Its `あそぶ` button starts
a six-second tap challenge. The same archive also includes the existing JUMP
and CATCH Mini Apps; a completed round contributes to the pet's growth.

Petting has a five-second cooldown, game rewards have a ten-second cooldown,
and all statistics are bounded. Energy recovers while time passes, including
while the device is off. There are no absence penalties or streak rewards.
The first level unlocks a basic greeting; level 2 unlocks the delighted
reaction for screen petting. Higher levels retain named expression unlocks
for later presentation variants.

The state is saved as a versioned JSON string through Moddable's public
`preference` module. Writes are delayed by 1.5 seconds and flushed on MOD
close. Invalid or unsupported saved data starts a fresh pet safely; version 0
data migrates to version 1. The reducer and serialization are pure and can be
tested with `node --test mods/examples/stackchan_pet/pet-state.test.mjs`.

## Verification

For an end-to-end check, install the MOD on M5StackChan CoreS3, pet or tap
until the level increases, play JUMP/CATCH, then restart the device and confirm
the Status Mini App retains the statistics. In the WASM Simulator, load the
built MOD archive and verify status, tap fallback, game results and cleanup
after exiting a Mini App. Hardware petting and restart persistence require a
connected CoreS3; the pure tests cannot establish those behaviors alone.
