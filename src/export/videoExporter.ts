import type {
  BackgroundSettings,
  BeatInfo,
  EffectSettings,
  ExportProgress,
  ExportSettings,
} from '../types/visualizer';
import type { AudioFileInfo, BackgroundFileInfo } from '../state/store';
import { analyzeAudioBufferDeterministic } from '../audio/audioAnalyzer';
import { VisualizerEngine } from '../renderer/canvasRenderer';
import { resolveBackgroundTime } from '../renderer/backgroundTiming';

export interface ExportParams {
  beatInfo: BeatInfo;
  audio: AudioFileInfo;
  audioBuffer: AudioBuffer;
  background: BackgroundFileInfo | null;
  backgroundSettings: BackgroundSettings;
  effects: EffectSettings;
  exportSettings: ExportSettings;
  logoImage: HTMLImageElement | null;
  onProgress: (progress: ExportProgress) => void;
  /** Aborts the export at the next safe checkpoint (frame boundary / between backend calls). */
  signal?: AbortSignal;
}

export interface ExportResult {
  downloadUrl: string;
  filename: string;
}

/** Thrown on any export failure. `reason` is short enough to show directly in the UI. */
export class ExportError extends Error {
  reason: string;

  constructor(reason: string, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'ExportError';
    this.reason = reason;
  }
}

// Native ffmpeg encode settings per quality tier, matching the requested
// spec. Audio is kept at a consistently high bitrate regardless of video
// quality — it's a small fraction of the file either way, and the beat is
// the whole point of the video.
const QUALITY_PRESETS = {
  draft: { crf: 26, preset: 'veryfast', jpegQuality: 0.85, audioBitrate: '320k' },
  high: { crf: 18, preset: 'medium', jpegQuality: 0.95, audioBitrate: '320k' },
  maximum: { crf: 17, preset: 'slow', jpegQuality: 0.98, audioBitrate: '320k' },
};

function parseResolution(resolution: string): { width: number; height: number } {
  const [width, height] = resolution.split('x').map(Number);
  return { width, height };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, ' ').trim();
}

export function buildExportFilename(title: string): string {
  const safeTitle = sanitizeFilename(title) || 'Untitled';
  return `Toshi - ${safeTitle} Visualizer.mp4`;
}

function seekVideoTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  // A seek to the current time may never fire 'seeked' in some browsers —
  // skip it entirely rather than hang the whole export waiting on it.
  if (Math.abs(video.currentTime - timeSec) < 0.001) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timeoutId);
      resolve();
    };
    const onSeeked = () => finish();
    // Safety net: never let one stalled seek hang the entire export.
    const timeoutId = setTimeout(finish, 2000);
    video.addEventListener('seeked', onSeeked);
    video.currentTime = timeSec;
  });
}

