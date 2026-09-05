// Manages the local temp directories used for native-ffmpeg proxy
// generation: a short-lived `sources/` folder for uploaded originals
// (deleted right after each transcode attempt) and a `proxies/` folder
// holding the generated preview files, keyed so an unchanged source with
// unchanged proxy settings reuses its existing proxy instead of
// re-transcoding.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/ lives at the project root, so one level up is the project root.
const PROJECT_ROOT = join(__dirname, '..');

export const TEMP_ROOT = join(PROJECT_ROOT, 'temp');
export const SOURCES_DIR = join(TEMP_ROOT, 'sources');
export const PROXIES_DIR = join(TEMP_ROOT, 'proxies');
export const EXPORTS_DIR = join(TEMP_ROOT, 'exports');

export function ensureTempDirs(): void {
  mkdirSync(SOURCES_DIR, { recursive: true });
  mkdirSync(PROXIES_DIR, { recursive: true });
  mkdirSync(EXPORTS_DIR, { recursive: true });
}

/** Strips characters Windows filenames cannot contain (less-than, greater-than, colon, double-quote, slash, backslash, pipe, question mark, asterisk). */
export function sanitizeWindowsFilename(name: string): string {
  const invalidChars = ['<', '>', ':', String.fromCharCode(34), '/', String.fromCharCode(92), '|', '?', '*'];
  let cleaned = name;
  for (const ch of invalidChars) {
    cleaned = cleaned.split(ch).join(String());
  }
  cleaned = cleaned.trim();
  return cleaned || 'Toshi Visualizer.mp4';
}

export interface ProxySettings {
  maxWidth: number;
  fps: number;
  crf: number;
  preset: string;
}

export interface CacheKeyInput {
  originalName: string;
  fileSize: number;
  lastModified: number;
  settings: ProxySettings;
}

function sanitizeBaseName(name: string): string {
  const withoutExt = name.replace(/\.[^/.]+$/, '');
  const cleaned = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 40) || 'video';
}

/**
 * Deterministic cache key from source identity (name/size/lastModified —
 * the only signal a browser File object can give us, since real filesystem
 * paths aren't exposed) plus the proxy settings that would be used. Same
 * source + same settings always yields the same key, enabling reuse.
 */
export function computeCacheKey(input: CacheKeyInput): string {
  const raw = `${input.originalName}|${input.fileSize}|${input.lastModified}|${JSON.stringify(input.settings)}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function proxyFilePaths(originalName: string, cacheKey: string) {
  const base = sanitizeBaseName(originalName);
  const filename = `${base}-preview-${cacheKey}.mp4`;
  const metaFilename = `${base}-preview-${cacheKey}.json`;
  return {
    filename,
    mp4Path: join(PROXIES_DIR, filename),
    metaPath: join(PROXIES_DIR, metaFilename),
  };
}

export interface StoredProxyMeta {
  cacheKey: string;
  originalName: string;
  createdAt: string;
  original: {
    width: number;
    height: number;
    durationSec: number;
    fps: number;
    codec: string;
    fileSizeBytes: number;
  };
  proxy: {
    width: number;
    height: number;
    durationSec: number;
    fps: number;
    fileSizeBytes: number;
  };
}

export function readProxyMeta(metaPath: string): StoredProxyMeta | null {
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8')) as StoredProxyMeta;
  } catch {
    return null;
  }
}

export function writeProxyMeta(metaPath: string, meta: StoredProxyMeta): void {
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

export function proxyExists(mp4Path: string, metaPath: string): boolean {
  return existsSync(mp4Path) && existsSync(metaPath) && statSync(mp4Path).size > 0;
}

/** Deletes one proxy's mp4 + metadata sidecar. Returns whether anything was deleted. */
export function deleteProxy(mp4Path: string, metaPath: string): boolean {
  let deleted = false;
  for (const p of [mp4Path, metaPath]) {
    if (existsSync(p)) {
      rmSync(p, { force: true });
      deleted = true;
    }
  }
  return deleted;
}

/** Deletes every generated proxy file. Returns how many files were removed. */
export function clearAllProxies(): number {
  if (!existsSync(PROXIES_DIR)) return 0;
  const entries = readdirSync(PROXIES_DIR);
  for (const entry of entries) {
    rmSync(join(PROXIES_DIR, entry), { force: true });
  }
  return entries.length;
}

/** A fresh, collision-free path in temp/sources/ for one uploaded original. */
export function uniqueSourcePath(originalName: string): string {
  const dotIndex = originalName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : '.mp4';
  const safeExt = /^\.[a-zA-Z0-9]{1,5}$/.test(ext) ? ext : '.mp4';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;
  return join(SOURCES_DIR, unique);
}

/** Best-effort delete of a temp source file — never throws. */
export function cleanupSourceFile(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { force: true });
  } catch {
    // best-effort
  }
}
