# MiniStack Phase 0

Added a private MiniStack MOD and browser Local Peer test client with authenticated requests, bounded command scheduling, request deduplication, and heartbeat monitoring. Status polling does not consume the action replay history; BLE sends and browser writes are serialized to tolerate transient acknowledgement loss.

For M5StackChan CoreS3, restore board power initialization across AXP2101 SDK register API variants and harden SCServo framing against fragmented, noisy, or corrupt input. Motion writes now use the official SCSCL position/time/speed register window and the reference-firmware goal time, while write acknowledgement loss no longer turns an issued motion command into an application failure. The test page alternates a bounded left/right head target.

Release impact: patch. Verified on M5StackChan CoreS3: MiniStack BLE connection, facial expression change, and repeated left/right head movement.
