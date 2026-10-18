# Short-video editing upgrade

Work lives in `/Volumes/Transcend/Smile Studio`, the Expo native app. The separate Smile Media Film website is a different project.

## Editing workflows

- Start a Reel (9:16), Square (1:1), or Video (16:9) directly from Home, using the same photo/video import and autosave flow.
- Select a main clip → Effects: stack vignette, film grain, scanlines, cinema bars and warm light leak. Each has its own intensity, reset and apply-to-all. Effects stay beneath titles and follow scene fades/crossfades. Grain is a fixed source texture, so seeking, splitting and saving a frame retain it.
- Select a clip → Filters: 20 choices including None; intensity and existing brightness/contrast/saturation/warmth adjustments share native preview/export math. Copy look / Paste look carries only color and effects.
- Captions: import SRT or WebVTT; add a caption at the playhead; edit text and exact start/end; split long captions; style or shift all captions; share an SRT. Imported captions append without replacing titles. Overlapping caption timings fail atomically. Khmer, emoji and multiline text are preserved.
- Sounds: three original synthesized music beds and six sound effects, generated and cached offline. Preview a sound before adding at the playhead. Added music starts at 35% volume with short fades and is trimmed to the video end. Select audio → Loop to end repeats its trimmed source section, clips the final copy, and performs one undoable edit. More than 64 repeats is rejected with a useful error; repeating the same operation does not duplicate existing copies.
- Timeline: actual decoded source waveforms for audio/video. Select audio or video → Beats finds energy-rise candidates in the trimmed source and maps through source offsets and speed. Mark adds a bookmark at the playhead. Markers are seekable, removable and included in trim snapping.
- Timing: source in/out for media, timeline start for audio, and exact start/end for text. Invalid ranges and caption collisions cannot be committed.
- Text now has 10 one-tap styles and 64 emoji stickers, including Cambodian flag and lotus.

## Engineering details

Optional `effects`, `caption` and `markers` properties preserve schema 2 project compatibility. Effects resolve into shared normalized primitives; React Native preview, Core Graphics and Android Canvas use the same geometry. iOS scene alpha compositing uses sRGB transfer handling to match preview colors. Still-frame export carries the same primitives and source texture seed.

Native audio analysis runs off the UI thread, streams bounded PCM energy/peaks, and never creates a guessed BPM grid for silent/steady audio. Analysis is serialized/cached by source, limited to 30 minutes/512MB with timeout and cancellation. Unavailable analysis falls back to an undecorated clip; explicit Beats reports an error.

Preview audio allocates at most 8 overlay players, usually just the active and next two clips. It releases retired players before preparing replacements. More than 8 simultaneous audible layers shows a preview warning; native export still mixes the project’s audio tracks.

Speech-to-text generation, background removal, tracking, advanced speed curves and cloud AI are not included in this change. Caption import/editing works entirely on device without a service account.

## Verification — 18 October 2026

- All 61 automated tests pass, including caption import/collision handling, Undo draft reconciliation, marker mapping, long-source audio analysis, sound generation, bounded playback allocation and voiceover save races. TypeScript, ESLint and `git diff --check` pass.
- The full iOS Debug simulator app builds successfully. Android's `:smile-engine:compileDebugKotlin` succeeds with the final effects, audio analysis, HDR conversion and overlay batching changes.
- The rebuilt iPhone 16 simulator app passes 10 native bridge integration checks. Its decoder returns 1,024 waveform bins and all 32 half-second onsets from the original 16-second test music. Trimming source seconds 2–6 and playing at 2× correctly places eight markers between timeline seconds 1 and 3.
- The app's actual JS export builder and native bridge produce an 8-second 720 × 1280, 24 fps H264/AAC MP4 with all five effects, fades, a transition, music, and English/Khmer titles. The native compositor is also checked independently against reference effect pixels, scene fades, crossfades and still-frame slices.
- Native editor layouts for captions, sounds, effects and waveforms are inspected in simulator screenshots. The caption panel adapts to the screen height to retain a useful preview area.

GUI automation became unavailable during verification. Developer integration checks and rendered screenshots cover the paths above; microphone recording, system picker/share gestures, physical devices and Android runtime export have not been exercised in this run. No App Store release or deployment is implied.

Saved proof: [native MP4](verification/2026-10-18-short-video/native-export.mp4), [sampled frames](verification/2026-10-18-short-video/export-frames.png), [caption detail](verification/2026-10-18-short-video/caption-detail.png), and [machine-readable verification](verification/2026-10-18-short-video/native-export-verification.json). The source is a synthetic test scene and original synthesized music.

The final app is also captured running from the actual workspace: [Home](verification/2026-10-18-short-video/home.png) and [Effects with decoded waveforms](verification/2026-10-18-short-video/effects.png).
