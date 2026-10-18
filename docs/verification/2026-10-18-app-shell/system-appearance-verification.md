# Verified System appearance — 18 October 2026

The installed iPhone 16 native app has `UIUserInterfaceStyle=Automatic`. Selecting System in Settings follows simulator OS Light and Dark. Both changes passed matching checks for native Appearance, the mounted root background and complete navigation palette, and Expo/native status-bar props. Each condition remained true for three consecutive observations before the native frame capture.

- [Light OS, System selected](system-light.png)
- [Dark OS, System selected](system-dark.png)
- [Restored Studio](system-restored-studio.png)
- [Raw machine report](system-appearance-report.json)
- [Unchanged copy hashes and provenance](system-audit-manifest.json)
- [Final used harness](system-audit-harness/README.md)

Original preferences were restored byte for byte, the original OS appearance and Studio were restored, and all saved project JSON hashes stayed unchanged. The app was never terminated, relaunched, paused or reloaded during this audit. The historical `runtime-verification.json` and original shell helper files remain unchanged.

This is native simulator/developer integration evidence. Physical-device behavior and genuine touch/keyboard gestures were not exercised by this audit.
