// Texture and post-processing effects: grain, scanlines, vignette, chromatic
// aberration, and camera shake. Grain uses a small set of pre-rendered noise
// tiles selected deterministically by frame index, so the same beat always
// produces the same grain pattern (required for reproducible export) while
// avoiding a full per-pixel noise pass at large export resolutions.

/** Deterministic PRNG (mulberry32) — same seed always yields the same sequence. */
function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAIN_TILE_SIZE = 160;
const GRAIN_TILE_COUNT = 12;

let cachedGrainPatterns: CanvasPattern[] | null = null;

/**
 * Builds noise tiles with a compressed, softened value range rather than
 * full-range 0-255 uniform noise. Averaging three independent random draws
 * per pixel pulls the distribution toward a bell curve (central limit
 * theorem) instead of harsh salt-and-pepper — closer to how film/video
 * grain actually reads: fine, soft-edged variation rather than digital
 * static.
 */
function buildGrainTiles(ctx: CanvasRenderingContext2D): CanvasPattern[] {
  const patterns: CanvasPattern[] = [];
  for (let i = 0; i < GRAIN_TILE_COUNT; i++) {
    const rand = mulberry32(1000 + i);
    const tile = document.createElement('canvas');
    tile.width = GRAIN_TILE_SIZE;
    tile.height = GRAIN_TILE_SIZE;
    const tctx = tile.getContext('2d')!;
    const imageData = tctx.createImageData(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
    for (let p = 0; p < imageData.data.length; p += 4) {
      const blended = (rand() + rand() + rand()) / 3; // ~0..1, bell-shaped
      const v = Math.round(128 + (blended - 0.5) * 190); // compressed toward mid-gray
      imageData.data[p] = v;
      imageData.data[p + 1] = v;
      imageData.data[p + 2] = v;
      imageData.data[p + 3] = 255;
    }
    tctx.putImageData(imageData, 0, 0);
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) patterns.push(pattern);
  }
  return patterns;
}

