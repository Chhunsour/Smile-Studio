# Smile Studio

A mobile video editor built with Expo (SDK 57), React Native, expo-video, Reanimated and Gesture Handler.

## Running

Native modules are required, so use a development build (Expo Go will not work):

```bash
npm install
npx expo run:ios       # or: npx expo run:android
```

Other scripts: `npm test` (editing, caption, audio, color and export unit tests), `npm run typecheck`, `npm run lint`.

> **Local build notes**
> - iOS: CocoaPods needs a UTF-8 locale: `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.
> - Android: on this machine `~/.gradle/caches` points into `/Volumes/Transcend/Developer Storage/…`. A space in the
>   Gradle cache path breaks Gradle 9's Kotlin-DSL accessor generation ("Unresolved reference 'implementation'").
>   Build with a space-free Gradle home: `GRADLE_USER_HOME=/Volumes/Transcend/GradleHomeNoSpace npx expo run:android`.
>
> The project folder name contains a space, which breaks two Expo iOS build scripts. Both are fixed here:
> `patches/expo-constants+*.patch` (applied by `patch-package` on install) and the config plugin
> `plugins/with-space-safe-bundle-script.js` (applied on `expo prebuild`).

## Status

**Phase 1 — functional foundation (done)**

- Home: New Project (multi-select video import), project list with poster thumbnails, last-edited time,
  rename / duplicate / delete, empty + loading states.
- Editor: preview with project aspect ratio, play/pause, current/total time, undo/redo.
- Timeline: real filmstrip thumbnails, centered playhead, scroll with momentum, pinch-to-zoom, scrubbing,
  tap to select, trim handles (ripple) with magnetic snap to the playhead + haptic, long-press to reorder.
- Clip tools: split at playhead, speed (0.25x–4x), volume / mute, duplicate, delete. Canvas ratio
  (Original, 9:16, 16:9, 1:1, 4:5, 3:4). Add media inserts after the clip under the playhead.
- Persistence: autosave (debounced, plus on background / leaving the editor), atomic writes, shared media pool
  with garbage collection.

Tested with real H.264/AAC files (portrait 1080×1920, landscape 1920×1080, square 1080×1080):
- iOS 27 simulator (iPhone 18 Pro Max): import, playback across cuts, scrubbing, pinch zoom, split, trim with ripple, speed,
  mute, reorder, clip duplicate/delete, canvas ratio, undo/redo, autosave and reopen, project rename/duplicate/delete.
- Android 15 emulator: import via the system photo picker, project list, preview, playback across cuts, scrubbing,
  select and split. The remaining tools share the same JS code but haven't been exercised on Android yet.

**Phase 2 — overlays, audio, transforms, color (done)**

- Text overlays: add at the playhead, type in place, 5 system font styles (Khmer and other scripts fall back to
  the OS fonts), 10 colors, opacity, background box. Drag to move; pinch / rotate with two fingers or the corner
  handle with one; double-tap to edit. Shown only inside their time range.
- Audio track: import music or voiceover from Files, place at the playhead, move / trim on its own lane, volume.
  Audio players are slaved to the video clock and re-synced past 0.2 s of drift.
- Overlay lanes in the timeline: text and audio stack into lanes automatically, with snapping to the playhead,
  cuts and other overlay edges.
- Clip transforms: pinch / drag / rotate the video in the canvas, Rotate 90°, Flip, Fill, Reset; crop presets
  (Full, 1:1, 4:5, 9:16, 16:9, 3:4).
- Color: 8 filters with intensity, plus brightness, contrast, saturation and warmth. Everything reduces to one
  4×5 color matrix (`core/color.ts`) that both preview implementations and both exporters apply.
- Undo / redo covers every edit; a slider drag or a burst of typing coalesces into one step.
- Projects saved by Phase 1 are migrated (schema 1 → 2) on open.

Tested on the iOS 27 simulator: everything above, including a rotated (portrait-metadata) phone video and
a music file imported from Files. On the Android 15 emulator: text add / edit, the audio picker, filters
(paused and while playing, across cuts to unfiltered clips), scrubbing.

**Phase 3 — export (done)**

- Export button in the editor → sheet with 720p / 1080p (short side), 24 / 30 / 60 fps, output size and an upper-bound
  file size estimate → progress with Cancel → saved to the photo library automatically (asks for add-only access)
  → Share sheet. H.264 MP4 with AAC audio, ~0.15 bits/pixel/frame (≈9 Mbps at 1080p30).
- Everything in the edit is rendered: trims, speed (pitch preserved), clip volume / mute, crop, transform, filters and
  adjustments, text overlays with their time ranges, music / voiceover clips mixed in.
- Leaving the app mid-export stops it with a clear message (iOS refuses GPU work in the background); cancelled or
  failed exports delete their partial file. Old exports in the cache are removed when a new one starts.

Verified by inspecting the output files with ffprobe / ffmpeg (frames, frame rate, duration, audio levels and pitch):
- iOS 27 simulator, 30 s 1:1 project (Mono + crop, rotated phone clip with Vivid, 1.65× clip, rotated text, music):
  1080p30 → 1080×1080, 897 frames at exactly 30 fps, 29.89 s, AAC stereo; ~8 s to export. 720p60 → 1794 frames at
  60 fps. Muted clip silent, music present 15.1–27.1 s, a 440 Hz tone stays 440 Hz at 1.65×. Frames match the
  preview (filters, text position / rotation / font, transforms). Cancel, background stop, Photos save, Share sheet.
- Android 15 emulator: 1080p30 and 720p24 / 720p30 exports of 9:16 and 1:1 projects (Mono, text 0–3 s, split clip,
  two overlapping music clips one starting after a gap): exact 24 / 30 fps, text placed within 1 px of the
  preview position and hidden after 3.0 s, music mixed in stereo where expected. Cancel, gallery save.

**Phase 4 — fades, animation, voiceover (done)**

- Fade in / out on video clips (0–3 s): the picture dips to / from black and the clip sound fades with it, so a fade
  out + fade in pair is a dip-to-black transition. "Fade every cut" applies one clip's fades to all clips.
- Fade in / out on music and voiceover clips.
- Text animations: In and Out, each None / Fade / Slide / Pop (0.5 s, shorter for short texts). Picking one plays that
  part of the video once so you see it.
- Voiceover: record from the playhead while the video plays muted; the take lands on the audio lane where recording
  started (stops with the button, on pause, or at the end of the video).
- Split for text and audio clips; splitting keeps fades / animations at the outer ends.
- "Apply look to all clips" in Filters and Adjust; speed presets (0.5× – 3×).
- Photos as clips (any length, saved upright as JPEG), with optional Ken Burns slow zoom.
- Crossfade transitions between clips (centered on the cut, so timing doesn't change).
- Freeze frame (inserts the frame under the playhead as a photo clip) and Save frame (to Photos), both rendered
  through the exporter so they match the export exactly.
- Text styles (Subtitle, Title, Highlight, Quote, Tag, Pop) and emoji stickers (big text layers: move, scale,
  animate and export like any text).
- Fade wedges on clips and audio bars in the timeline.
- Canvas background (Canvas panel, second row): Black, Blur (the clip scaled to cover the canvas and blurred, CapCut
  style) or a solid color, for clips that don't fill the canvas. The preview blurs the clip's poster / photo; the
  exporters blur every frame (iOS: Core Image Gaussian; Android: one-pass spiral blur in a placement shader).
  Verified on iOS by export (9:16 canvas with square, 3:4 photo + Ken Burns and 16:9 clips); Android compiles but
  was not run (the emulator would not boot with the Mac out of memory).
- Fixed: on Android, exports dropped most frames of sped-up clips (Media3 hands effects `start / speed + local`
  instead of timeline time for those clips; the frame-rate effect now converts back).

Verified by exporting a test project (three clips with fades, a 1.5× clip, slide-in / pop-out and fade texts,
music fading in and out) on both platforms and measuring the files: brightness per frame and audio level per 100 ms
follow the fades on the expected timeline seconds (e.g. −6 dB at the half-way point of a 1 s fade), iOS 300 / 300 frames,
Android 300 / 300 (239 / 240 with a 2× clip followed by a 1.5× clip), text frames match between platforms.

## Short-video upgrade

The native app now adds caption import/editing/SRT sharing, five stackable exportable effects,20 color looks,
real audio waveforms and beat markers, an offline sound library, audio looping, exact timing, copy/paste looks,
Reel/Square/Video starters,10 text styles and64 stickers. See [the workflow and implementation notes](docs/short-video-upgrade.md).

Optional project fields preserve existing schema2 documents. Native-module changes require rebuilding the development app.

## Architecture

The [app experience](docs/app-experience.md) adds Studio, Projects, and Profile tabs, local profile editing,
persisted Light/Dark/System appearance, editing/export defaults, an editing guide, and a clearly labeled
sign-in design preview. Editing remains available without an account; no backend is connected.

The [creator tools upgrade](docs/creator-upgrade.md) adds searchable tools, eight editable project templates,
15 scene effects with preset stacks, 20 text styles, 10 animation choices, searchable stickers, 18 original
offline sounds, audio mixing tools and faster cutting workflows. The notes explain each workflow and current limits.

```
src/
  app/                 expo-router screens (Studio/Projects/Profile tabs, settings, editor/[id])
  studio/              home styles, draft library, new-project workflow
  core/                pure data model + timeline math (no RN imports; unit-tested with node --test)
  storage/             project files + media import (expo-file-system, expo-image-picker)
  playback/            preview engine (expo-video player pool) + filmstrip thumbnails
  state/editor.ts      zustand store: open project, selection, edit actions, undo/redo history
  editor/              Preview, Timeline, Toolbar
  ui/                  theme + shared components
