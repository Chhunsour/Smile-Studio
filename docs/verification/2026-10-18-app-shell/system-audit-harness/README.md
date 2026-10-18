# System appearance audit harness

This is the final used harness for the successful native System appearance audit on 18 October 2026. The installed app explicitly reports `UIUserInterfaceStyle=Automatic`. The app followed simulator OS Light and Dark with matching native `Appearance.getColorScheme()`, mounted root background, navigation theme palette, Expo status-bar style and native status-bar barStyle. Native frames are copied unchanged.

The actual Settings handler selected System. One persistent CDP connection and host polling checked three consecutive matching observations for each OS appearance. No direct `Appearance.setColorScheme` call was made by the harness. The auditor never terminated, relaunched, paused or reloaded the app; the owner's immutable NativeEngine export could continue.

An initial harness run used an exact `RootLayout` label and rejected Expo Router's `RootLayout(./_layout.tsx)` display name. The helper was corrected to recognize that label on retry, retaining every appearance, palette and status-bar assertion. Original preferences, OS appearance and project hashes were restored after both attempts. No app source changes were required.

The successful run restored original preference values and exact file bytes, OS appearance and Studio, and verified every saved project JSON hash. Cleanup had no errors. Earlier shell proof independently covers full terminate/launch preference rehydration; this window did not repeat that step.

Files: `system-appearance-audit.mjs`, `cdp.mjs`, and `native-ui.js`. The successful raw report is `../system-appearance-report.json`; the unmodified native frames are `../system-light.png`, `../system-dark.png`, and `../system-restored-studio.png`. Copy checksums and provenance are in `../system-audit-manifest.json`.

Only rerun with an explicit runtime-owner window, the Auto app installed, Metro attached and Studio visible. Run with an installed `ws` dependency available to this folder:

```sh
node system-appearance-audit.mjs --go
```

Running without `--go` prints instructions without touching runtime. There is no service startup, native build, dependency upgrade, source edit, project edit, app termination or app relaunch in this harness.
