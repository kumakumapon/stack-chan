---
"stack-chan": major
---

Complete the CoreS3-only hardware cleanup: remove retired DYNAMIXEL, RS30X, PWM, and generic SCServo drivers, their WASM facades and DYNAMIXEL sample, old RT/Core2/Atom platform mappings, and non-CoreS3 PMIC/audio implementations, and retired BLE-only transport wiring. Keep the calibrated M5StackChan driver, shared SCServo transport, AXP2101 support, stock CoreS3 SDK dependency, and desktop/WASM simulation. Existing hardware driver preferences remain locked to the product driver; unsupported driver selections fail before hardware initialization. Capability/MOD interfaces, servo calibration, partition layout, and saved-data formats are unchanged.

Release builds and bundle generation now require at least 256 free XS keys. CI reports key usage from generated mc.xs.c beside flash capacity, preventing a return to the previous 8,087/8,192 key usage without a failure. Direct imports of retired driver modules are no longer supported.
