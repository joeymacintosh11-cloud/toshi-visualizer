// Native final-MP4 export: replaces the old ffmpeg.wasm pipeline entirely.
// A render goes through backend calls from the frontend:
//   1. createExportRender()   -- POST /api/export/start (config + audio upload)
//   2. writeExportFrame()     -- POST /api/export/:id/frames, ONE call per frame,
//                                 each carrying exactly one JPEG as its raw body.
//   3. finishExportEncoding() -- POST /api/export/:id/frames/finish (closes ffmpeg's stdin)
//   4. muxExportAudio()       -- POST /api/export/:id/mux (mux the uploaded audio into the final MP4)
//
// The Canvas renderer (VisualizerEngine) remains the sole source of visual
// truth — this module only spawns ffmpeg to encode/combine what the browser
// already rendered.
//
// Frames arrive as separate HTTP requests (one per frame) rather than a
// single long streamed request body. This was a deliberate change made
// after a real-browser export failed immediately with "TypeError: Failed
// to fetch" on the old single-streaming-fetch design (a ReadableStream
// request body with `duplex: 'half'`) — per-frame POSTs of a plain, bounded
// JPEG Blob are simpler, need no streaming-body browser support, and are
// far easier to diagnose one request at a time. The ffmpeg encoder process
// is spawned once (on the first frame) and kept alive across all of a
// render's frame requests, fed via repeated `stdin.write()` calls, exactly
// like the old single-stream approach fed it via `.pipe()`.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getFFmpegStatus, spawnCapture } from './ffmpegNative.js';
import { EXPORTS_DIR, sanitizeWindowsFilename } from './tempStorage.js';

export interface ExportRenderConfig {
  width: number;
  height: number;
  fps: number;
  crf: number;
  preset: string;
  audioBitrate: string;
  filename: string;
}

export interface EncodeCloseInfo {
  exitCode: number | null;
  reason: string | null;
}

interface ActiveExport {
  id: string;
  dir: string;
  videoPath: string;
  finalPath: string;
  audioPath: string | null;
  encodeProcess: ChildProcessWithoutNullStreams | null;
  encodeStderr: string;
  /** Resolves once, whenever the encoder process ends (normally, via error, or via cancel). */
  encodeClosed: Promise<EncodeCloseInfo> | null;
  framesWritten: number;
  cancelled: boolean;
  config: ExportRenderConfig;
}

const activeExports = new Map<string, ActiveExport>();

export function createExportRender(config: ExportRenderConfig): ActiveExport {
  const id = randomBytes(8).toString('hex');
  const dir = join(EXPORTS_DIR, id);
  mkdirSync(dir, { recursive: true });
  const entry: ActiveExport = {
    id,
    dir,
    videoPath: join(dir, 'video.mp4'),
    finalPath: join(dir, 'final.mp4'),
    audioPath: null,
    encodeProcess: null,
    encodeStderr: '',
    encodeClosed: null,
    framesWritten: 0,
    cancelled: false,
    config,
  };
  activeExports.set(id, entry);
  return entry;
}

export function getActiveExport(id: string): ActiveExport | null {
  return activeExports.get(id) ?? null;
}

export function setExportAudioPath(id: string, audioPath: string): void {
  const entry = activeExports.get(id);
  if (entry) entry.audioPath = audioPath;
}

/** Kills any in-progress ffmpeg process for this render and marks it cancelled. */
export function cancelExport(id: string): boolean {
  const entry = activeExports.get(id);
  if (!entry) return false;
  entry.cancelled = true;
  if (entry.encodeProcess && entry.encodeProcess.exitCode === null && entry.encodeProcess.signalCode === null) {
    entry.encodeProcess.kill('SIGKILL');
  }
  return true;
}

