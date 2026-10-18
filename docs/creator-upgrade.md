# Creator tools upgrade

This upgrade builds on the existing native Smile Studio editor. Edits remain non-destructive, autosaved and undoable. Existing schema-2 projects remain compatible.

## Easier workflows

- **All tools** stays visible beside the scrolling toolbar. Search or browse Edit, Looks, Text, Audio and Project. It includes the basic split, duplicate, delete and exact timing commands as well as the new tools. Clip-specific tools use the selected clip or the clip at the playhead; track-specific commands explain their selection requirements.
- **Studio** offers eight editable templates and quick portrait, square and wide starters. **Projects** adds search and sorting by name or most recent edit. Import your own videos/photos to start. Templates can also be applied inside the editor.
- **Templates** include Daily vlog, Cinematic, Travel diary, Food story, Retro memories, Product spotlight, Night out and a Khmer memory title. They set canvas, color, effects, transitions and an optional editable opening title. Switching templates replaces the generated title and preserves other text and audio. Clear the title field to omit it. Undo restores the prior edit.
- **Quick cutting** trims before/after the playhead, or splits the main track at timeline markers in one edit. Marker cuts retain duration/source timing and keep fades only at the outer edges; up to 128 cuts can be added at once. Trim commands ripple the main track while text/audio keep their absolute timeline positions.
- **Transitions** offer Cut, Quick dissolve, Soft dissolve, Slow dissolve and Dip to black presets. Crossfade duration remains adjustable; a dip sets the adjacent scene's fade-out and the current scene's fade-in.
- **Safer controls** reject cancelled slider gestures and stale speed callbacks after changing a project, clip, panel or base value. All-tools commands wait until their native sheet dismisses before opening another picker or panel.

## Effects and titles

- **15 stackable scene effects:** the existing vignette, grain, scanlines, cinema bars and light leak, plus glow, golden hour, blue hour, dreamy color, neon frame, dust, scratches, faded film, frost and spotlight. These are deterministic color/texture overlays; glow is a light overlay rather than optical blur of bright pixels.
- **Six effect presets**, search and categories. Replace the current stack or add a preset to it; view/remove individual effects in Stack. Every effect has adjustable intensity, accessible increment/decrement controls, reset and apply-to-all.
- **20 text styles**, with fonts, color, position and animation ready to customize. Text now has one-tap top/center/bottom alignment and a size slider alongside preview gestures.
- **10 animation choices**, including None: Fade, Slide up/down, Pop, Bounce, Zoom in/out, Rise and Pulse. Entrance and exit are independent. Preview, iOS export and Android export use the same equations.
- **Searchable sticker groups:** Favorites, Reactions, Cambodia, Hearts, Celebrate, Food, Travel and Labels. Stickers remain editable text layers with the same timing, transform, animation and export behavior.

## Soundtrack tools

- **18 original offline sounds:** eight music beds and ten sound effects, searchable by mood/category. Preview before adding. No downloaded copyrighted tracks or subscription is required.
- **Extract audio** is available directly on a selected video's toolbar, in the main toolbar for the video at the playhead, in All tools search, and in Audio tools. One tap creates and selects an independent audio lane, preserving source trim, timeline start, volume and fades while muting the original. Undo restores both changes together. This requires 1× video speed and a readable, audible trimmed range; silent ranges leave the project unchanged. Extraction shares the original source file without modifying it, and the separated track plays and exports through the existing audio pipeline.
- **Quick mixes:** Voice, Music bed, Ambience and Sound effect presets; fade both ends; trim excess beyond the project; repeat a trimmed sound through the end. Repeated operations reuse matching pieces and preserve mix edits. Extending or shortening the movie reconciles the repeat boundary without overlapping duplicate tails.
- **Balance peak level** uses actual decoded source waveform bins intersecting the trim and respects the existing 100% volume limit.
- **Lower other tracks** makes room for a selected voice by lowering entire overlapping audio/video clips to at most 20%. This is a deliberate full-track reduction, not automatic speech ducking. Undo restores the mix.
- **Mute originals / Restore to 100%** affects original video clips only. Imported music and voiceover stay independent.
- **Import safety** protects copied audio while the native decoder probes it and until the project successfully saves. Failed imports clean up their own partial file without dropping another pending take's protection. Overlapping voiceovers remain supported.

