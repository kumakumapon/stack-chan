---
"stack-chan": minor
"stackchan-web": minor
---

Bring the Web simulator's input devices in line with a real CoreS3, so the simulator can be used to check hardware behaviour rather than only Web-only conveniences.

The simulator gains a device profile. `M5StackChan CoreS3` mirrors what the CoreS3 platform manifest actually wires: screen touch, the Si12T head touch panel and the IMU, and no A/B/C buttons — that board has none, and the manifest sets `virtualButton: false`. `Legacy / Compatibility` keeps the A/B/C bridge for older M5Stack targets and for exercising button-aware MODs. A profile decides which `Host.*` bridges exist at all; a disabled input is omitted rather than stubbed, so the firmware treats it as absent exactly as it would on a board without the sensor.

Head touch panel and IMU bridges are new on both sides. The WASM platform gains `device.sensor.TouchPanel` and `device.sensor.IMU`, and the Web UI gains swipe, touch-position and orientation/shake controls. Nothing synthesises a gesture: the browser emits three-channel intensities and accelerometer vectors, and the firmware's own `GestureRecognizer` and `MotionRecognizer` derive the swipe, the petting cadence, the fallen postures and the shake from them — which is what makes checking those behaviours in the simulator mean something. A test drives the real browser bridge through the real WASM driver into those recognizers, so the two independently maintained halves cannot drift apart silently.

The existing 3D LCD touch path is unchanged.
