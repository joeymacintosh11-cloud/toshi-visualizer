import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { existsSync, createReadStream, renameSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  cancelExport,
  cleanupExport,
  createExportRender,
  finishExportEncoding,
  getActiveExport,
  muxExportAudio,
  setExportAudioPath,
  writeExportFrame,
  type ExportRenderConfig,
} from './nativeExporter.js';
import { getFFmpegStatus } from './ffmpegNative.js';
import { ensureTempDirs, sanitizeWindowsFilename, SOURCES_DIR } from './tempStorage.js';

ensureTempDirs();

// Audio arrives as part of /export/start's multipart body. It's staged in
// the shared SOURCES_DIR under a random name first (multer needs a
// destination before we've parsed the JSON config field that would tell us
// the render's real directory), then moved into place once the render id
// is known.
const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SOURCES_DIR),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname) || '.audio';
      cb(null, `export-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
});

// One frame is a single JPEG (a few hundred KB at 1080p, more at 4K) —
// bounded well under this ceiling. Scoped to just the /frames route so it
// never touches the multipart /start route or any JSON body elsewhere.
const frameBodyParser = express.raw({ type: 'image/jpeg', limit: '30mb' });

function isValidRenderId(id: string): boolean {
  return /^[a-f0-9]{16}$/.test(id);
}

function parseExportConfig(raw: unknown): ExportRenderConfig | null {
  if (typeof raw !== 'string') return null;
  let parsed: Partial<ExportRenderConfig>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const { width, height, fps, crf, preset, audioBitrate, filename } = parsed;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    typeof fps !== 'number' ||
    typeof crf !== 'number' ||
    typeof preset !== 'string' ||
    typeof audioBitrate !== 'string' ||
    typeof filename !== 'string' ||
    width <= 0 ||
    height <= 0 ||
    fps <= 0
  ) {
    return null;
  }
  return { width, height, fps, crf, preset, audioBitrate, filename };
}

/** Logs connection-level events on a request so a dropped/reset socket shows up in the backend log, not just as silence. */
function logRequestLifecycle(req: Request, label: string) {
  req.on('aborted', () => console.warn(`[exportApi] request aborted: ${label}`));
  req.on('close', () => console.info(`[exportApi] request closed: ${label}`));
  req.on('error', (err) => console.error(`[exportApi] request error: ${label}:`, err.message));
}

/** Wraps an async route handler so a thrown/rejected error becomes a real HTTP 500 instead of a dropped connection. */
function safeHandler(handler: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch((err: unknown) => {
      console.error('[exportApi] unhandled route error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: { reason: 'internal export error', detail: err instanceof Error ? err.message : String(err) } });
      } else {
        next(err);
      }
    });
  };
}

export const exportRouter = express.Router();

/** Lets the frontend confirm the backend + ffmpeg are reachable before starting a render. */
exportRouter.get(
  '/export/health',
  safeHandler(async (_req, res) => {
    const status = await getFFmpegStatus();
    res.json({ ok: true, ffmpeg: status.available });
  }),
);

exportRouter.post(
  '/export/start',
  audioUpload.single('audio'),
  safeHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: { reason: 'no audio uploaded', detail: 'expected multipart field "audio"' } });
      return;
    }

    const config = parseExportConfig(req.body.config);
    if (!config) {
      try {
        rmSync(file.path, { force: true });
      } catch {
        // best-effort
      }
      res.status(400).json({ error: { reason: 'invalid export configuration' } });
      return;
    }

    const entry = createExportRender(config);
    const audioDestPath = join(entry.dir, `audio${extname(file.originalname) || '.audio'}`);
    renameSync(file.path, audioDestPath);
    setExportAudioPath(entry.id, audioDestPath);

    console.info('[exportApi] render started:', entry.id, config);
    res.json({ renderId: entry.id });
  }),
);

exportRouter.post(
  '/export/:id/frames',
  (req, _res, next) => {
    const id = String(req.params.id);
    logRequestLifecycle(req, `frames ${id}`);
    console.info(
      '[exportApi] frame endpoint reached',
      id,
      '- content-type:', req.headers['content-type'],
      '- content-length:', req.headers['content-length'],
    );
    next();
  },
  frameBodyParser,
  safeHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!isValidRenderId(id) || !getActiveExport(id)) {
      res.status(404).json({ error: { reason: 'unknown render id' } });
      return;
    }

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: { reason: 'empty or non-binary frame body' } });
      return;
    }

    const result = await writeExportFrame(id, body);
    if (!result.ok) {
      console.error('[exportApi] frame write failed:', id, result.reason);
      res.status(500).json({ error: { reason: result.reason ?? 'frame write failed' } });
      return;
    }
    res.json({ ok: true });
  }),
);

exportRouter.post(
  '/export/:id/frames/finish',
  safeHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!isValidRenderId(id) || !getActiveExport(id)) {
      res.status(404).json({ error: { reason: 'unknown render id' } });
      return;
    }

    const result = await finishExportEncoding(id);
    if (!result.ok) {
      console.error('[exportApi] frame encoding failed:', result.reason);
      res.status(500).json({
        error: { reason: result.reason ?? 'frame encoding failed', detail: result.stderrTail },
      });
      return;
    }
    res.json({ ok: true });
  }),
);

exportRouter.post(
  '/export/:id/mux',
  safeHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!isValidRenderId(id) || !getActiveExport(id)) {
      res.status(404).json({ error: { reason: 'unknown render id' } });
      return;
    }

    const result = await muxExportAudio(id);
    if (!result.ok) {
      console.error('[exportApi] audio mux failed:', result.reason);
      res.status(500).json({ error: { reason: result.reason ?? 'audio muxing failed' } });
      return;
    }
    res.json({ ok: true, filename: result.downloadFilename });
  }),
);

exportRouter.get('/export/:id/download', (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isValidRenderId(id)) {
    res.status(400).json({ error: { reason: 'invalid render id' } });
    return;
  }
  const entry = getActiveExport(id);
  if (!entry || !existsSync(entry.finalPath)) {
    res.status(404).json({ error: { reason: 'export not found or not finished yet' } });
    return;
  }

  const filename = sanitizeWindowsFilename(entry.config.filename).replace(/"/g, '');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'video/mp4');
  createReadStream(entry.finalPath).pipe(res);
});

exportRouter.post('/export/:id/cancel', (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isValidRenderId(id)) {
    res.status(400).json({ error: { reason: 'invalid render id' } });
    return;
  }
  const cancelled = cancelExport(id);
  res.json({ cancelled });
});

exportRouter.delete('/export/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isValidRenderId(id)) {
    res.status(400).json({ error: { reason: 'invalid render id' } });
    return;
  }
  cleanupExport(id);
  res.json({ ok: true });
});
