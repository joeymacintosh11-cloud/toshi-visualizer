# Toshi Visualizer — Project Handoff

## 1. Project Goal

A local, reusable visualizer generator for **Toshi**, a music production / beat-licensing brand. It runs entirely on the user's machine (no cloud services, no paid APIs).

Core use case:
- upload a beat (WAV/MP3)
- upload a cinematic background video (MP4/MOV)
- enter beat metadata (title, type-beat line, BPM, key, producer)
- preview a beat-reactive, branded visualizer live in the browser
- export a finished, YouTube-ready MP4

Brand direction: 2000s hip-hop, boom bap, gritty but premium, cinematic, early-2000s street/DVD aesthetic. Explicitly **not** EDM, not gaming, not generic SaaS.

## 2. Current Project Location

```
C:\Users\joeym\claude-projects\toshi-visualizer
```

Start the project:
```
npm run dev
```
App URL: **http://localhost:5173**

`npm run dev` starts **one process** — Vite's dev server also hosts the local Node/Express backend as middleware (see §3). There is no second port and no `concurrently` setup; that was a deliberate architecture choice.

FFmpeg and ffprobe are installed natively via `winget install Gyan.FFmpeg` and are on PATH. Confirmed working as of the last session (`GET /api/ffmpeg-status` returned `available: true`). If a fresh terminal/session ever reports them missing, it's almost always a stale PATH in that particular shell, not a real uninstall — restart the terminal first.

## 3. Current Architecture

**Frontend** — React 19, Vite 8, TypeScript, Canvas 2D, Web Audio API. Runs entirely in the browser: UI, live preview, Canvas rendering, audio analysis (FFT + transient detection), and the beat-reactive visual engine all live here. `zustand` holds app state (`src/state/store.ts`).

**Local backend** — Plain Node, mounted as Vite dev-server middleware via a custom Vite plugin (`server/vitePlugin.ts` → `nativeProxyBackendPlugin()`), using `express` + `multer` for routing/uploads. It shells out to **native ffmpeg/ffprobe** (no ffmpeg.wasm anywhere in the project anymore — see §11). This is why `npm run dev` alone is sufficient: the plugin's `configureServer(server)` hook does `server.middlewares.use(app)`, so Express handles `/api/*` inside the same process Vite already runs.

Responsibility split:
- **Browser**: UI, live Canvas preview, Web Audio analysis, beat-reactive rendering, per-frame JPEG encoding during export.
- **Native backend**: preview-proxy transcoding (ffprobe + ffmpeg), and final video encoding + audio muxing for export.

## 4. Proxy Workflow

ffmpeg.wasm is **not** used for proxy generation (or for anything else in the project — it was fully removed).

Flow: on background upload, the browser decides client-side (via `decideBackgroundProxy` in `src/video/backgroundProxy.ts`) whether the source is already lightweight (≤1920×1080 **and** ≤50MB → skip, use original directly). If not, the file streams to `POST /api/proxy` (see `server/proxyApi.ts`), which:
1. writes the upload to `temp/sources/` via `multer.diskStorage` (true disk streaming, never buffered fully in memory),
2. runs `ffprobe` for source metadata (resolution, codec, fps, duration),
3. runs native `ffmpeg` to produce a proxy: target **≈1280×720 / 30fps / H.264**, scaled down only if the source is wider (never upscales), landscape assumed,
4. writes the proxy to `temp/proxies/<sanitized-name>-preview-<cachekey>.mp4` plus a `.json` sidecar with both original and proxy metadata,
5. returns the proxy URL to the frontend.