## Compatibility and scope

No new dependency, service, account or payment is needed. New effects reduce to the existing normalized native rendering primitives; new animations extend both native exporters. Rebuild the development app to include those animation changes. Photo/video sources remain unchanged.

Caption import/editing, voice recording, waveforms, beat markers, color adjustment, export resolution/frame-rate controls and sharing continue to use the existing workflows. AI speech transcription, background removal, motion tracking, video overlays, reverse playback and speed curves remain future work; this upgrade does not imply full CapCut feature parity.

## Verification

- 106 automated tests pass, including templates/reapplication, marker cuts, trim mapping, transition switching, effect primitives, audio edits/synthesis, repeat reconciliation after duration changes, export specs, animation endpoints, slider cancellation, deferred tool handoff and pending-media protection.
- Extracted Swift and Kotlin animation math each match the JavaScript reference across 220 samples at a tolerance of 1e-12. [Reproducible parity proof](verification/2026-10-18-creator-tools/animation-parity.json).
- Full ESLint and TypeScript checks pass without warnings/errors; `git diff --check` passes. Final checks use an identical-lockfile internal-SSD mirror because the external APFS volume stalled on metadata reads. All 115 authored source/config/asset files match SHA-256 hashes in [the source manifest](verification/2026-10-18-creator-tools/source-manifest.json); the original checkout remains authoritative.
- Full iOS simulator builds pass in the original checkout and the synchronized internal mirror. Android `:smile-engine:compileDebugKotlin` passes; Android runtime export is not claimed.
- A native 16-second portrait export fully decodes as 720×1280, 24 fps, 384 H.264 frames with AAC audio. Strict decoded-pixel analysis passes all 15 effects, including grain, dust and scratches. All six new spatial text animations pass 20 motion samples and outperform a fade-only fallback. [Video](verification/2026-10-18-creator-tools/creator-tools-proof.mp4), [effect measurements](verification/2026-10-18-creator-tools/native-effects-analysis.json), [motion measurements](verification/2026-10-18-creator-tools/native-animation-analysis.json).
- Native audio verification exercises mounted app handlers: detach trimmed video audio, preview and add an original library sound, decode 1,024 waveform bins and balance peak level. The resulting four-second 720×1280, 24 fps H.264/AAC MP4 fully decodes with audible mixed audio. [Audio evidence](verification/2026-10-18-creator-tools/native-audio-verification.json).
- The refreshed repeat helper also passes in the native Hermes runtime: extending and shortening an isolated soundtrack leaves one audible boundary piece, and a second invocation is a no-op. No saved project changes. [Repeat evidence](verification/2026-10-18-creator-tools/native-repeat-verification.json).
- Native speed callbacks accept a valid edit but reject a queued edit after the panel or base value changes. [Slider evidence](verification/2026-10-18-creator-tools/native-slider-verification.json).
- The actual All tools → Import audio handlers dismiss the tool sheet and present the fully loaded native Files picker. [Native frame](verification/2026-10-18-creator-tools/native-files-picker.png). Selecting an external file through native touch is not claimed; importing an original library sound is verified separately.
- Studio, Projects, Profile, settings, saved preferences and relaunch behavior are verified in the iPhone 16 simulator through developer integration and screenshots. System appearance follows both OS Light and Dark with matching root, navigation and status-bar colors. Preferences restore byte for byte and project hashes stay unchanged. [System evidence](verification/2026-10-18-app-shell/system-appearance-verification.md).
- These checks are not physical-device or native-touch automation proof. Microphone recording, physical haptics, Android runtime export and a release splash remain unverified. [Combined verification record](verification/2026-10-18-creator-tools/verification-summary.json).

## Native configuration

This locked Expo 57 CLI cleans generated native folders by default. Use `npx expo prebuild --no-clean --no-install` to layer configuration changes onto existing generated projects, then rebuild the development app. Keep native customization in app config/plugins, not hand edits to generated folders. Both platforms have regenerated Automatic appearance and light/dark splash resources.

The temporary SSD mirror and its development server are verification aids, not a second source tree to maintain. Future source edits belong in the original checkout; restart Metro there or refresh and reverify the mirror before using it.
