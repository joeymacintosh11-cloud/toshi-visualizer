// Native ffmpeg/ffprobe integration: binary detection, ffprobe metadata
// inspection, and the preview-proxy transcode. Final MP4 export also runs
// through native ffmpeg now (see nativeExporter.ts, which reuses
// getFFmpegStatus/spawnCapture from here for its own process spawning) —
// ffmpeg.wasm is no longer used anywhere in this project.
//
// Deliberately spawned WITHOUT a shell: Node's child_process.spawn resolves
// a bare executable name (including trying PATHEXT extensions like .exe on
// Windows) via the OS's own CreateProcess/SearchPath machinery even without
// `shell: true` — that flag is only needed for shell built-ins or .cmd/.bat
// launcher scripts, not genuine native binaries like ffmpeg.exe. Avoiding
// it sidesteps Node's DEP0190 warning and any shell-quoting concerns for
// the file paths passed as arguments.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';

export interface SpawnCaptureResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnError: string | null;
}

export function spawnCapture(command: string, args: string[], timeoutMs = 15_000): Promise<SpawnCaptureResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(command, args, { windowsHide: true });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ exitCode: null, stdout, stderr, spawnError: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr, spawnError: err.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, spawnError: null });
    });
  });
}

let cachedFFmpegCommand: string | null = null;
let cachedFFprobeCommand: string | null = null;

async function resolveBinary(
  envOverrideVar: string,
  candidates: string[],
  cached: string | null,
): Promise<{ command: string | null; version: string | null; error: string | null }> {
  if (cached) {
    const result = await spawnCapture(cached, ['-version']);
    if (result.exitCode === 0) {
      return { command: cached, version: (result.stdout || result.stderr).split('\n')[0]?.trim() ?? null, error: null };
    }
    // Cached path stopped working (e.g. uninstalled mid-session) — fall through and re-resolve.
  }

  const envOverride = process.env[envOverrideVar];
  const tryList = envOverride ? [envOverride, ...candidates] : candidates;

  let lastError = 'not found on PATH';
  for (const candidate of tryList) {
    const result = await spawnCapture(candidate, ['-version']);
    if (result.exitCode === 0) {
      const version = (result.stdout || result.stderr).split('\n')[0]?.trim() ?? null;
      return { command: candidate, version, error: null };
    }
    if (result.spawnError) {
      lastError = result.spawnError;
    } else if (result.exitCode !== null) {
      // On Windows, spawning a missing command via the shell fails with a
      // non-zero exit and a "not recognized" message on stderr rather than
      // an ENOENT spawn error — surface that text if we have it.
      const stderrLine = result.stderr.split('\n').map((l) => l.trim()).filter(Boolean)[0];
      lastError = stderrLine || `exited with code ${result.exitCode}`;
    }
  }
  return { command: null, version: null, error: lastError };
}

export interface FFmpegStatus {
  available: boolean;
  ffmpeg: { found: boolean; command: string | null; version: string | null; error: string | null };
  ffprobe: { found: boolean; command: string | null; version: string | null; error: string | null };
  setupMessage: string | null;
}

const WINDOWS_SETUP_MESSAGE =
  'FFmpeg was not found on your system PATH. Install it with "winget install Gyan.FFmpeg" (or download ' +
  'from https://www.gyan.dev/ffmpeg/builds/ and add its bin folder to PATH), then restart the dev server. ' +
  'Until then, background previews will use the original video directly.';

/** Checks for both ffmpeg and ffprobe on PATH (or FFMPEG_PATH/FFPROBE_PATH overrides). Cached after first success. */
export async function getFFmpegStatus(): Promise<FFmpegStatus> {
  const [ffmpegResult, ffprobeResult] = await Promise.all([
    resolveBinary('FFMPEG_PATH', ['ffmpeg', 'ffmpeg.exe'], cachedFFmpegCommand),
    resolveBinary('FFPROBE_PATH', ['ffprobe', 'ffprobe.exe'], cachedFFprobeCommand),
  ]);

  if (ffmpegResult.command) cachedFFmpegCommand = ffmpegResult.command;
  if (ffprobeResult.command) cachedFFprobeCommand = ffprobeResult.command;

  const available = Boolean(ffmpegResult.command && ffprobeResult.command);

  return {
    available,
    ffmpeg: {
      found: Boolean(ffmpegResult.command),
      command: ffmpegResult.command,
      version: ffmpegResult.version,
      error: ffmpegResult.error,
    },
    ffprobe: {
      found: Boolean(ffprobeResult.command),
      command: ffprobeResult.command,
      version: ffprobeResult.version,
      error: ffprobeResult.error,
    },
    setupMessage: available ? null : WINDOWS_SETUP_MESSAGE,
  };
}

