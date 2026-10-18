# Extract audio verification

Verified on 18 October 2026 in the installed iPhone 16 development app.

Select a video and tap **Extract audio**, or search **extract audio** in All tools.
The independent audio track retains the selected source trim, timeline placement,
volume and fades. The original video is muted in the same undo step. Audio tools
opens with the new track selected. Extraction requires 1× video speed and an
audible, readable source range. The source media file is shared without modification.

## Fresh checks

- All 111 Node tests passed, including selected-range silence/error cases and export integration.
- TypeScript and Expo lint passed with no errors or warnings.
- External-drive dependency reads delayed the original checks, which eventually passed. Checks also passed in `/private/tmp/smile-studio-verified`; all 93 source and dependency configuration files matched the original checkout by hash. The original checkout remains authoritative.
- Mounted native clip-toolbar and All tools search handlers both created the audio track. The tool search sheet dismissed before extraction.
- A trimmed clip at timeline second 1 retained source seconds 3–7, 60% volume and 0.1/0.2-second fades. Only the selected original was muted. Undo restored its sound and removed the audio track together; redo restored the extraction.
- A silent trimmed range showed a descriptive error and left the project unchanged. The audio panel disabled extraction at 2× speed.
- A fresh native five-second 720×1280 H.264/AAC export fully decoded. Its first second remained silent, and extracted audio RMS matched the expected 60% source gain within 0.002 per channel.
- The isolated test project/media were removed and the previously open project restored. Original saved project hashes were checked after cleanup.

Native actions were exercised through mounted React handlers via the development debugger, with simulator screenshots. Physical-device touch/audio and Android runtime verification are not claimed. No native module changes or new native build were required.

## Evidence

- `clip-toolbar.png`, `tool-search.png`, `audio-settings.png`
- `native-extraction.json`, `native-search-action.json`, `native-edge-cases.json`
- `native-export.json`, `extract-audio-proof.mp4`, `export-analysis.json`
- `tests.log`, `source-manifest.json`, `restoration.json`