/** Reads a fetch Response's `{error:{reason,detail}}` body into an ExportError, logging the full detail to console. */
async function toExportError(res: Response, fallbackReason: string): Promise<ExportError> {
  try {
    const data = await res.json();
    const reason = data?.error?.reason ?? fallbackReason;
    const detail = data?.error?.detail;
    if (detail) console.error(`[export] ${reason} — full detail:`, detail);
    return new ExportError(reason, detail ? undefined : `HTTP ${res.status}`);
  } catch {
    return new ExportError(fallbackReason, `HTTP ${res.status}`);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ExportError('export cancelled');
}

/**
 * fetch() wrapper used for every export network call so each request/response
 * (and any raw network-level failure) is individually logged rather than
 * collapsing into a single generic error — this is what let us tell that the
 * old single-streaming-fetch frame transport was the specific call throwing
 * "TypeError: Failed to fetch" in a real browser.
 */
async function taggedFetch(label: string, url: string, init: RequestInit, renderId: string | null): Promise<Response> {
  const body = init.body;
  const bodyDescription =
    body instanceof Blob
      ? { bodyType: 'Blob', mime: body.type, sizeBytes: body.size }
      : body instanceof FormData
        ? { bodyType: 'FormData' }
        : body == null
          ? { bodyType: 'none' }
          : { bodyType: typeof body };
  console.info(`[export] -> ${label}`, { method: init.method ?? 'GET', url, renderId, ...bodyDescription });
  try {
    const res = await fetch(url, init);
    console.info(`[export] <- ${label}`, { url, status: res.status, ok: res.ok });
    return res;
  } catch (err) {
    console.error(`[export] xx ${label} failed before a response was received`, {
      url,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      browserOnline: navigator.onLine,
      origin: window.location.origin,
    });
    throw err;
  }
}

/** Runs `taggedFetch`, converting a raw network-level throw into an ExportError labeled for this specific stage. */
async function stageFetch(label: string, failureReason: string, url: string, init: RequestInit, renderId: string | null): Promise<Response> {
  try {
    return await taggedFetch(label, url, init, renderId);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ExportError(failureReason, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Deterministic, frame-by-frame export pipeline using native local FFmpeg
 * (via the app's own Node/Vite backend) instead of ffmpeg.wasm:
 * 1) pre-analyze the full beat exactly as before, so every frame's audio
 *    reaction is fixed and reproducible,
 * 2) render each frame with the same VisualizerEngine/design constants the
 *    live preview uses — Canvas remains the single source of visual truth,
 * 3) POST each rendered frame as its own plain JPEG Blob to the backend,
 *    one HTTP request per frame — simpler and more reliable in a real
 *    browser than a single long-lived `ReadableStream` request body, which
 *    is what this replaced (see nativeExporter.ts's header comment),
 * 4) mux the original uploaded beat audio into the encoded video natively.
 */
export async function exportVisualizerVideo(params: ExportParams): Promise<ExportResult> {
  const {
    beatInfo,
    audio,
    audioBuffer,
    background,
    backgroundSettings,
    effects,
    exportSettings,
    logoImage,
    onProgress,
    signal,
  } = params;

  const fps = exportSettings.framerate;
  const { width, height } = parseResolution(exportSettings.resolution);
  const quality = QUALITY_PRESETS[exportSettings.quality];

  console.info('[export] start', {
    resolution: exportSettings.resolution,
    fps,
    quality: exportSettings.quality,
    beatDurationSec: audioBuffer.duration,
  });

  onProgress({ stage: 'preparing-render', currentFrame: 0, totalFrames: 0, message: 'Checking export backend…' });
  const healthRes = await stageFetch('health check', 'export backend unavailable', '/api/export/health', { signal }, null);
  if (!healthRes.ok) throw await toExportError(healthRes, 'export backend unavailable');
  const health = await healthRes.json();
  if (!health.ok || !health.ffmpeg) {
    throw new ExportError('export backend unavailable', 'backend reachable but ffmpeg was not detected');
  }

  // Unlike the live preview (which redraws every frame and self-heals once
  // web fonts finish loading), export renders each frame exactly once — so
  // the title/label fonts must be fully loaded before rendering starts.
  await Promise.all([
    document.fonts.load('400 100px Anton'),
    document.fonts.load('500 20px Oswald'),
    document.fonts.load('600 20px Oswald'),
  ]);
  await document.fonts.ready;

  onProgress({ stage: 'analyzing-audio', currentFrame: 0, totalFrames: 0, message: 'Analyzing audio…' });
  const analysis = await analyzeAudioBufferDeterministic(
    audioBuffer,
    fps,
    effects.smoothing,
    effects.transientSensitivity,
    (done, total) =>
      onProgress({
        stage: 'analyzing-audio',
        currentFrame: done,
        totalFrames: total,
        message: `Analyzing audio ${done} / ${total}`,
      }),
  );

  const totalFrames = analysis.frames.length;
  console.info('[export] estimated frame count:', totalFrames);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const engine = new VisualizerEngine();

  let bgVideo: HTMLVideoElement | null = null;
  if (background) {
    bgVideo = document.createElement('video');
    bgVideo.src = background.url;
    bgVideo.muted = true;
    bgVideo.playsInline = true;
    await new Promise<void>((resolve) => {
      bgVideo!.onloadeddata = () => resolve();
    });
  }

  let renderId: string | null = null;

  try {
    throwIfAborted(signal);
    onProgress({ stage: 'preparing-render', currentFrame: 0, totalFrames, message: 'Preparing render…' });

    const filename = buildExportFilename(beatInfo.title);
    const startForm = new FormData();
    startForm.append(
      'config',
      JSON.stringify({ width, height, fps, crf: quality.crf, preset: quality.preset, audioBitrate: quality.audioBitrate, filename }),
    );
    startForm.append('audio', audio.file, audio.file.name);

    const startRes = await stageFetch(
      'create export job',
      'failed to create export job',
      '/api/export/start',
      { method: 'POST', body: startForm, signal },
      null,
    );
    if (!startRes.ok) throw await toExportError(startRes, 'could not start export');
    const startData = await startRes.json();
    renderId = startData.renderId as string;
    console.info('[export] backend render id:', renderId);

    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(signal);
      const frameTimeSec = i / fps;
      const audioFrame = analysis.frames[i];

      let backgroundSource = null;
      if (bgVideo) {
        const bgTime = resolveBackgroundTime(frameTimeSec, backgroundSettings, bgVideo.duration || 0);
        if (i < 3) console.info(`[export] frame ${i}: bgVideo duration=${bgVideo.duration}, readyState=${bgVideo.readyState}, seeking to ${bgTime}`);
        await seekVideoTo(bgVideo, bgTime);
        backgroundSource = { element: bgVideo, width: bgVideo.videoWidth, height: bgVideo.videoHeight };
      }

      engine.renderFrame({
        ctx,
        width,
        height,
        backgroundSource,
        beatInfo,
        backgroundSettings,
        effects,
        audioFrame,
        frameIndex: i,
        timeSec: frameTimeSec,
        logoImage,
      });

      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/jpeg', quality.jpegQuality),
      );
      if (i < 3) console.info(`[export] frame ${i}: blob encoded, size=${blob.size} bytes, type=${blob.type}`);

      const frameRes = await stageFetch(
        `send frame ${i}`,
        `failed to send frame ${i} to backend`,
        `/api/export/${renderId}/frames`,
        { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal },
        renderId,
      );
      if (!frameRes.ok) throw await toExportError(frameRes, `frame ${i} was rejected by the backend`);

      onProgress({
        stage: 'rendering-frames',
        currentFrame: i + 1,
        totalFrames,
        message: `Rendering frame ${i + 1} / ${totalFrames}`,
      });
    }

    onProgress({ stage: 'encoding-video', currentFrame: totalFrames, totalFrames, message: 'Encoding video…' });
    const finishRes = await stageFetch(
      'finish video encoding',
      'failed to finish video encoding',
      `/api/export/${renderId}/frames/finish`,
      { method: 'POST', signal },
      renderId,
    );
    if (!finishRes.ok) throw await toExportError(finishRes, 'video encoding failed');

    throwIfAborted(signal);
    onProgress({ stage: 'muxing-audio', currentFrame: totalFrames, totalFrames, message: 'Muxing audio…' });
    const muxRes = await stageFetch(
      'mux audio',
      'failed to mux audio into video',
      `/api/export/${renderId}/mux`,
      { method: 'POST', signal },
      renderId,
    );
    if (!muxRes.ok) throw await toExportError(muxRes, 'audio muxing failed');
    const muxData = await muxRes.json();

    console.info('[export] complete:', renderId);
    onProgress({ stage: 'done', currentFrame: totalFrames, totalFrames, message: 'Export complete' });

    return { downloadUrl: `/api/export/${renderId}/download`, filename: muxData.filename ?? filename };
  } catch (err) {
    const aborted = signal?.aborted || (err instanceof DOMException && err.name === 'AbortError');
    if (aborted) {
      onProgress({ stage: 'cancelled', currentFrame: 0, totalFrames, message: 'Export cancelled' });
    }
    if (renderId) {
      // Best-effort: tell the backend to stop encoding and clean up temp files.
      void fetch(`/api/export/${renderId}/cancel`, { method: 'POST' }).catch(() => {});
      void fetch(`/api/export/${renderId}`, { method: 'DELETE' }).catch(() => {});
    }
    if (aborted) {
      throw new ExportError('export cancelled');
    }
    console.error('[export] failed:', err);
    if (err instanceof ExportError) throw err;
    throw new ExportError('unexpected error', err instanceof Error ? err.message : String(err));
  } finally {
    // Release the temporary decode-only video element's resources now
    // rather than waiting on GC — it's not attached to the DOM so nothing
    // else references it once export finishes.
    if (bgVideo) bgVideo.removeAttribute('src');
  }
}

/** Cleans up a finished render's temp files on the backend — call once the download has started. */
export function cleanupExportRender(downloadUrl: string): void {
  const match = downloadUrl.match(/\/api\/export\/([a-f0-9]{16})\/download/);
  if (!match) return;
  void fetch(`/api/export/${match[1]}`, { method: 'DELETE' }).catch(() => {});
}