/** Removes a render's temp directory and drops it from the registry. Safe to call more than once. */
export function cleanupExport(id: string): void {
  const entry = activeExports.get(id);
  activeExports.delete(id);
  if (entry) {
    try {
      rmSync(entry.dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function tail(text: string, lines = 30): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-lines)
    .join('\n');
}

/** Pulls a short, human-readable reason out of ffmpeg's stderr rather than a generic message. */
// ffmpeg's very last stderr lines are usually noise rather than the actual
// cause: a generic wrap-up ("Conversion failed!") and/or a periodic
// progress-stats line ("frame=... fps=... bitrate=..."). The real reason
// typically appears a line or two before those ("Invalid data found...",
// "No such file or directory", "Nothing was written into output file...").
const GENERIC_WRAPUP_LINES = ['conversion failed!', 'error while decoding stream', 'error opening filters!'];
const PROGRESS_STATS_PATTERN = /^frame=\s*\d+\s+fps=/;

function extractReason(stderr: string, exitCode: number | null): string {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (GENERIC_WRAPUP_LINES.includes(line.toLowerCase())) continue;
    if (PROGRESS_STATS_PATTERN.test(line)) continue;
    // Strip ffmpeg's internal "[component @ 0xADDRESS]" prefix — a memory
    // pointer that means nothing to a user reading the error.
    const cleaned = line.replace(/^\[[^\]]*@\s*(0x)?[0-9a-f]+\]\s*/i, '');
    return cleaned.length > 200 ? cleaned.slice(0, 200) + '...' : cleaned;
  }
  return `ffmpeg exited with code ${exitCode ?? 'unknown'}`;
}

export interface StreamResult {
  ok: boolean;
  exitCode: number | null;
  reason: string | null;
  stderrTail: string;
}

/** Spawns the frame encoder if it isn't already running for this render. Idempotent. */
function ensureEncoderStarted(entry: ActiveExport): Promise<{ ok: boolean; reason: string | null }> {
  if (entry.encodeProcess) return Promise.resolve({ ok: true, reason: null });

  return (async () => {
    const status = await getFFmpegStatus();
    if (!status.ffmpeg.command) {
      return { ok: false, reason: 'ffmpeg is not available' };
    }
    // Another frame request may have won the race while we awaited ffmpeg detection.
    if (entry.encodeProcess) return { ok: true, reason: null };

    const { width, height, fps, crf, preset } = entry.config;
    const args = [
      '-y',
      '-f', 'mjpeg',
      '-r', String(fps),
      '-i', 'pipe:0',
      '-s', `${width}x${height}`,
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',
      entry.videoPath,
    ];

    console.info('[export] ffmpeg spawning:', status.ffmpeg.command, args.join(' '));
    const child = spawn(status.ffmpeg.command, args, { windowsHide: true });
    console.info('[export] ffmpeg spawned PID', child.pid, '- stdin writable =', child.stdin.writable);
    entry.encodeProcess = child;

    entry.encodeClosed = new Promise<EncodeCloseInfo>((resolve) => {
      let settled = false;
      const finish = (info: EncodeCloseInfo) => {
        if (settled) return;
        settled = true;
        resolve(info);
      };

      child.stderr.on('data', (chunk: Buffer) => {
        entry.encodeStderr += chunk.toString();
        if (entry.encodeStderr.length > 60_000) entry.encodeStderr = entry.encodeStderr.slice(-60_000);
      });

      child.on('error', (err) => {
        console.error('[export] ffmpeg process error:', err.message);
        finish({ exitCode: null, reason: err.message });
      });

      child.on('exit', (code, signal) => {
        console.info(`[export] ffmpeg exited: code=${code} signal=${signal} framesWritten=${entry.framesWritten}`);
      });

      child.on('close', (code) => {
        console.info(`[export] ffmpeg closed with code ${code}, frames written: ${entry.framesWritten}`);
        if (entry.encodeStderr) console.info('[export] ffmpeg stderr tail:\n' + tail(entry.encodeStderr));
        if (entry.cancelled) {
          finish({ exitCode: code, reason: 'export cancelled' });
        } else if (code === 0) {
          finish({ exitCode: 0, reason: null });
        } else {
          finish({ exitCode: code, reason: extractReason(entry.encodeStderr, code) });
        }
      });

      // A write to a dead/closing stdin throws EPIPE — without this handler
      // that would crash the whole Node process instead of just failing
      // the one frame request that caused it.
      child.stdin.on('error', (err) => {
        console.error('[export] ffmpeg stdin error:', err.message);
      });
    });

    return { ok: true, reason: null };
  })();
}

