import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { join, basename } from 'node:path';
import { getFFmpegStatus, probeVideo, generateNativeProxy, type ProbeResult } from './ffmpegNative.js';
import {
  ensureTempDirs,
  SOURCES_DIR,
  PROXIES_DIR,
  computeCacheKey,
  proxyFilePaths,
  proxyExists,
  readProxyMeta,
  writeProxyMeta,
  deleteProxy,
  clearAllProxies,
  uniqueSourcePath,
  cleanupSourceFile,
  type ProxySettings,
  type StoredProxyMeta,
} from './tempStorage.js';

ensureTempDirs();

// Fixed proxy target: max 1280px wide, 30fps, no audio — matches the
// requested native-ffmpeg command exactly. Not currently configurable from
// the frontend; Preview Quality (Low/Medium/High) controls Canvas render
// resolution only, never this.
const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  maxWidth: 1280,
  fps: 30,
  crf: 28,
  preset: 'veryfast',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SOURCES_DIR),
    filename: (_req, file, cb) => cb(null, basename(uniqueSourcePath(file.originalname))),
  }),
  // No fileSize limit — this is a local trusted tool handling large 4K source videos.
});

/** Pulls a short, human-readable reason out of ffmpeg's stderr instead of a generic message. */
function extractShortReason(stderr: string, spawnError: string | null, exitCode: number | null): string {
  if (spawnError) return spawnError;
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // ffmpeg's actual fatal error is typically one of the last printed lines.
  const last = lines[lines.length - 1];
  if (last) return last.length > 200 ? last.slice(0, 200) + '…' : last;
  return `ffmpeg exited with code ${exitCode ?? 'unknown'}`;
}

function isValidCacheId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

export const proxyRouter = express.Router();

proxyRouter.get('/ffmpeg-status', async (_req: Request, res: Response) => {
  const status = await getFFmpegStatus();
  res.json(status);
});

/** Cache pre-check so the frontend can skip re-uploading an already-proxied source entirely. */
proxyRouter.get('/proxy/exists', (req: Request, res: Response) => {
  const { originalName, fileSize, lastModified } = req.query;
  if (typeof originalName !== 'string' || typeof fileSize !== 'string' || typeof lastModified !== 'string') {
    res.status(400).json({ error: { reason: 'invalid request', detail: 'missing originalName/fileSize/lastModified' } });
    return;
  }

  const cacheKey = computeCacheKey({
    originalName,
    fileSize: Number(fileSize),
    lastModified: Number(lastModified),
    settings: DEFAULT_PROXY_SETTINGS,
  });
  const { filename, mp4Path, metaPath } = proxyFilePaths(originalName, cacheKey);

  if (!proxyExists(mp4Path, metaPath)) {
    res.json({ exists: false });
    return;
  }
  const meta = readProxyMeta(metaPath);
  if (!meta) {
    res.json({ exists: false });
    return;
  }
  res.json({ exists: true, proxyUrl: `/temp/proxies/${filename}`, original: meta.original, proxy: meta.proxy });
});

proxyRouter.get('/proxy/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isValidCacheId(id)) {
    res.status(400).json({ error: { reason: 'invalid id' } });
    return;
  }
  const mp4Path = join(PROXIES_DIR, `${id}.mp4`);
  const metaPath = join(PROXIES_DIR, `${id}.json`);
  if (!proxyExists(mp4Path, metaPath)) {
    res.status(404).json({ error: { reason: 'not found' } });
    return;
  }
  const meta = readProxyMeta(metaPath);
  res.json({ proxyUrl: `/temp/proxies/${id}.mp4`, original: meta?.original, proxy: meta?.proxy });
});

proxyRouter.delete('/proxy/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isValidCacheId(id)) {
    res.status(400).json({ error: { reason: 'invalid id' } });
    return;
  }
  const deleted = deleteProxy(join(PROXIES_DIR, `${id}.mp4`), join(PROXIES_DIR, `${id}.json`));
  res.json({ deleted });
});

/** Bulk cleanup — removes every generated proxy file. */
proxyRouter.delete('/proxies', (_req: Request, res: Response) => {
  const deletedCount = clearAllProxies();
  res.json({ deletedCount });
});

