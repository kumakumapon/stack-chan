---
"stackchan-web": minor
---

Add a mobile surface to the Web simulator, so a phone can drive it as more than a shrunk desktop layout. Dragging the 3D head pets it, the handset's own motion sensor can drive the simulated IMU once the browser's motion permission is granted, the front and back cameras are both reachable, and a bottom tab bar opens a sheet for operate/sensors/MOD/log controls instead of the desktop's fixed sidebar.

The engine, WASM firmware and 3D scene are shared with the desktop surface rather than forked — `SimulatorMobileSurface` composes the same `SimulatorViewport` and controller cards `SimulatorSurface` uses, so a phone and a desktop browser are exercising the same firmware build through the same bridge.

Two decisions are worth recording. The surface breakpoint is `(pointer: coarse) and (max-width: 1023px)`, a pointer-type query rather than a width or aspect-ratio one, so rotating the phone between portrait and landscape never flips which surface is mounted — a width-based query would remount the canvas on rotation and restart the running firmware. And performance mode on mobile rations only the 3D redraw; the firmware's own timing is never throttled, because slowing it down would change the behaviour being simulated rather than just how it's drawn.

A refused device-motion permission (iOS's gesture-scoped prompt, or a browser that never asks) is a supported state, not an error: the sensor card falls back to the existing manual IMU controls.
