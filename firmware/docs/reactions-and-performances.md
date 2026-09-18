# Reactions and performances

[日本語](./reactions-and-performances_ja.md)

Reactions are short named gestures that express a feeling, playing on a timeline from start to restoration. Performances are minutes-scale choreography that combine speech, song, reactions, and motions on one absolute-time clock.

Both run on an internal timeline clock and a stage that the host owns. A MOD or agent tool can only ask for one by name—never hand the robot raw servo angles. Petting and IMU-driven behaviour are unaffected.

## Reactions

A reaction is a few hundred milliseconds to a few seconds of face, hands, head, and effects changing on a timeline, then restoring.

### Reaction names

Eight named reactions are available:

| Name | Shows |
|------|-------|
| `yes` | Happy nod |
| `no` | Doubtful head shake |
| `greeting` | Happy wave with heart effect |
| `thinking` | Doubtful hand-on-chin pose with sweat |
| `delighted` | Happy cheer with heart and bouncy head |
| `sleepy-yawn` | Sleepy yawn with closing eyes |
| `success` | Happy clap with green light |
| `failure` | Sad head droop with blue light and tear |

### Playing a reaction

Call `context.reaction.play(name, options?)`:

```js
const result = context.reaction.play('greeting', { intensity: 0.8, restore: true });
if (!result.ok) {
  trace(`reaction failed: ${result.error}`);
}
```

`play()` returns `{ ok: true }` on success, or `{ ok: false, error }` with a reason (an unknown name, a timeline that fails validation, or a performance currently playing). A reaction asked for while another reaction plays interrupts it.

### Reaction options

- **intensity** (0–1, default 1): Scales head motion amplitude. A reaction at intensity 0.5 moves the head half as far.
- **restore** (boolean, default true): Restore face, hands, effect, and head position to their pre-reaction state at the end. `false` leaves them where the reaction ended.

### Controlling reactions

- **cancel()**: Stops the active reaction and restores the stage immediately. Returns `true` if a reaction was playing, `false` otherwise.
- **status()**: Returns an object with `active` (the `ReactionName` now playing, or `null`) and `startedAt` (milliseconds from boot, or `null`).

### Reaction limits

The host enforces these limits on every reaction, so a MOD or agent tool cannot exceed them:

- Head yaw: ±π/6 radians (±30 degrees)
- Head pitch: ±π/8 radians (±22.5 degrees)
- Head move duration: 150–3000 ms
- Head targets: at least 150 ms apart
- Frames: at most 48 per reaction
- Total reaction time: at most 15 seconds

Petting and IMU-driven behaviour are not subject to these limits and are unaffected by reaction playback.

## Performances

A performance is a choreographed sequence of speech, song, reactions, and head motions on one timeline. Every cue fires at an absolute time from the performance's start, so a slow servo move or long TTS hand-off never shifts the rest of the performance.

### Performance names

Four named performances are available: `greeting`, `happy-dance`, `cheer`, `sing-twinkle`.

### Playing a performance

Call `context.performance.play(name, options?)`:

```js
const result = context.performance.play('happy-dance', { intensity: 1.0 });
if (!result.ok) {
  trace(`performance failed: ${result.error}`);
}
```

`play()` returns `{ ok: true }` on success, or `{ ok: false, error }` with a reason (an unknown name or a timeline that fails validation). A performance asked for while another plays interrupts it, and cancels any reaction started directly.

### Performance options

- **intensity** (0–1, default 1): Scales head motion amplitude within the performance.
- **restore** (boolean, default true): Restore face, hands, effect, and head position to their pre-performance state when the performance ends. `false` leaves them where the performance ended.

### Controlling performances

- **cancel()**: Stops scheduling, cancels any running reaction, and restores the stage immediately. Speech or song already handed to the TTS continues to completion (the audio capability has no stop). Returns `true` if a performance was playing, `false` otherwise.
- **status()**: Returns an object with `active` (the `PerformanceName` now playing, or `null`), `startedAt` (milliseconds from boot, or `null`), and `nextCue` (index of the next cue to fire, or the count of all cues).