proxyRouter.post('/proxy', upload.single('video'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: { reason: 'no file uploaded', detail: 'expected multipart field "video"' } });
    return;
  }

  const originalName = (req.body.originalName as string | undefined) || file.originalname;
  const fileSize = Number(req.body.fileSize) || file.size;
  const lastModified = Number(req.body.lastModified) || Date.now();

  console.group('[proxyApi] POST /api/proxy');
  console.info('input filename:', originalName);
  console.info('input size:', `${(fileSize / 1_000_000).toFixed(1)}MB`);
  console.info('temp source path:', file.path);

  try {
    const status = await getFFmpegStatus();
    if (!status.available) {
      console.error('ffmpeg/ffprobe not available:', status);
      cleanupSourceFile(file.path);
      res.status(503).json({
        error: {
          reason: 'ffmpeg-not-installed',
          detail: status.setupMessage,
          ffmpegFound: status.ffmpeg.found,
          ffprobeFound: status.ffprobe.found,
        },
      });
      return;
    }
    console.info('ffmpeg path:', status.ffmpeg.command, status.ffmpeg.version);
    console.info('ffprobe path:', status.ffprobe.command, status.ffprobe.version);

    const cacheKey = computeCacheKey({ originalName, fileSize, lastModified, settings: DEFAULT_PROXY_SETTINGS });
    const { filename, mp4Path, metaPath } = proxyFilePaths(originalName, cacheKey);

    if (proxyExists(mp4Path, metaPath)) {
      console.info('cache hit — reusing existing proxy:', filename);
      cleanupSourceFile(file.path);
      const meta = readProxyMeta(metaPath);
      res.json({ proxyUrl: `/temp/proxies/${filename}`, reused: true, original: meta?.original, proxy: meta?.proxy });
      return;
    }

    let original: ProbeResult;
    try {
      original = await probeVideo(file.path);
      console.info('detected resolution:', `${original.width}×${original.height}`, `${original.fps}fps`, original.codec);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('ffprobe failed:', detail);
      cleanupSourceFile(file.path);
      res.status(500).json({ error: { reason: 'could not read video metadata', detail } });
      return;
    }

    console.info('output file:', mp4Path);
    const transcode = await generateNativeProxy(file.path, mp4Path, DEFAULT_PROXY_SETTINGS);
    console.info('exact command:', transcode.command.join(' '));
    console.info('exit code:', transcode.exitCode);

    if (transcode.exitCode !== 0) {
      const reason = extractShortReason(transcode.stderr, transcode.spawnError, transcode.exitCode);
      console.error('ffmpeg transcode failed:', reason);
      cleanupSourceFile(file.path);
      deleteProxy(mp4Path, metaPath); // clean up any partial output
      res.status(500).json({
        error: {
          reason,
          detail: transcode.stderr || transcode.spawnError || `exit code ${transcode.exitCode}`,
          command: transcode.command,
          exitCode: transcode.exitCode,
          stderr: transcode.stderr,
        },
      });
      return;
    }

    let proxyProbe: ProbeResult;
    try {
      proxyProbe = await probeVideo(mp4Path);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('ffmpeg reported success but the output file is unreadable:', detail);
      cleanupSourceFile(file.path);
      res.status(500).json({ error: { reason: 'ffmpeg produced an unreadable output file', detail } });
      return;
    }

    const meta: StoredProxyMeta = {
      cacheKey,
      originalName,
      createdAt: new Date().toISOString(),
      original: {
        width: original.width,
        height: original.height,
        durationSec: original.durationSec,
        fps: original.fps,
        codec: original.codec,
        fileSizeBytes: fileSize,
      },
      proxy: {
        width: proxyProbe.width,
        height: proxyProbe.height,
        durationSec: proxyProbe.durationSec,
        fps: proxyProbe.fps,
        fileSizeBytes: proxyProbe.fileSizeBytes,
      },
    };
    writeProxyMeta(metaPath, meta);
    console.info('output file size:', `${proxyProbe.fileSizeBytes} bytes`);
    console.info('proxy ready:', filename);

    cleanupSourceFile(file.path);
    res.json({ proxyUrl: `/temp/proxies/${filename}`, reused: false, original: meta.original, proxy: meta.proxy });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('unexpected error in /api/proxy:', err);
    cleanupSourceFile(file.path);
    res.status(500).json({ error: { reason: 'unexpected server error', detail } });
  } finally {
    console.groupEnd();
  }
});