The **original source is retained separately** (as the browser's in-memory `File` object, referenced via a `blob:` URL) and is what final export reads from — the proxy is preview-only. Caching: the cache key is a hash of `(originalName, fileSize, lastModified, proxy settings)` — re-uploading the identical file skips re-transcoding entirely (`GET /api/proxy/exists` lets the frontend check before even uploading). `temp/proxies/` currently has two real cached entries from actual Pexels 4K test footage, confirming this path has been exercised successfully with real content.

This architecture is what fixed the original problem: 4K Pexels background video caused stuttering/failure in the live preview when the browser tried to decode the full-resolution source directly. The proxy is now what the live `<video>` element actually plays.

## 5. Preview Quality

Defined in `src/renderer/qualityTiers.ts`:

| Tier | Canvas resolution |
|---|---|
| Low | 854×480 |
| Medium (default) | 1280×720 |
| High | 1920×1080 |

This only changes the **internal Canvas render resolution for the live preview** (`PREVIEW_QUALITY_DIMENSIONS`) and, at Low, trims a few expensive effects (skips highlight bloom, disables chromatic aberration, reduces grain/scanline cost — see `getQualityAdjustments()`). It has **no effect on export**: `VisualizerEngine.renderFrame()` defaults `qualityTier` to `'high'` when the caller doesn't pass one, and the export path never passes it, so export is always full-fidelity regardless of what the live preview is set to.

## 6. Visualizer Design

Current layout (all values sourced from `src/renderer/designTokens.ts`; drawn by `src/renderer/typographyRenderer.ts` + `backgroundRenderer.ts`):

**Top-left** — Toshi logo (`/public/branding/toshi-logo.png`, same-origin, loaded via `App.tsx` into `HTMLImageElement`). Enlarged in the V2 design pass (`LOGO_HEIGHT_RATIO` ≈0.092 of canvas height). A soft **radial** dark backing glow sits behind it (never a rectangle) for legibility over bright/busy footage, plus a small drop shadow.

**Under the logo** — the Toshi signature block (`drawSignature()`): a thin gold index rule, then `TSH / 001` in gold, then a smaller/dimmer `TOSHI AUDIO` sublabel. Static — no audio-reactive modulation, by design (brand recognition, not visual activity).

**Lower-left (main)** — the beat title. Auto-fits width via `ctx.measureText()` (`fitTitleFontSize()` in `typographyRenderer.ts`) — short titles get a large, bold size; long titles shrink to fit without ever overlapping the metadata zone or overflowing the frame. Cream/off-white fill, three-layer treatment (soft dark shadow → faint warm gold glow → thin dark stroke + crisp fill), plus an extremely subtle horizontal compression (`TITLE_HORIZONTAL_COMPRESSION` ≈0.985) for an analog feel.

**Below the title** — the type-beat line. Opacity raised to **0.84** (`TYPE_LINE_OPACITY`) in the latest refinement pass for readability, plus a subtle drop shadow for footage separation, wide letter-spacing, same left alignment as the title.

**Right side** — metadata module (`drawMetadata()`): BPM largest and gold (strongest), key medium/cream (secondary), producer smallest/dimmest — right-aligned, with a thin gold rule above.

**Bottom bar** (`drawBottomBar()`): left = usage notice, center = purchase CTA in gold, right = website — on a soft gradient/translucent scrim, not a solid bar.

## 7. Brand Tokens

```
Black:      #0B0B0B
Cream:      #F4E8D0
Gold:       #B8860B
Dark Red:   #7A1E1E
Dark Green: #2D3A2E
```
Defined in `src/renderer/brandColors.ts` (`BRAND_COLORS`), re-exported through `src/renderer/designTokens.ts`, which is the **single centralized source** for spacing, typography sizing, opacity, shadow values, line thickness, logo treatment, and signature-block treatment. New visual work should add tokens here rather than hard-coding magic numbers in the renderer files.

## 8. Audio-Reactive Behavior

**Do not refactor this engine** unless fixing a demonstrated bug — it is considered stable and has been deliberately tuned across several passes.

- `src/audio/fft.ts` — dependency-free radix-2 FFT, used for deterministic offline analysis (so export always reacts identically to a given beat, independent of the machine's realtime performance).
- `src/audio/audioAnalyzer.ts` — full pre-analysis (`analyzeAudioBufferDeterministic`, used by export) plus the live `AnalyserNode`-based path used by the preview.
- `src/audio/transientDetector.ts` — kick/transient detection: current bass energy vs. a recent moving average, with an attack/decay envelope. Time-based, shared logic for both realtime (variable dt) and deterministic (fixed dt) use.

Band → visual mapping (`src/renderer/canvasRenderer.ts`):
- **Bass** → background push/zoom, title punch, vignette pulse.
- **Mids** → micro camera shake, line/exposure flash.
- **Highs** → grain, scanlines, flicker.

Motion-polish refinements already applied and validated:
- title-punch and background-zoom reactions are smoothed via a one-pole low-pass filter (`TITLE_PUNCH_SMOOTHING`, `BACKGROUND_ZOOM_SMOOTHING` in `canvasRenderer.ts`) rather than snapping instantly to the target value.
- camera shake uses smooth deterministic value-noise (`smoothNoise01()` in `effectsRenderer.ts`) instead of independent per-frame random jitter — reads as organic drift, not digital vibration. Still fully deterministic (pure function of frame index), so export reproducibility is unaffected.
- flash/flicker peak intensities were deliberately reduced; high-frequency texture reactivity (grain/scanline modulation) was reduced to stay restrained rather than overwhelming the footage.

## 9. Presets

`src/presets/defaultPresets.ts` — infrastructure and `localStorage`-backed custom presets (`src/presets/presetStorage.ts`) are stable, untouched by the visual passes.

- **Toshi Classic** — clean, warm, minimal reaction (lowest camera shake/punch/grain of the four).
- **Gritty 2000s** — stronger grain and contrast, comparatively *subtle* scanlines, mild chromatic aberration, stronger punch.
- **Clean Cinematic** — `twoThousandsMode: false` (skips the warm-tint/bloom treatment entirely), near-zero grain/scanlines/shake/CA, a touch of blur for soft cinematic processing.
- **Street DVD** — `showOverlays: true` (DVD/camcorder-style technical overlays, timecode), strongest scanlines of the four, moderate contrast/grain — premium, not parody-VHS.

## 10. Important Files

**Renderer (shared by preview and export — Canvas is the single source of visual truth):**
- `src/renderer/designTokens.ts` — centralized visual constants.
- `src/renderer/brandColors.ts` — raw brand hex values.
- `src/renderer/canvasRenderer.ts` — `VisualizerEngine` class; orchestrates one full frame (background → typography → texture/effects → chromatic aberration composite). Owns the audio-reactive smoothing state.
- `src/renderer/typographyRenderer.ts` — logo, signature block, title, type line, metadata, bottom bar, optional DVD overlays.
- `src/renderer/backgroundRenderer.ts` — background video draw (fit/pan/zoom), 2000s warm color-grade + bloom, "preparing preview" placeholder.
- `src/renderer/effectsRenderer.ts` — grain, scanlines, vignette, chromatic aberration, camera shake, flicker/flash.
- `src/renderer/backgroundTiming.ts` — `resolveBackgroundTime()`, shared by live preview and export so background loop/offset/speed behave identically in both.
- `src/renderer/qualityTiers.ts` — preview-only performance tiers (§5).

**Audio:**
- `src/audio/fft.ts`, `src/audio/audioAnalyzer.ts`, `src/audio/transientDetector.ts` (§8).

**Playback / preview:**
- `src/components/Preview/usePlaybackEngine.ts` — live playback engine: audio/video sync, live `LiveAudioAnalyzer` wiring, drives `VisualizerEngine` each animation frame.
- `src/components/Preview/Preview.tsx`, `PreviewQualitySelector.tsx`.

**Proxy (frontend side):**
- `src/video/backgroundProxy.ts` — client-side proxy decision + upload/streaming to the backend. **Note:** its top-of-file comment is stale — it still says "ffmpeg.wasm is still used elsewhere for final export," which is no longer true (see §11). Worth a one-line comment fix next time this file is touched; not urgent.

**Export (frontend side):**
- `src/export/videoExporter.ts` — `exportVisualizerVideo()`, the full native export pipeline (§12). `ExportError` class, `buildExportFilename()`, `cleanupExportRender()`.
- `src/components/ExportPanel/ExportPanel.tsx` — resolution/fps/quality UI, triggers export, shows progress, Cancel button, error display.

**Backend:**
- `server/ffmpegNative.ts` — binary detection (`getFFmpegStatus`, PATH + `FFMPEG_PATH`/`FFPROBE_PATH` env override), `probeVideo()` (ffprobe wrapper), `generateNativeProxy()`, exported `spawnCapture()` helper (reused by `nativeExporter.ts`).
- `server/tempStorage.ts` — temp directory management (`temp/sources`, `temp/proxies`, `temp/exports`), cache-key hashing, `sanitizeWindowsFilename()`.
- `server/proxyApi.ts` — `/api/proxy*` and `/api/ffmpeg-status` routes.
- `server/exportApi.ts` — `/api/export/*` routes (§12).
- `server/nativeExporter.ts` — export process registry, `createExportRender()`, `streamFramesToVideo()` (pipes an incoming request stream into ffmpeg's stdin), `muxExportAudio()`, `cancelExport()`, `cleanupExport()`.
- `server/vitePlugin.ts` — mounts both routers + static-serves `temp/proxies/` into Vite's dev server.

**Other:**
- `vite.config.ts` — registers `nativeProxyBackendPlugin()`.
- `src/state/store.ts` — zustand store; default `BeatInfo` (title "GHETTO GEEK", BPM **"94"**, key "F MINOR", producer "Prod. Toshi" — note the UI is live-editable, so the *currently displayed* values in a running session may differ from these code defaults; verify in-app before relying on a specific value).
- `src/types/visualizer.ts` — shared types, including `ExportStage` (`idle | analyzing-audio | preparing-render | rendering-frames | encoding-video | muxing-audio | done | cancelled | error`).

This project is **not a git repository** (`git status` returns "not a git repository"). There is no version history to diff against — this handoff document is the primary record of what changed and why.

## 11. FFmpeg / Native Backend

Installed via `winget install Gyan.FFmpeg` (build: `ffmpeg version 9.0.1-full_build-www.gyan.dev`). Both `ffmpeg` and `ffprobe` resolve via plain PATH lookup (confirmed last session: `{"available":true,"ffmpeg":{"found":true,"command":"ffmpeg",...}}`).

Native ffmpeg/ffprobe are used for **everything** media-related now — proxy generation and final export both. `ffmpeg.wasm` and its packages (`@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/core`) were fully removed from `package.json`, along with the bundled `public/ffmpeg/` wasm assets (~32MB), after final export was migrated off it. `grep -rl "@ffmpeg" src/` returns nothing.

Environment overrides (optional, only needed if ffmpeg/ffprobe aren't on PATH): `FFMPEG_PATH`, `FFPROBE_PATH` — read in `server/ffmpegNative.ts`'s `resolveBinary()`.

Binaries are spawned via Node's `child_process.spawn` **without** `shell: true` (deliberately — Windows resolves `.exe` via PATH/PATHEXT without a shell, and this avoids Node's DEP0190 shell-quoting deprecation warning).

## 12. Final Export Architecture

Replaces the old ffmpeg.wasm export pipeline entirely. Flow (`src/export/videoExporter.ts` ↔ `server/exportApi.ts` + `server/nativeExporter.ts`):

1. `POST /api/export/start` — multipart: JSON config (width/height/fps/crf/preset/audioBitrate/filename) + the original audio file. Backend creates `temp/exports/<16-hex-char-id>/`, stages the audio there, returns `{ renderId }`.
2. Audio pre-analysis runs exactly as before (`analyzeAudioBufferDeterministic`, unchanged).
3. For each frame (driven by a `ReadableStream`'s `pull()` callback — proper backpressure, never buffers ahead): `VisualizerEngine.renderFrame()` draws to an offscreen `<canvas>` (same engine/tokens as preview), then `canvas.toBlob('image/jpeg', quality.jpegQuality)` encodes it.
4. Each frame's JPEG bytes are `enqueue()`d into the stream, which is the **body of a single streaming `fetch()`** (`POST /api/export/:id/frames`, `duplex: 'half'`) — not one request per frame.
5. The backend pipes the raw incoming request stream directly into a native `ffmpeg -f mjpeg -r <fps> -i pipe:0 -c:v libx264 ...` process's stdin (`streamFramesToVideo()`). ffmpeg's `mjpeg` demuxer reads the concatenated JPEG stream natively — no per-frame files, no thousands of files on disk, no full-video buffer in memory on either side.
6. Once the frontend closes the stream, ffmpeg finishes and writes `video.mp4` (video-only).
7. `POST /api/export/:id/mux` — native `ffmpeg -i video.mp4 -i audio.<ext> -c:v copy -c:a aac -b:a <bitrate> -shortest -movflags +faststart` produces `final.mp4`; the two intermediates are deleted immediately after.
8. `GET /api/export/:id/download` streams `final.mp4` back with a correct `Content-Disposition: attachment; filename="Toshi - <Title> Visualizer.mp4"` header (Windows-invalid characters stripped via `sanitizeWindowsFilename()`).
9. Frontend triggers the browser's native download via an `<a download>` click against that URL (no Blob round-trip through JS memory for the finished file).
10. `DELETE /api/export/:id` cleans up the temp directory — called on success (~15s after triggering download), on cancel, and on failure.

**Deliberate deviation from a literal "raw RGBA via stdin" design**: frames are JPEG, not raw RGBA. Raw RGBA at 1080p30 for 3 minutes would be ~43GB of data through the pipe; JPEG brings that to roughly 1-2GB with no meaningful quality loss once re-encoded through H.264 anyway. This was validated directly (see below) — not a guess.

Quality presets (`QUALITY_PRESETS` in `videoExporter.ts`):

| | Draft | High | Maximum |
|---|---|---|---|
| crf | 26 | 18 | 17 |
| preset | veryfast | medium | slow |
| jpegQuality | 0.85 | 0.95 | 0.98 |
| audioBitrate | 320k | 320k | 320k |

Resolution options: 1920×1080, 2560×1440, 3840×2160. Framerate: 24/25/30/60. All still UI-selectable in `ExportPanel.tsx`, unchanged.

**What was actually validated last session** (via direct Node-script HTTP calls hitting the API — see caveat in §14): a real 15-second 1920×1080/H.264 render end-to-end (start → stream 450 real JPEG frames → mux → download), verified with `ffprobe` to have exactly 1920×1080, 30fps, correct H.264+AAC streams, and **exact** duration match with no drift. Also validated: mid-stream cancellation (kills the ffmpeg process, cleans up, no orphaned process), and a genuine ffmpeg failure case (confirmed the error-reason extraction produces a real message, not a placeholder).

## 13. Current Blocking Bug

**THIS SECTION IS CRITICAL — reported by the user after the last coding session, not yet reproduced or fixed.**

A real 3-minute export **fails**, despite the synthetic backend testing above succeeding.

Test case:
- Beat: "Ghetto Geek MASTER.wav", ~3:05
- 1920×1080, 30fps, High quality
- Expected total frames: ≈5555

Observed: export starts, then fails almost immediately — the progress UI shows:
```
Rendering frame 1 / 5555
```
and then:
```
Export failed: unexpected error
```

This points to a failure at or near the **very first frame / the browser-to-backend streaming boundary**, not a long-duration memory issue. The previous session's synthetic validation (§12) exercised the *backend* pipeline directly via Node scripts and it worked — so the gap is most likely somewhere in the **real browser** path that synthetic testing didn't cover: actual `HTMLVideoElement`/`HTMLImageElement` sources, actual Chrome `fetch()` streaming-body semantics, or an interaction between them.

## 14. Suspected Causes for Current Export Failure

User-supplied hypotheses, plus additional context found via code inspection this session (no code changes made — inspection only):

**A. `canvas.toBlob` failure** — could return `null`, or the canvas could be tainted.

**B. Cross-origin/proxy video issue** — *Code-inspection note*: the logo loads from `/branding/toshi-logo.png` (same-origin) and the background video is either a `blob:` URL (original `File` object) or `/temp/proxies/...` (same-origin, backend-served) — both should be taint-safe by the same-origin/blob rules. This makes B *less* likely than it first appears, but it has not been verified live in a browser this session, so don't rule it out — check DevTools console specifically for a `SecurityError` on `toBlob`/`getImageData`.

**C. Streaming-`fetch` issue** — `duplex: 'half'` **is already present** in the current code (`videoExporter.ts` line ~265). *Code-inspection note*: last session's validation used **Node's own `fetch` (undici)**, not an actual browser — genuine Chrome `fetch()` with a `ReadableStream` request body was never actually exercised end-to-end. This is the most likely gap and the top suspect.

**D. Backend stream handling** — *Code-inspection note*: `server/exportApi.ts`'s `/export/:id/frames` route applies **no** body-parsing middleware before `streamFramesToVideo(id, req)` — `req` is piped raw. No global JSON/urlencoded parser is registered anywhere in `vitePlugin.ts` either. This looks correct by inspection but should still be confirmed with a real browser request (Vite's own middleware chain in front of Express could conceivably behave differently for a browser-originated request than for Node's fetch).

**E. FFmpeg stdin readiness** — a frame could arrive before the child process's stdin is actually writable. `streamFramesToVideo()` spawns the child and calls `.pipe(child.stdin)` synchronously in the same function; Node buffers writes internally so this is expected to be safe, but worth instrumenting if the simpler causes are ruled out.

**F. Swallowed error detail — CONFIRMED by code inspection, not a hypothesis.** In `videoExporter.ts`'s catch-all (bottom of `exportVisualizerVideo`):
```ts
throw new ExportError('unexpected error', err instanceof Error ? err.message : String(err));
```
`ExportError.reason` is **always** `'unexpected error'` here — the real detail only goes into `.message` (via the constructor). `ExportPanel.tsx` displays only `` `Export failed: ${err.reason}` ``, never `.message`. So **"unexpected error" is confirmed to be a generic catch-all label, not a distinct error type** — the real underlying error/stack **is** logged to the browser console (`console.error('[export] failed:', err)` in `videoExporter.ts`, and again in `ExportPanel.tsx`'s catch block), just not shown in the UI. **First debugging step: open DevTools console during a failed export and read the actual logged error object** — this alone may immediately reveal which of A–E is real.

## 15. NEXT TASK — FIRST FRAME EXPORT DEBUG

Do **not** attempt a full 3-minute export first. Debug in this order:

- **Test A**: 1 frame, 1920×1080, graphics only (no background video, no logo) — isolates Canvas/toBlob/stream/ffmpeg-stdin mechanics from any asset-loading concern.
- **Test B**: 1 frame, background video only — isolates the video-element-as-canvas-source path.
- **Test C**: 1 frame, full visualizer (background + logo + all overlays).
- **Test D**: 30 frames / 1 second, full visualizer — first real multi-frame test of the stream.
- **Test E**: 15 seconds, 1080p30, full visualizer — matches what was already validated synthetically; if this fails in a real browser but succeeded synthetically last session, that isolates the bug to the browser-specific path (most likely C above).

Only retry the full Ghetto Geek export after A–E all pass.

**Required instrumentation** (add temporarily if not already sufficient): export job creation / export ID / resolution/fps/quality / audio upload / canvas dimensions / `renderFrame()` completion / `canvas.toBlob` start+result / blob MIME + byte size / frame request start / frame endpoint reached (backend-side log) / request headers received / bytes reaching ffmpeg stdin (backend-side byte counter) / ffmpeg PID + spawn state / stdin writable state / ffmpeg stderr / backend HTTP response status+body.

Explicitly inspect: `canvas.toBlob` returning `null`; a `SecurityError` from canvas tainting; the actual origin of the background video and logo image at the moment of failure; whether `duplex: 'half'` is actually being honored by the browser in use; whether any middleware is consuming/altering the raw request body; ffmpeg stdin readiness timing.

**Goal**: replace the generic `Export failed: unexpected error` with the real, specific, actionable reason — the same standard already achieved for the proxy pipeline's error messages (e.g. *"Nothing was written into output file, because at least one of its streams received no packets"* rather than a placeholder).

## 16. Stable Systems — Do Not Touch

Unless a confirmed bug requires it, do not change:
- `src/audio/*` (FFT, analyzer, transient detection)
- beat-reactive behavior / motion smoothing in `canvasRenderer.ts` / `effectsRenderer.ts`
- visual design, `designTokens.ts`, typography layout
- presets (`src/presets/*`)
- preview synchronization (`usePlaybackEngine.ts`, `backgroundTiming.ts`)
- proxy generation (`server/proxyApi.ts`, `server/ffmpegNative.ts`'s proxy-related functions, `src/video/backgroundProxy.ts`)

The only currently active bug is final export (§13-15).

## 17. Current Test Content

Beat: `Ghetto Geek MASTER.wav` (~3:05)

Metadata (verify current live values in the running app — the store's code *defaults* are noted for reference, but BPM/title/etc. are user-editable and may have been changed in the session):
- Title: `GHETTO GEEK`
- Type line: `50 CENT X 2000s HIP-HOP TYPE BEAT`
- BPM: code default is `94` — **verify actual current value in-app before relying on it** (user's draft notes suggested checking, unconfirmed)
- Key: `F MINOR`
- Producer: `TOSHI` (code default is `Prod. Toshi`)
- Website: `toshibeats.com` / displayed as `TOSHIBEATS.COM`

Background: 4K Pexels basketball/street footage. Proxy preview generation is confirmed working smoothly (two real cached proxies exist in `temp/proxies/` from this footage).

## 18. Development Rules

- Inspect the existing implementation before rewriting anything.
- Fix concrete, demonstrated causes — not symptoms.
- Never silently swallow an ffmpeg exit code; always check it and capture stderr.
- Surface useful, specific errors to the UI — not generic placeholders.
- Do not reintroduce ffmpeg.wasm.
- Prefer native ffmpeg for all heavy media work.
- Keep Windows compatibility (no POSIX-only assumptions; spawn without `shell: true`; sanitize filenames for Windows-invalid characters).
- Stream to/from the filesystem and child processes where possible; avoid large in-memory buffers (this is why frames are piped, not written to thousands of temp files).
- Run TypeScript check, lint, and production build after any non-trivial change:
  ```
  ./node_modules/.bin/tsc -b
  npx oxlint
  npm run build
  ```
- Preserve working systems — the audio engine, visual design, presets, and proxy pipeline are all stable and validated; only final export is currently broken.

## 19. Current Status

**WORKING:**
- App UI (dark, gold-accented, two-column layout)
- Beat upload
- Background upload
- 4K proxy generation (native ffmpeg backend)
- Smooth live preview (proxy-backed)
- Audio-reactive Canvas rendering
- Presets (4 built-in + custom via localStorage)
- Toshi Visual Design (logo, signature block, title auto-fit, metadata hierarchy, bottom bar)
- Native FFmpeg detection (`GET /api/ffmpeg-status`)
- Local backend (Vite-middleware Express server)
- Preview proxy cache

**NOT YET WORKING:**
- Reliable final MP4 export for a real, full-length beat.

**Current blocker:** first-frame export failure in a real browser session (§13-15) — not yet reproduced or fixed this session; only diagnosed via code inspection and prior synthetic (non-browser) testing.

## 20. Resume Instructions

When continuing in a fresh Claude Code context:

1. Read `HANDOFF.md` first.
2. This project is **not a git repository** — skip `git diff`/`git status`; there is no version history to compare against. Use this document plus direct file inspection instead.
3. Do not redo completed architecture (native proxy pipeline, visual design system, audio engine — all stable, see §16).
4. Reproduce the one-frame export failure in an actual browser (`npm run dev`, open `http://localhost:5173`, attempt a real export) — this has not yet been done this session.
5. **Check the browser DevTools console first** — §14/F confirms the real error is already being logged there, just not shown in the UI.
6. Debug the exact first-frame boundary using minimal tests A–E from §15, in order.
7. Only retry the full Ghetto Geek export after those tests pass.