export interface ProbeResult {
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  codec: string;
  fileSizeBytes: number;
}

function parseFrameRate(rFrameRate: string | undefined): number {
  if (!rFrameRate) return 0;
  const [num, den] = rFrameRate.split('/').map(Number);
  if (!den) return num || 0;
  return num / den;
}

/** Runs ffprobe against a file already on the local filesystem and returns key stream metadata. */
export async function probeVideo(inputPath: string): Promise<ProbeResult> {
  const status = await getFFmpegStatus();
  if (!status.ffprobe.command) {
    throw new Error('ffprobe is not available (see FFmpeg status)');
  }

  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '-select_streams', 'v:0',
    inputPath,
  ];
  console.info('[ffprobe] command:', status.ffprobe.command, args.join(' '));

  const result = await spawnCapture(status.ffprobe.command, args, 30_000);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.spawnError || `exit code ${result.exitCode}`;
    console.error('[ffprobe] failed:', detail);
    throw new Error(`ffprobe failed: ${detail}`);
  }

  let parsed: { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`ffprobe produced unparseable output: ${err instanceof Error ? err.message : String(err)}`);
  }

  const stream = parsed.streams?.[0];
  if (!stream) {
    throw new Error('ffprobe found no video stream in this file');
  }

  const fileSizeBytes = statSync(inputPath).size;
  const durationRaw = (stream.duration as string | undefined) ?? (parsed.format?.duration as string | undefined);

  return {
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    durationSec: durationRaw ? parseFloat(durationRaw) : 0,
    fps: parseFrameRate(stream.r_frame_rate as string | undefined),
    codec: (stream.codec_name as string | undefined) ?? 'unknown',
    fileSizeBytes,
  };
}

export interface TranscodeResult {
  exitCode: number | null;
  command: string[];
  stderr: string;
  spawnError: string | null;
}

/**
 * Native equivalent of:
 *   ffmpeg -y -i INPUT -vf "scale='min(W,iw)':-2,fps=F" -an
 *          -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p
 *          -movflags +faststart OUTPUT
 * `-2` auto-picks an even height preserving aspect ratio; the scale only
 * ever downscales (never enlarges a source narrower than the target).
 */
export async function generateNativeProxy(
  inputPath: string,
  outputPath: string,
  settings: { maxWidth: number; fps: number; crf: number; preset: string },
): Promise<TranscodeResult> {
  const status = await getFFmpegStatus();
  if (!status.ffmpeg.command) {
    return { exitCode: null, command: [], stderr: '', spawnError: 'ffmpeg is not available' };
  }

  const videoFilter = `scale='min(${settings.maxWidth},iw)':-2,fps=${settings.fps}`;
  const args = [
    '-y',
    '-i', inputPath,
    '-vf', videoFilter,
    '-an',
    '-c:v', 'libx264',
    '-preset', settings.preset,
    '-crf', String(settings.crf),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ];

  console.info('[ffmpeg] command:', status.ffmpeg.command, args.join(' '));
  const result = await spawnCapture(status.ffmpeg.command, args, 20 * 60_000); // generous 20min ceiling for very long beats
  console.info(`[ffmpeg] exited with code ${result.exitCode}`);
  if (result.stderr) console.info('[ffmpeg] stderr tail:\n' + result.stderr.split('\n').slice(-30).join('\n'));

  return {
    exitCode: result.exitCode,
    command: [status.ffmpeg.command, ...args],
    stderr: result.stderr,
    spawnError: result.spawnError,
  };
}