```

- **Non-destructive project document** (`core/types.ts`): source media references, a magnetic main track of
  clips with in/out points, speed and volume, plus canvas aspect. Media files are never modified.
- **Paths are stored relative** to the documents directory (`media/<id>.mov`) because the iOS app container
  path changes between app updates.
- **Media pool:** imported files live once in `Documents/media/` and are shared by projects (duplicating a
  project does not copy video). Files no project references are deleted when a project is deleted or closed.
- **Undo/redo** is snapshot-based: every edit produces a new immutable project object; the store keeps the last
  100 snapshots.
- **Preview engine** (`playback/engine.ts`): one expo-video player per source file in a small LRU pool. The
  next clip's file is preloaded and parked on its in-point, so a cut between files is a view swap. Contiguous
  pieces of one file (after a split) play through without seeking.
- **Preview color** (`modules/smile-engine`, a local Expo module): iOS pulls frames with
  `AVPlayerItemVideoOutput` and draws them through `CIColorMatrix` into a Metal view on top of the player; Android
  draws the player's `TextureView` through a `ColorMatrixColorFilter`. Both run on the GPU with no copies in JS.
- **Export** (`core/export.ts` → `modules/smile-engine`): JS flattens the project into a render spec in output pixels
  and timeline seconds (unit-tested), the native exporters only draw it.
  - iOS (`SmileExporter.swift`): AVAssetReader decodes each clip, Core Image applies crop / color matrix / transform
    and composites pre-rendered text, AVAssetWriter encodes one frame per output tick (frames are picked by time, so
    any source rate becomes an exact 24 / 30 / 60 fps). Audio: an AVMutableComposition (clip sound scaled for speed,
    music tracks) mixed with an AVAudioMix, read with the spectral time-pitch algorithm. No AVVideoComposition, so the
    iOS 27 compositor bug doesn't apply.
  - Android (`SmileExporter.kt`): Media3 Transformer. Main track = one sequence (clipping, speed, volume, crop,
    placement matrix, RGB matrix), each music clip = an audio-only sequence starting with a gap, text = one
    composition-level overlay effect (sees timeline time). A small effect snaps frames to the 1/fps grid.
- **Fades and text animation** are pure functions in `core/timeline.ts` (worklets, so the preview evaluates them on
  the UI thread every frame). Exporters get fades as piecewise-linear keyframes (`envelope`): iOS turns them into
  `AVAudioMix` volume ramps and a per-frame opacity, Android into an `RgbMatrix` effect and a small audio processor.
  Text animation is re-implemented line for line in both exporters (`animPhase`).
- **Voiceover** uses expo-audio. expo-video resets the iOS audio session to `.playback` on every player change, which
  would end a recording, so `patches/expo-video+*.patch` leaves a `.playAndRecord` session alone. SDK 57 links
  expo-video as a prebuilt XCFramework, which would ignore the patch, so `package.json` →
  `expo.autolinking.ios.buildFromSource` builds it from source.
- **Timeline** runs its gestures and layout on the UI thread (Reanimated shared values); React only re-renders
  when the edit is committed or the virtualization window moves.
- **Future AI tools** (Khmer subtitles, translation, dubbing, voiceover) fit the same model as additional
  timed tracks (text / audio) that reference generated assets; the main track and storage layer don't change.

## Known limitations (honest list)

- Preview cuts between two *non-contiguous* clips of the same file share one player, so that cut costs a seek
  (a brief hitch). Cuts between different files and split points are seamless.
- Timeline filmstrips are regenerated each session (in-memory native images, ~1 frame/second, max 120 per file);
  the poster frame on the home screen is persisted.
- Android export can lower the frame rate (60 → 30 / 24, 30 → 24) but never adds frames: Media3 has no frame
  duplication, so 60 fps from 30 fps sources exports at 30 fps. (iOS repeats frames and always hits the target.)
- Android may encode portrait video as landscape plus a 90° rotation tag (Media3 does this for encoder
  compatibility); players honor the tag (checked with ffmpeg, which shows it as 720 × 1280).
- Export runs only while the app is open (keep-awake is on during export). The emulator's software encoder is slow
  (~1080p at 1/8 real time); real devices use the hardware encoder.
- Text in exports is drawn natively with the same fonts, sizes and styles as the preview; line spacing and the
  shadow can differ by a pixel or two from React Native's text layout.
- iOS 27: an `AVVideoComposition` with a custom or Core Image compositor makes `AVPlayerItem` playback fail
  (-11800 / -12784, [Apple forums 837179](https://developer.apple.com/forums/thread/837179)). That is why preview
  color uses a frame-output overlay instead, and export renders frames itself rather than through a compositor.
- Android: Media3's `setVideoEffects` left the preview black on the emulator, so preview color is applied at
  the view level instead. Export will still use Media3 effects in Transformer.
- Preview audio sync is preview-grade (re-synced past 0.2 s drift); exports mix sample-accurately.
- Android emulator: the preview can go black for a moment while timeline filmstrips are still being decoded (right
  after a project opens): two preview players plus the thumbnail decoder exceed the emulator's video decoders, and
  logcat shows codec reclaim. A preview player that fails to load in that window is evicted and retried once. Not
  seen on iOS; not yet checked on a physical Android device.
