import type { BackgroundSettings } from '../types/visualizer';
import { BRAND_COLORS } from './brandColors';
import { FONT_LABEL } from './designTokens';

// A fixed, brand-consistent warm cast applied under "2000s Video Mode" —
// there's no user-facing "warmth" slider, so this lives as a design
// constant rather than a slider value. Soft-light blend keeps it subtle:
// it nudges the footage's own midtones warm without flattening contrast
// the way a sepia filter would.
const WARMTH_TINT_COLOR = 'rgba(122,60,20,0.10)';

export interface BackgroundDrawSource {
  element: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Computes the draw rect for a background source under a given fit mode,
 * plus user pan/zoom and an extra bass-reactive "push" zoom (already
 * resolved to a scale multiplier by the caller).
 */
function computeCoverRect(
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  fitMode: BackgroundSettings['fitMode'],
  zoom: number,
  posX: number,
  posY: number,
) {
  // 'cover' and 'crop' both fill the frame edge-to-edge; 'crop' is the same
  // math but is the mode users reach for when they intend to pair it with
  // manual zoom/pan for a tighter, more deliberate frame.
  const baseScale =
    fitMode === 'contain'
      ? Math.min(canvasW / srcW, canvasH / srcH)
      : Math.max(canvasW / srcW, canvasH / srcH);

  const scale = baseScale * zoom;
  const drawW = srcW * scale;
  const drawH = srcH * scale;

  const overflowX = drawW - canvasW;
  const overflowY = drawH - canvasH;

  // posX/posY are -1..1; map to how far we can pan within the overflow.
  const x = -(overflowX / 2) - (posX * overflowX) / 2;
  const y = -(overflowY / 2) - (posY * overflowY) / 2;

  return { x, y, w: drawW, h: drawH };
}

/**
 * Draws the background source into the canvas with fit/pan/zoom applied,
 * plus an optional "2000s Video Mode" color grade and soft highlight bloom.
 * Blur, brightness, contrast and saturation are applied via a single
 * canvas `filter` string so the cost stays proportional to one draw call.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  source: BackgroundDrawSource | null,
  canvasW: number,
  canvasH: number,
  settings: BackgroundSettings,
  reactiveZoom: number,
  brightness: number,
  contrast: number,
  saturation: number,
  blurPx: number,
  skipBloom = false,
) {
  ctx.save();
  ctx.fillStyle = BRAND_COLORS.black;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Guard against a video element whose metadata hasn't loaded yet (width/
  // height still 0) — drawing with a zero-size source would divide by zero
  // and throw when computing the fit rect.
  if (!source || source.width <= 0 || source.height <= 0) {
    ctx.restore();
    return;
  }

  const rect = computeCoverRect(
    source.width,
    source.height,
    canvasW,
    canvasH,
    settings.fitMode,
    settings.zoom * reactiveZoom,
    settings.posX,
    settings.posY,
  );

  const b = 1 + brightness;
  const c = 1 + contrast;
  const s = 1 + saturation;
  const filterParts: string[] = [];
  if (b !== 1) filterParts.push(`brightness(${b})`);
  if (c !== 1) filterParts.push(`contrast(${c})`);
  if (s !== 1) filterParts.push(`saturate(${s})`);
  if (blurPx > 0) filterParts.push(`blur(${blurPx}px)`);
  ctx.filter = filterParts.length ? filterParts.join(' ') : 'none';

  ctx.drawImage(source.element, rect.x, rect.y, rect.w, rect.h);

  if (settings.twoThousandsMode) {
    if (!skipBloom) {
      // Soft highlight bloom: a brighter, blurred duplicate screened on top.
      // Approximates lifted, glowing highlights without a true HDR pipeline.
      // This is the single costliest draw here (a second full-frame blurred
      // drawImage), so it's the first thing skipped on the Low preview tier.
      ctx.filter = `brightness(1.5) blur(${Math.max(blurPx, 8)}px)`;
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.18;
      ctx.drawImage(source.element, rect.x, rect.y, rect.w, rect.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Subtle analog warmth — a fixed low-alpha warm cast over the footage
    // rect only (never bleeds into any letterboxed black bars).
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = WARMTH_TINT_COLOR;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.filter = 'none';
  ctx.restore();
}

/**
 * Lightweight placeholder shown over the plain black fill while a preview
 * proxy is being generated — deliberately does not touch the (possibly 4K)
 * original video element, which is the whole point of proxying it.
 */
export function drawPendingPlaceholder(ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number) {
  ctx.save();
  ctx.fillStyle = BRAND_COLORS.cream;
  ctx.globalAlpha = 0.55;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${Math.round(canvasH * 0.024)}px ${FONT_LABEL}`;
  ctx.fillText('PREPARING PREVIEW…', canvasW / 2, canvasH / 2);
  ctx.restore();
}