/** Overlays film grain using a deterministic tile chosen by frame index. */
export function applyGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
  frameIndex: number,
) {
  if (amount <= 0) return;
  if (!cachedGrainPatterns) cachedGrainPatterns = buildGrainTiles(ctx);
  const pattern = cachedGrainPatterns[frameIndex % cachedGrainPatterns.length];

  ctx.save();
  // 'soft-light' reads gentler and more filmic than 'overlay', which can
  // punch noise into harsh local contrast.
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = Math.min(amount, 1) * 0.65;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Thin horizontal scanlines, spaced relative to canvas height. Uses a low
 * duty cycle (a thin dark line in a much wider gap) and a soft alpha cap so
 * they read as faint interlace texture rather than obvious black stripes.
 * A higher `spacingMultiplier` (used on the Low preview quality tier)
 * spreads them further apart, halving or more the number of fillRect calls
 * per frame.
 */
export function applyScanlines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
  spacingMultiplier = 1,
) {
  if (amount <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = Math.min(amount, 1) * 0.2;
  ctx.fillStyle = '#000000';
  const cycle = Math.max(3, Math.round((h / 300) * spacingMultiplier));
  const lineThickness = Math.max(1, Math.round(cycle * 0.35));
  for (let y = 0; y < h; y += cycle) {
    ctx.fillRect(0, y, w, lineThickness);
  }
  ctx.restore();
}

/**
 * Radial vignette darkening the frame edges; `pulse` briefly deepens it on
 * bass hits. Falloff starts wide (well past the center) and eases in with
 * an extra mid-stop so it reads as soft cinematic edge darkening rather
 * than a visible dark circle — the bottom info bar stays readable since it
 * already carries its own contrast scrim independent of this.
 */
export function applyVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
  pulse: number,
) {
  if (amount <= 0) return;
  const intensity = Math.min(amount + pulse * 0.12, 1);
  ctx.save();
  const cx = w / 2;
  const cy = h / 2;
  const outerRadius = Math.sqrt(cx * cx + cy * cy);
  const gradient = ctx.createRadialGradient(cx, cy, outerRadius * 0.62, cx, cy, outerRadius);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.7, `rgba(0,0,0,${intensity * 0.35})`);
  gradient.addColorStop(1, `rgba(0,0,0,${intensity * 0.85})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// Reused across calls instead of creating a new offscreen canvas every
// frame — CA previously allocated a fresh canvas per call, which was one of
// the more expensive per-frame allocations in the whole render loop. Sized
// on demand for whatever resolution last requested it (preview or export).
let cachedChannelCanvas: HTMLCanvasElement | null = null;
let cachedChannelCtx: CanvasRenderingContext2D | null = null;

function getChannelScratchCanvas(w: number, h: number): CanvasRenderingContext2D {
  if (!cachedChannelCanvas) {
    cachedChannelCanvas = document.createElement('canvas');
    cachedChannelCtx = cachedChannelCanvas.getContext('2d')!;
  }
  if (cachedChannelCanvas.width !== w || cachedChannelCanvas.height !== h) {
    cachedChannelCanvas.width = w;
    cachedChannelCanvas.height = h;
  }
  return cachedChannelCtx!;
}

/**
 * Approximate chromatic aberration: isolates each RGB channel by multiplying
 * the source against a pure primary color (which zeroes the other two
 * channels), then recombines the three with small opposing offsets using
 * additive ('lighter') blending. Cheaper than a per-pixel channel shift.
 */
export function applyChromaticAberration(
  destCtx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  w: number,
  h: number,
  amount: number,
) {
  if (amount <= 0) {
    destCtx.drawImage(sourceCanvas, 0, 0, w, h);
    return;
  }

  const offset = amount * 6; // px at export/preview resolution scale is applied by caller

  const cctx = getChannelScratchCanvas(w, h);
  const channel = cctx.canvas;

  const drawChannel = (color: string, dx: number) => {
    cctx.clearRect(0, 0, w, h);
    cctx.drawImage(sourceCanvas, 0, 0, w, h);
    cctx.globalCompositeOperation = 'multiply';
    cctx.fillStyle = color;
    cctx.fillRect(0, 0, w, h);
    cctx.globalCompositeOperation = 'source-over';
    destCtx.globalCompositeOperation = 'lighter';
    destCtx.drawImage(channel, dx, 0, w, h);
  };

  destCtx.save();
  destCtx.fillStyle = '#000000';
  destCtx.fillRect(0, 0, w, h);
  drawChannel('#ff0000', -offset);
  drawChannel('#00ff00', 0);
  drawChannel('#0000ff', offset);
  destCtx.globalCompositeOperation = 'source-over';
  destCtx.restore();
}

/**
 * Smooth 1D value noise: interpolates between random "keyframes" placed
 * every `period` frames with an eased (smoothstep) blend, instead of a
 * fresh independent random value every single frame. Still a pure
 * deterministic function of frameIndex — export stays frame-accurate — but
 * produces a slow organic drift instead of white-noise jitter.
 */
function smoothNoise01(frameIndex: number, period: number, seedOffset: number): number {
  const t = frameIndex / period;
  const i0 = Math.floor(t);
  const frac = t - i0;
  const eased = frac * frac * (3 - 2 * frac);
  const v0 = mulberry32(i0 * 97 + seedOffset)();
  const v1 = mulberry32((i0 + 1) * 97 + seedOffset)();
  return v0 + (v1 - v0) * eased;
}

// Frames between shake drift "keyframes" — low enough to feel alive, high
// enough to read as handheld drift rather than a vibration.
const SHAKE_DRIFT_PERIOD_FRAMES = 10;

/**
 * Deterministic per-frame camera shake offset in pixels — a slow, organic
 * drift (smooth value noise) rather than independent random jitter every
 * frame, which read as digital vibration. Amplitude is also lower than the
 * original implementation per the "slightly organic, not violent" brief.
 */
export function getCameraShakeOffset(
  frameIndex: number,
  midReactive: number,
  shakeAmount: number,
  canvasHeight: number,
) {
  if (shakeAmount <= 0) return { x: 0, y: 0 };
  const nx = smoothNoise01(frameIndex, SHAKE_DRIFT_PERIOD_FRAMES, 13) * 2 - 1;
  const ny = smoothNoise01(frameIndex, SHAKE_DRIFT_PERIOD_FRAMES, 977) * 2 - 1;
  const maxShakePx = (canvasHeight / 1080) * 2.4; // reduced from 4px — low-amplitude, less digital
  const magnitude = shakeAmount * midReactive * maxShakePx;
  return {
    x: nx * magnitude,
    y: ny * magnitude,
  };
}

/** Deterministic per-frame flicker (subtle brightness jitter) driven by highs. */
export function getFlickerAlpha(frameIndex: number, highReactive: number, flickerIntensity: number) {
  if (flickerIntensity <= 0) return 0;
  const rand = mulberry32(frameIndex * 233 + 7);
  return rand() * highReactive * flickerIntensity * 0.05;
}

/** A very faint full-frame brightness lift on mid transients (snare "exposure flash"). */
export function applyExposureFlash(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  midReactive: number,
) {
  if (midReactive <= 0.03) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = Math.min(midReactive, 1) * 0.045;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** A single thin gold line flash at a deterministic position, driven by mids — restrained, not a strobe. */
export function applyLineFlash(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frameIndex: number,
  midReactive: number,
) {
  if (midReactive <= 0.22) return;
  const rand = mulberry32(frameIndex * 331 + 41);
  const y = rand() * h;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = Math.min(midReactive, 1) * 0.16;
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(0, y, w, Math.max(1, h * 0.0015));
  ctx.restore();
}