### Cue types

A performance cue can trigger:

- **reaction**: Play a reaction by name on the current stage.
- **motion**: Play a named head motion (nod, shake, sway-left, sway-right, bounce, look-up, look-down, head-left, head-right, center).
- **head**: Direct head target with yaw/pitch and duration.
- **speech**: Speak text through the active TTS. Cannot be stopped once started; see the cancel semantics below.
- **song**: Sing raw stackchan-voice koe notation through the active TTS when it supports singing.
- **emotion, hand, effect, light**: Change face state, hand animation, effect, or LED colour directly.

### Motions

Ten named head motions are available within performances:

| Name | Action |
|------|--------|
| `nod` | Quick up-down nod |
| `shake` | Side-to-side head shake |
| `sway-left` | Lean head to the left |
| `sway-right` | Lean head to the right |
| `bounce` | Quick up-down bounce |
| `look-up` | Look upward |
| `look-down` | Look downward |
| `head-left` | Turn head to the left |
| `head-right` | Turn head to the right |
| `center` | Return to centre |

### Timing and the absolute-time clock

Every cue fires at its absolute `at` time (milliseconds from the performance's start), never a delay from the previous cue. This ensures the performance stays on the beat even when a servo move or TTS hand-off takes longer than expected.

**Catch-up window**: If the clock falls more than 1000 ms behind schedule, cues beyond that window are skipped rather than replayed in a burst. This prevents a stalled clock (e.g., from a long TTS chunk or busy servo transaction) from looking like the performance is playing at half speed.

**Overdue cues within the window**: If a cue is overdue but within the catch-up window, it still fires, but the player records how late it fired. This keeps the performance roughly on the beat.

### Restore and cancel semantics

When a performance ends or is cancelled:

- **Head position** is moved back to its pre-performance pose, taking up to 200 ms to settle.
- **Face, hands, effect**: Restored immediately.
- **Speech or song**: Already handed to the TTS will complete. The audio capability has no stop mechanism, so `cancel()` cannot interrupt it. This is by design: stopping mid-word would sound like a glitch. If the TTS is busy (e.g., speaking a longer sentence), the next performance cannot start until it finishes.

## Agent tools

Realtime agent sessions can call two tools to trigger reactions and performances:

- **stackchan.react**: `{ name: one of REACTION_NAMES, intensity?: 0..1 }`
- **stackchan.perform**: `{ name: one of PERFORMANCE_NAMES, intensity?: 0..1 }`

These tools are equivalent to calling `context.reaction.play(name, { intensity, restore: true })` and `context.performance.play(name, { intensity, restore: true })` from a MOD.

## Using reactions and performances in a MOD

MODs receive these capabilities as namespaced APIs:

```js
export default async function onContextCreated(context) {
  // Play a reaction
  const reactionResult = context.reaction.play('success');
  if (reactionResult.ok) {
    trace('success reaction started\n');
  }

  // Check the status
  const status = context.reaction.status();
  trace(`Active reaction: ${status.active}\n`);

  // Cancel the active reaction if needed
  const wasCancelled = context.reaction.cancel();
  trace(`Was a reaction running? ${wasCancelled}\n`);

  // Play a performance
  const perfResult = context.performance.play('greeting', { intensity: 0.9 });
  if (perfResult.ok) {
    trace('greeting performance started\n');
  }
}
```

Check the `ok` field of the result before assuming the reaction or performance is running.

## Trying them in the web simulator

The web simulator includes a Reaction/Performance card that lets you:

- Select and trigger any reaction or performance by name.
- Adjust the intensity slider.
- Watch the face, hands, and effects respond on the 3D model.
- Cancel a running reaction or performance with a button.
- View the live status and cue count.

To use it, run the simulator, locate the Reaction/Performance card in the controls panel, and trigger a reaction or performance. The simulator polls the status from the firmware WASM build in real time.

## Hardware verification

Hardware verification is pending for all reactions and performances. Timing measurements, head range, and servo load are being validated on the physical device.