export interface WriteFrameResult {
  ok: boolean;
  reason: string | null;
}

/** Writes one already-complete JPEG frame to the render's ffmpeg encoder, starting it on first call. */
export async function writeExportFrame(id: string, chunk: Buffer): Promise<WriteFrameResult> {
  const entry = activeExports.get(id);
  if (!entry) return { ok: false, reason: 'unknown render id' };
  if (entry.cancelled) return { ok: false, reason: 'export cancelled' };

  const started = await ensureEncoderStarted(entry);
  if (!started.ok) return started;

  const child = entry.encodeProcess!;
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      ok: false,
      reason: extractReason(entry.encodeStderr, child.exitCode) || `ffmpeg exited before accepting frame ${entry.framesWritten}`,
    };
  }

  return new Promise((resolve) => {
    child.stdin.write(chunk, (err) => {
      if (err) {
        resolve({ ok: false, reason: `ffmpeg stdin write failed: ${err.message}` });
        return;
      }
      entry.framesWritten++;
      resolve({ ok: true, reason: null });
    });
  });
}

/** Closes the encoder's stdin (signaling end-of-video) and waits for ffmpeg to finish writing video.mp4. */
export async function finishExportEncoding(id: string): Promise<StreamResult> {
  const entry = activeExports.get(id);
  if (!entry) return { ok: false, exitCode: null, reason: 'unknown render id', stderrTail: '' };

  if (!entry.encodeProcess || !entry.encodeClosed) {
    return { ok: false, exitCode: null, reason: 'no frames were received before finish', stderrTail: '' };
  }

  const child = entry.encodeProcess;
  if (child.exitCode === null && child.signalCode === null && child.stdin.writable) {
    child.stdin.end();
  }

  const info = await entry.encodeClosed;
  return {
    ok: info.reason === null,
    exitCode: info.exitCode,
    reason: info.reason,
    stderrTail: tail(entry.encodeStderr),
  };
}

export interface MuxResult {
  ok: boolean;
  reason: string | null;
  finalPath: string | null;
  downloadFilename: string | null;
}

/** Muxes the previously-uploaded original audio into the encoded video track, producing the final MP4. */
export async function muxExportAudio(id: string): Promise<MuxResult> {
  const entry = activeExports.get(id);
  if (!entry) return { ok: false, reason: 'unknown render id', finalPath: null, downloadFilename: null };
  if (!entry.audioPath) return { ok: false, reason: 'no audio uploaded for this render', finalPath: null, downloadFilename: null };
  if (!existsSync(entry.videoPath)) {
    return { ok: false, reason: 'video track was not produced', finalPath: null, downloadFilename: null };
  }

  const status = await getFFmpegStatus();
  if (!status.ffmpeg.command) {
    return { ok: false, reason: 'ffmpeg is not available', finalPath: null, downloadFilename: null };
  }

  const args = [
    '-y',
    '-i', entry.videoPath,
    '-i', entry.audioPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', entry.config.audioBitrate,
    '-shortest',
    '-movflags', '+faststart',
    entry.finalPath,
  ];
  console.info('[export] muxing audio:', status.ffmpeg.command, args.join(' '));

  const result = await spawnCapture(status.ffmpeg.command, args, 5 * 60_000);
  console.info(`[export] mux exited with code ${result.exitCode}`);
  if (result.stderr) console.info('[export] mux stderr tail:\n' + tail(result.stderr));

  if (result.exitCode !== 0) {
    const reason = result.spawnError ?? extractReason(result.stderr, result.exitCode);
    return { ok: false, reason, finalPath: null, downloadFilename: null };
  }

  // The video-only intermediate and the uploaded audio copy are no longer
  // needed once the mux succeeds — keep only the finished MP4 on disk.
  try {
    rmSync(entry.videoPath, { force: true });
    rmSync(entry.audioPath, { force: true });
  } catch {
    // best-effort
  }

  return {
    ok: true,
    reason: null,
    finalPath: entry.finalPath,
    downloadFilename: sanitizeWindowsFilename(entry.config.filename),
  };
}
