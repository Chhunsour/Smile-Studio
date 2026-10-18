# App shell verification — 18 October 2026

The app shell was checked in the actual `com.smilestudio.app` native app on the booted iPhone 16 simulator (`93BCE7CC-D004-43AF-8F44-1EB2ADF526E9`). Metro served an internal SSD mirror after external-drive reads became unreliable. All 110 copied source, asset, module and configuration files were compared with the final original checkout using SHA256; every hash matched. See [source hashes](final-source-manifest.json).

## Verified behavior

- Actual Studio, Projects and Profile tab handlers navigate correctly. Settings and the editing guide open from the shell.
- Light and Dark appearance controls change the native shell and status bar. System selection is saved and follows actual OS appearance changes in the rebuilt Automatic app; see [final System audit](system-appearance-report.json).
- Edit profile saves a Khmer/English studio name, bio and Sage avatar color locally.
- Settings save a 1:1 default canvas and 720p/24 fps export defaults.
- A full app terminate and launch rehydrates the changed profile, appearance and editing defaults.
- The sign-in preview has three disabled provider choices and no credential inputs. It does not create an account.
- All three existing project JSON files retain their original SHA256 hashes. The original preference file was restored byte for byte, and the app was left on Studio with its original Light appearance and profile.

Machine-readable checks and limits: [runtime verification](runtime-verification.json). Existing projects: [before](baseline-projects.json), [after](final-projects.json). Preference persistence: [saved](changed-preferences-disk.json), [after relaunch](relaunch-preferences.json), [restored](restored-preferences-disk.json).

## Visual evidence

Accepted native captures: [Studio light](home-light.png), [Studio dark](home-dark.png), [Settings light](settings-light.png), [Settings dark](settings-dark.png), [Profile](profile-light.png), [account design preview](sign-in-dark.png), [editing guide](help-light.png), [Projects](projects-light.png). The development-client floating tool button is visible.

The fresh Profile capture was accepted at its original resolution with full status bar, header and tab labels. An earlier concern came from a resized multi-image preview; no app defect was reproduced and no source fix was needed.

## Latest combined checks

After the coordinated slider, audio-import preservation, native modal handoff and repeat-audio boundary fixes, the features owner reports 106/106 tests, TypeScript exit 0, and full ESLint exit 0 with no warnings. All 115 final source/config/asset hashes were independently compared in both the original and mirror; every hash matches. The app-shell runtime audit predates those shared editor fixes; no shell/profile/settings behavior changed. The original 110-file audit manifest remains an accurate record of that earlier native session rather than a claim about the later source count. Both the original iOS full build and the subsequent automatic-appearance rebuild passed with exit 0.

The installed-app System audit also passed. Actual OS Light/Dark changes matched native Appearance, mounted root and navigation palettes, and both Expo and native status bars for three consecutive observations each. [System evidence](system-appearance-verification.md) includes the machine report, untouched frames and final harness. Exact preferences and OS settings were restored, Studio was restored, and all four projects in that session remained unchanged. The three original shell-baseline project hashes and original preference-file hash were independently compared again and still match. Historical `runtime-verification.json` records the earlier session; its System-mode limitation is closed by the later passing report.

## Method and limits

`cdp.mjs` evaluates checks in the app’s Hermes runtime. `native-ui.js` discovers current React controls and invokes their actual handlers. These are developer integration checks, not simulated touch gestures. React Native’s Promise implementation was not awaited by CDP, so completed writes were checked with subsequent synchronous reads and disk inspection.

Computer Use startup returned `Sky Computer Use native pipe startup failed`. Genuine touch, keyboard, system picker/share gestures, physical devices and Android runtime were not covered. No new native build, export, backend, deployment or release was performed by this audit.

CoreSimulator denied screenshot writes directly to the external volume. Captures were saved into `/tmp` with `simctl`, then copied without image modifications.

Static routing also confirms `/` is defined only by `src/app/(tabs)/index.tsx`; no competing `src/app/index.tsx` remains. Root Stack registers the tab group and Settings, Edit profile, Sign-in preview, Help and Editor routes.

Final combined check results are recorded in [verification summary](../2026-10-18-creator-tools/verification-summary.json). The last repeat-audio correction changed only the audio-editing helper and its tests. No shell or appearance source changed after the passing System audit. All 115 final original and mirror hashes were independently rechecked again after that correction.
