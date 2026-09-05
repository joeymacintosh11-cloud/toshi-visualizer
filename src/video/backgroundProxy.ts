// Preview-proxy generation now goes through the local native-ffmpeg backend
// (see server/) instead of ffmpeg.wasm — the browser never loads the full
// source file into memory here; `fetch`+`FormData` streams the File object
// directly from disk. ffmpeg.wasm is still used elsewhere for final export,
// which is untouched by this module.

const LARGE_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export interface BackgroundSourceMeta {
  width: number;
  height: number;
  durationSec: number;
  fileSizeBytes: number;
}

export interface ProxyDecision {
  needed: boolean;
  reason: string;
}

export interface OriginalVideoMeta {
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  codec: string;
  fileSizeBytes: number;
}

export interface BackgroundProxyResult {
  url: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  reused: boolean;
  /** Richer original-file metadata from ffprobe, available whenever a proxy round-trip happened. */
  originalMeta?: OriginalVideoMeta;
}

/** Thrown on any proxy-generation failure. `reason` is short enough to show directly in the UI. */
export class ProxyGenerationError extends Error {
  reason: string;
  detail: string;

  constructor(reason: string, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'ProxyGenerationError';
    this.reason = reason;
    this.detail = detail;
  }
}

export interface FFmpegAvailability {
  available: boolean;
  setupMessage: string | null;
}

/** Checks the local backend for native ffmpeg/ffprobe availability (e.g. to show a setup banner proactively). */
export async function checkFFmpegAvailability(): Promise<FFmpegAvailability> {
  try {
    const res = await fetch('/api/ffmpeg-status');
    if (!res.ok) return { available: false, setupMessage: 'Local backend is unreachable.' };
    const data = await res.json();
    return { available: Boolean(data.available), setupMessage: data.setupMessage ?? null };
  } catch {
    return {
      available: false,
      setupMessage: 'Could not reach the local backend — is the dev server running?',
    };
  }
}

/**
 * Decides whether a background upload is expensive enough to warrant a
 * lightweight preview proxy. The original file is always kept for export
 * regardless of this decision — this only controls what the live preview
 * decodes.
 */
export function decideBackgroundProxy(meta: BackgroundSourceMeta): ProxyDecision {
  if (meta.width > 1920 || meta.height > 1080) {
    return { needed: true, reason: `source is ${meta.width}×${meta.height}, above 1080p` };
  }
  if (meta.fileSizeBytes > LARGE_FILE_SIZE_BYTES) {
    return { needed: true, reason: `source file is ${(meta.fileSizeBytes / 1_000_000).toFixed(0)}MB` };
  }
  return { needed: false, reason: 'source is already lightweight' };
}

function toProxyResult(data: {
  proxyUrl: string;
  reused?: boolean;
  original?: OriginalVideoMeta;
  proxy: { width: number; height: number; durationSec: number; fps: number };
}): BackgroundProxyResult {
  return {
    url: data.proxyUrl,
    width: data.proxy.width,
    height: data.proxy.height,
    durationSec: data.proxy.durationSec,
    fps: data.proxy.fps,
    reused: Boolean(data.reused),
    originalMeta: data.original,
  };
}

/**
 * Cache pre-check: if this exact source (by name/size/lastModified) was
 * already proxied with the current settings, returns it immediately with
 * no upload at all. Call this before generateBackgroundProxy to avoid
 * re-sending a large file the backend already has a proxy for.
 */
export async function checkExistingProxy(file: File): Promise<BackgroundProxyResult | null> {
  const params = new URLSearchParams({
    originalName: file.name,
    fileSize: String(file.size),
    lastModified: String(file.lastModified),
  });

  try {
    const res = await fetch(`/api/proxy/exists?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.exists) return null;
    return toProxyResult(data);
  } catch {
    return null;
  }
}

/**
 * Streams the source video to the local backend, which runs native ffprobe
 * + ffmpeg to produce a small preview proxy. Never reads the file into
 * browser memory — `File` objects passed through `FormData`/`fetch` are
 * streamed directly from disk by the browser's networking stack.
 */
export async function generateBackgroundProxy(file: File): Promise<BackgroundProxyResult> {
  const formData = new FormData();
  formData.append('originalName', file.name);
  formData.append('fileSize', String(file.size));
  formData.append('lastModified', String(file.lastModified));
  formData.append('video', file, file.name);

  let res: Response;
  try {
    res = await fetch('/api/proxy', { method: 'POST', body: formData });
  } catch (err) {
    throw new ProxyGenerationError(
      'could not reach local backend',
      err instanceof Error ? err.message : String(err),
    );
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new ProxyGenerationError('backend returned an invalid response', `HTTP ${res.status}`);
  }

  if (!res.ok) {
    const error = data.error as { reason?: string; detail?: string } | undefined;
    throw new ProxyGenerationError(error?.reason ?? 'unexpected error', error?.detail ?? `HTTP ${res.status}`);
  }

  return toProxyResult(data as Parameters<typeof toProxyResult>[0]);
}
