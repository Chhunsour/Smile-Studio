# Smile Studio tool design and motion

The editor uses an original family of 100 vector drawings: precise rounded strokes, open film-frame corners, and a restrained warm secondary ink. Common editing metaphors stay recognizable, with readable labels beneath the toolbar tools. The drawings live in `src/ui/studio-glyphs.ts`; `StudioIcon` renders the same geometry on iOS, Android, and web through the existing Expo Image dependency.

Tool tiles, panels, timeline, transport, and export controls now share a graphite/champagne visual language. All tools has searchable, categorized cards with a larger icon, title, and description. It changes to one column for compact widths or larger accessibility text. Search keeps the sheet above the keyboard and reduces surrounding content to retain usable results.

`MotionPressable` gives controls a 90 ms compression and a short spring release, with opacity feedback, hover/focus states, and completed-activation haptics. It wraps the native Pressable directly, preserving touch areas, long presses, disabled behavior, callbacks, and render props. Only transform and opacity animate. Existing completion haptics are retained without an extra press haptic where appropriate.

One `MotionProvider` subscribes to the system's Reduce Motion preference, including live changes. Reduced motion removes scale movement and entry transitions while retaining immediate visual state changes. These UI animations are independent from animations in exported videos. The new controls follow the app's reactive light/dark palettes.

Representative primary, secondary, and selected text pairs in both themes exceed the [WCAG normal-text contrast target](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The measured pairs are saved in `verification/2026-10-18-premium-ui/contrast.json`; this check does not imply whole-app accessibility certification.

Primary files: `src/ui/StudioIcon.tsx`, `src/ui/studio-glyphs.ts`, `src/ui/MotionPressable.tsx`, `src/ui/motion.tsx`, `src/ui/Sheet.tsx`, `src/ui/useKeyboardSpace.ts`, `src/editor/ToolLibrary.tsx`, `src/editor/Toolbar.tsx`, all editor panels, `src/editor/Timeline.tsx`, `src/editor/Preview.tsx`, `src/editor/ExportFlow.tsx`, and `src/app/editor/[id].tsx`.

Research references: [Adobe Lightroom workspace](https://helpx.adobe.com/sg/lightroom/mobile/get-started/workspace-overview.html), [Premiere panel and context menus](https://helpx.adobe.com/premiere/desktop/get-started/tour-the-workspace/display-panel-options-and-menu.html), and [CapCut interface](https://www.capcut.com/help/interface-and-settings). Their organization and editing conventions informed the review; the icon artwork is drawn for Smile Studio.

The implementation follows [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), its [Image](https://docs.expo.dev/versions/v57.0.0/sdk/image/), [Haptics](https://docs.expo.dev/versions/v57.0.0/sdk/haptics/), and [Reanimated](https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/) documentation, and React Native 0.86 keyboard/Pressable APIs. No new dependency is required.

Visual study: [tool drawings](verification/2026-10-18-premium-ui/tool-icons.png). Native and automated verification results are recorded in [UI readiness](verification/2026-10-18-creator-tools/ui-redesign-status.md).
