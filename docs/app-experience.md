# Smile Studio app experience

Smile Studio now has a complete local app shell around its existing video editor.

- **Studio:** a warmer starting screen, new-project action, canvas shortcuts, all eight editable styles, editing guide, and recent projects.
- **Projects:** searchable drafts, recent/name sorting, rename, duplicate, and confirmed deletion. Original photo-library items remain untouched.
- **Profile:** editable studio name, bio, and avatar color, plus totals calculated from actual local projects.
- **Settings:** Light, Dark, and System appearance; a default project canvas; export resolution and frame-rate defaults used by the existing export flow.
- **Help:** guidance for importing, editing, captions, audio, and exports, plus an explanation of local storage and permissions.
- **Sign-in preview:** clearly marked as a design preview. Provider buttons are disabled; there are no credential fields, account requests, or fake sessions.

Preferences use a validated, versioned local file and atomic saves. Failed saves are shown in the interface. The app waits for preferences before dismissing its launch splash. Appearance applies to navigation, shared controls, and the editor as well as these new screens.

Routes live in `src/app/(tabs)/` and the root stack. Shared Studio and project-library code lives in `src/studio/`; preference validation and storage live in `src/core/preferences.ts` and `src/state/preferences.ts`.

No backend, new dependency, account service, cloud sync, or deployment was added. Existing editor capabilities and project format are retained. Concurrent editor icon/motion and creator-tool changes are documented separately in `creator-upgrade.md`.

Verification artifacts and the exact native verification scope are recorded under `verification/2026-10-18-app-shell/`. Final combined validation readiness is recorded in `verification/2026-10-18-creator-tools/app-ui-status.md`.
