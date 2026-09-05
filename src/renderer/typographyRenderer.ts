import type { BeatInfo } from '../types/visualizer';
import {
  BOTTOM_BAR_HEIGHT_RATIO,
  BOTTOM_BAR_MAX_ALPHA,
  BOTTOM_BAR_TEXT_OPACITY,
  BOTTOM_BAR_TEXT_SIZE_RATIO,
  BRAND_COLORS,
  FONT_DISPLAY,
  FONT_LABEL,
  LOGO_BACKING_ALPHA,
  LOGO_BACKING_RADIUS_RATIO,
  LOGO_HEIGHT_RATIO,
  LOGO_MARGIN_RATIO,
  LOGO_OPACITY,
  LOGO_SHADOW_BLUR_RATIO,
  LOGO_SHADOW_COLOR,
  METADATA_LINE_GAP_RATIO,
  METADATA_PRIMARY_SIZE_RATIO,
  METADATA_RIGHT_X_RATIO,
  METADATA_RULE_WIDTH_RATIO,
  METADATA_SECONDARY_SIZE_RATIO,
  METADATA_TERTIARY_SIZE_RATIO,
  METADATA_TOP_Y_RATIO,
  OVERLAY_REC_DOT_OPACITY,
  OVERLAY_TEXT_OPACITY,
  RULE_THICKNESS_RATIO,
  SAFE_MARGIN_TOP,
  SIGNATURE_GAP_BELOW_LOGO_RATIO,
  SIGNATURE_RULE_TO_TEXT_GAP_RATIO,
  SIGNATURE_RULE_WIDTH_RATIO,
  SIGNATURE_SUBLABEL_LETTER_SPACING_RATIO,
  SIGNATURE_SUBLABEL_OPACITY,
  SIGNATURE_SUBLABEL_SIZE_RATIO,
  SIGNATURE_TEXT_LETTER_SPACING_RATIO,
  SIGNATURE_TEXT_OPACITY,
  SIGNATURE_TEXT_SIZE_RATIO,
  SIGNATURE_TEXT_TO_SUBLABEL_GAP_RATIO,
  TITLE_BASELINE_Y_RATIO,
  TITLE_GLOW_BLUR_RATIO,
  TITLE_GLOW_COLOR,
  TITLE_HORIZONTAL_COMPRESSION,
  TITLE_MAX_SIZE_RATIO,
  TITLE_MAX_WIDTH_RATIO,
  TITLE_MIN_SIZE_RATIO,
  TITLE_SHADOW_BLUR_RATIO,
  TITLE_SHADOW_COLOR,
  TITLE_SHADOW_OFFSET_Y_RATIO,
  TITLE_STROKE_COLOR,
  TITLE_STROKE_WIDTH_RATIO,
  TITLE_TO_TYPELINE_GAP_RATIO,
  TYPE_LINE_LETTER_SPACING_RATIO,
  TYPE_LINE_OPACITY,
  TYPE_LINE_RULE_GAP_RATIO,
  TYPE_LINE_RULE_WIDTH_RATIO,
  TYPE_LINE_SHADOW_BLUR_RATIO,
  TYPE_LINE_SHADOW_COLOR,
  TYPE_LINE_SHADOW_OFFSET_Y_RATIO,
  TYPE_LINE_SIZE_RATIO,
  SAFE_MARGIN_X,
} from './designTokens';

function drawLetterSpaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: 'left' | 'right' | 'center' = 'left',
) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const totalWidth = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);

  let cursor = x;
  if (align === 'right') cursor = x - totalWidth;
  if (align === 'center') cursor = x - totalWidth / 2;

  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], cursor, y);
    cursor += widths[i] + spacing;
  }
  ctx.textAlign = prevAlign;
}

/** Returns the logo's on-canvas bounding box, so callers (e.g. the signature mark) can anchor relative to it. */
export function getLogoBounds(logoImage: HTMLImageElement | null, w: number, h: number) {
  const margin = w * LOGO_MARGIN_RATIO;
  const targetH = h * LOGO_HEIGHT_RATIO;
  const hasImage = Boolean(logoImage && logoImage.naturalWidth > 0);
  // Fallback wordmark has no known image aspect yet — assume a typical
  // condensed-wordmark proportion so the backing glow/signature gap still
  // sit in a sensible place before the real logo has loaded.
  const aspect = hasImage ? logoImage!.naturalWidth / logoImage!.naturalHeight : 3.2;
  const targetW = targetH * aspect;
  return { margin, targetW, targetH, hasImage };
}

export function drawLogo(
  ctx: CanvasRenderingContext2D,
  logoImage: HTMLImageElement | null,
  w: number,
  h: number,
) {
  const { margin, targetW, targetH, hasImage } = getLogoBounds(logoImage, w, h);

  ctx.save();

  // A soft, localized radial glow (never a hard-edged card) sits behind the
  // logo so it stays legible over bright or visually busy footage — plain
  // darkening rather than any rectangle, so it never reads as a UI backing.
  const cx = margin + targetW / 2;
  const cy = margin + targetH / 2;
  const backingRadius = targetH * LOGO_BACKING_RADIUS_RATIO;
  const backing = ctx.createRadialGradient(cx, cy, 0, cx, cy, backingRadius);
  backing.addColorStop(0, `rgba(0,0,0,${LOGO_BACKING_ALPHA})`);
  backing.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = backing;
  ctx.fillRect(0, 0, w, h);

  // Soft drop shadow for depth on top of the backing glow.
  ctx.shadowColor = LOGO_SHADOW_COLOR;
  ctx.shadowBlur = targetH * LOGO_SHADOW_BLUR_RATIO;
  ctx.shadowOffsetY = targetH * 0.04;

  if (hasImage) {
    ctx.globalAlpha = LOGO_OPACITY;
    ctx.drawImage(logoImage!, margin, margin, targetW, targetH);
    ctx.restore();
    return;
  }

  // Fallback wordmark if no logo image has loaded yet.
  ctx.fillStyle = BRAND_COLORS.cream;
  ctx.font = `700 ${Math.round(h * 0.03)}px ${FONT_LABEL}`;
  ctx.textBaseline = 'top';
  drawLetterSpaced(ctx, 'TOSHI', margin, margin + h * 0.01, h * 0.006);
  ctx.restore();
}

/**
 * Toshi's signature catalog/tape-index mark: a thin gold rule, "TSH / 001",
 * and a tiny secondary label — placed just below the logo, in the open
 * space above the title block. Static by design (no audio-reactive
 * modulation) so it reads as a fixed brand mark rather than another moving
 * element, per the "brand recognition, not visual activity" brief.
 */
export function drawSignature(
  ctx: CanvasRenderingContext2D,
  logoImage: HTMLImageElement | null,
  w: number,
  h: number,
) {
  const { margin, targetH } = getLogoBounds(logoImage, w, h);
  const x = margin;
  const ruleY = margin + targetH + h * SIGNATURE_GAP_BELOW_LOGO_RATIO;

  ctx.save();

  ctx.strokeStyle = BRAND_COLORS.gold;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(1, h * RULE_THICKNESS_RATIO);
  ctx.beginPath();
  ctx.moveTo(x, ruleY);
  ctx.lineTo(x + w * SIGNATURE_RULE_WIDTH_RATIO, ruleY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const textY = ruleY + h * SIGNATURE_RULE_TO_TEXT_GAP_RATIO;
  ctx.font = `600 ${h * SIGNATURE_TEXT_SIZE_RATIO}px ${FONT_LABEL}`;
  ctx.fillStyle = `rgba(184,134,11,${SIGNATURE_TEXT_OPACITY})`;
  ctx.textBaseline = 'top';
  drawLetterSpaced(ctx, 'TSH / 001', x, textY, h * SIGNATURE_TEXT_LETTER_SPACING_RATIO);

  const sublabelY = textY + h * SIGNATURE_TEXT_TO_SUBLABEL_GAP_RATIO;
  ctx.font = `500 ${h * SIGNATURE_SUBLABEL_SIZE_RATIO}px ${FONT_LABEL}`;
  ctx.fillStyle = `rgba(244,232,208,${SIGNATURE_SUBLABEL_OPACITY})`;
  drawLetterSpaced(ctx, 'TOSHI AUDIO', x, sublabelY, h * SIGNATURE_SUBLABEL_LETTER_SPACING_RATIO);

  ctx.restore();
}

/** Picks a title font size that fills the available width for short titles and shrinks to fit long ones. */
function fitTitleFontSize(ctx: CanvasRenderingContext2D, text: string, h: number, w: number): number {
  const maxSize = h * TITLE_MAX_SIZE_RATIO;
  const minSize = h * TITLE_MIN_SIZE_RATIO;
  const maxWidth = w * TITLE_MAX_WIDTH_RATIO;

  const probeSize = 100;
  ctx.font = `400 ${probeSize}px ${FONT_DISPLAY}, 'Arial Black', sans-serif`;
  const widthAtProbe = ctx.measureText(text).width;
  if (widthAtProbe <= 0) return maxSize;

  const sizeToFit = (maxWidth / widthAtProbe) * probeSize;
  return Math.max(minSize, Math.min(maxSize, sizeToFit));
}

/**
 * Main title + type-beat line. Positioned lower-middle/center-left rather
 * than dead center, per brand direction — it should read like a video
 * treatment credit, not a dead-centered app title. Font size auto-fits the
 * title length so short titles stay bold and impactful while long ones
 * never overflow into the metadata module or the frame edge.
 */
export function drawTitleBlock(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  beatInfo: BeatInfo,
  titleScale: number,
  titleOffsetY: number,
) {
  const x = w * SAFE_MARGIN_X;
  const baselineY = h * TITLE_BASELINE_Y_RATIO + titleOffsetY;
  const titleText = beatInfo.title.toUpperCase();
  const fontSize = fitTitleFontSize(ctx, titleText, h, w);

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.translate(x, baselineY);
  ctx.scale(titleScale * TITLE_HORIZONTAL_COMPRESSION, titleScale);

  ctx.font = `400 ${fontSize}px ${FONT_DISPLAY}, 'Arial Black', sans-serif`;

  // Layer 1: soft dark shadow for grounded depth — reads as part of the
  // footage's own lighting rather than a floating UI card.
  ctx.shadowColor = TITLE_SHADOW_COLOR;
  ctx.shadowBlur = fontSize * TITLE_SHADOW_BLUR_RATIO;
  ctx.shadowOffsetY = fontSize * TITLE_SHADOW_OFFSET_Y_RATIO;
  ctx.fillStyle = BRAND_COLORS.cream;
  ctx.fillText(titleText, 0, 0);

  // Layer 2: an extremely faint warm gold halo for a touch of premium glow.
  ctx.shadowColor = TITLE_GLOW_COLOR;
  ctx.shadowBlur = fontSize * TITLE_GLOW_BLUR_RATIO;
  ctx.shadowOffsetY = 0;
  ctx.fillText(titleText, 0, 0);

  // Layer 3: crisp final pass — thin dark stroke for edge definition over
  // bright/busy footage, then the cream fill on top with no shadow so the
  // letterforms stay sharp.
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.lineWidth = fontSize * TITLE_STROKE_WIDTH_RATIO;
  ctx.strokeStyle = TITLE_STROKE_COLOR;
  ctx.strokeText(titleText, 0, 0);
  ctx.fillText(titleText, 0, 0);
  ctx.restore();

  // Type beat line beneath the title — small, wide letter spacing, clearly
  // readable rather than fading toward invisible. A subtle shadow gives it
  // footage separation without adding a stroke that would make it compete
  // visually with the title's own treatment.
  const lineY = baselineY + h * TITLE_TO_TYPELINE_GAP_RATIO;
  const typeLineFontSize = h * TYPE_LINE_SIZE_RATIO;
  ctx.save();
  ctx.font = `500 ${typeLineFontSize}px ${FONT_LABEL}`;
  ctx.fillStyle = `rgba(244,232,208,${TYPE_LINE_OPACITY})`;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = TYPE_LINE_SHADOW_COLOR;
  ctx.shadowBlur = typeLineFontSize * TYPE_LINE_SHADOW_BLUR_RATIO;
  ctx.shadowOffsetY = typeLineFontSize * TYPE_LINE_SHADOW_OFFSET_Y_RATIO;
  drawLetterSpaced(ctx, beatInfo.typeBeatLine.toUpperCase(), x, lineY, h * TYPE_LINE_LETTER_SPACING_RATIO);
  ctx.restore();

  // Small recurring brand motif: a thin gold rule under the type line, the
  // same visual language as the rule above the metadata module.
  ctx.save();
  ctx.strokeStyle = BRAND_COLORS.gold;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, h * RULE_THICKNESS_RATIO);
  const ruleY = lineY + h * TYPE_LINE_RULE_GAP_RATIO;
  ctx.beginPath();
  ctx.moveTo(x, ruleY);
  ctx.lineTo(x + w * TYPE_LINE_RULE_WIDTH_RATIO, ruleY);
  ctx.stroke();
  ctx.restore();
}

/**
 * Right-side metadata module with a clear size hierarchy: BPM strongest
 * (gold accent), key secondary, producer smallest — rather than three
 * equally-weighted lines.
 */
export function drawMetadata(ctx: CanvasRenderingContext2D, w: number, h: number, beatInfo: BeatInfo) {
  const rightX = w * METADATA_RIGHT_X_RATIO;
  const startY = h * METADATA_TOP_Y_RATIO;
  const lineGap = h * METADATA_LINE_GAP_RATIO;

  ctx.save();

  // Thin gold rule above the block.
  ctx.strokeStyle = BRAND_COLORS.gold;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = Math.max(1, h * RULE_THICKNESS_RATIO);
  ctx.beginPath();
  ctx.moveTo(rightX - w * METADATA_RULE_WIDTH_RATIO, startY - lineGap * 0.9);
  ctx.lineTo(rightX, startY - lineGap * 0.9);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.textBaseline = 'alphabetic';

  // BPM — strongest: largest size, gold accent.
  ctx.font = `600 ${h * METADATA_PRIMARY_SIZE_RATIO}px ${FONT_LABEL}`;
  ctx.fillStyle = BRAND_COLORS.gold;
  drawLetterSpaced(ctx, `${beatInfo.bpm} BPM`, rightX, startY, h * 0.0022, 'right');

  // Key — secondary.
  const keyY = startY + lineGap;
  ctx.font = `500 ${h * METADATA_SECONDARY_SIZE_RATIO}px ${FONT_LABEL}`;
  ctx.fillStyle = 'rgba(244,232,208,0.88)';
  drawLetterSpaced(ctx, beatInfo.key.toUpperCase(), rightX, keyY, h * 0.002, 'right');

  // Producer — smallest, dimmest.
  const producerY = keyY + lineGap * 0.82;
  ctx.font = `500 ${h * METADATA_TERTIARY_SIZE_RATIO}px ${FONT_LABEL}`;
  ctx.fillStyle = 'rgba(244,232,208,0.55)';
  drawLetterSpaced(ctx, beatInfo.producer.toUpperCase(), rightX, producerY, h * 0.0016, 'right');

  ctx.restore();
}

/** Thin branded bottom info bar: usage notice, purchase CTA, website. */
export function drawBottomBar(ctx: CanvasRenderingContext2D, w: number, h: number, beatInfo: BeatInfo) {
  const barHeight = h * BOTTOM_BAR_HEIGHT_RATIO;
  const y = h - barHeight;

  ctx.save();
  // A long, gradual taper rather than a hard-edged bar — reads as a
  // translucent scrim over the footage instead of a heavy solid strip.
  const gradient = ctx.createLinearGradient(0, y - barHeight * 0.6, 0, h);
  gradient.addColorStop(0, 'rgba(11,11,11,0)');
  gradient.addColorStop(0.55, `rgba(11,11,11,${BOTTOM_BAR_MAX_ALPHA * 0.55})`);
  gradient.addColorStop(1, `rgba(11,11,11,${BOTTOM_BAR_MAX_ALPHA})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y - barHeight * 0.6, w, barHeight * 1.6);

  const fontSize = h * BOTTOM_BAR_TEXT_SIZE_RATIO;
  const textY = h - barHeight / 2;
  ctx.font = `500 ${fontSize}px ${FONT_LABEL}`;
  ctx.textBaseline = 'middle';

  ctx.fillStyle = `rgba(244,232,208,${BOTTOM_BAR_TEXT_OPACITY})`;
  drawLetterSpaced(ctx, beatInfo.usageNotice.toUpperCase(), w * SAFE_MARGIN_X, textY, h * 0.0015, 'left');

  ctx.fillStyle = BRAND_COLORS.gold;
  drawLetterSpaced(ctx, beatInfo.purchaseCta.toUpperCase(), w * 0.5, textY, h * 0.0015, 'center');

  ctx.fillStyle = `rgba(244,232,208,${BOTTOM_BAR_TEXT_OPACITY})`;
  drawLetterSpaced(ctx, beatInfo.website.toUpperCase(), w * (1 - SAFE_MARGIN_X - 0.01), textY, h * 0.0015, 'right');
  ctx.restore();
}

function formatTimecode(seconds: number): string {
  const total = Math.max(0, seconds);
  const mm = Math.floor(total / 60);
  const ss = Math.floor(total % 60);
  const ff = Math.floor((total % 1) * 30);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/**
 * Optional DVD-menu / camcorder-inspired technical overlays. Deliberately
 * restrained — background texture that reinforces the brand rather than
 * primary UI, so opacity stays low and nothing competes with the title.
 */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeSec: number,
  recBlinkOn: boolean,
) {
  const fontSize = h * 0.0142;
  ctx.save();
  ctx.font = `500 ${fontSize}px ${FONT_LABEL}`;
  ctx.fillStyle = `rgba(244,232,208,${OVERLAY_TEXT_OPACITY})`;
  ctx.textBaseline = 'top';

  // Top-right: REC dot + STEREO / 16:9
  const topRightX = w * (1 - SAFE_MARGIN_X);
  const topY = h * SAFE_MARGIN_TOP;
  if (recBlinkOn) {
    ctx.save();
    ctx.fillStyle = BRAND_COLORS.darkRed;
    ctx.globalAlpha = OVERLAY_REC_DOT_OPACITY;
    ctx.beginPath();
    ctx.arc(topRightX - w * 0.075, topY + fontSize * 0.5, fontSize * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = `rgba(244,232,208,${OVERLAY_TEXT_OPACITY})`;
  drawLetterSpaced(ctx, 'REC', topRightX - w * 0.06, topY, h * 0.0015, 'left');
  drawLetterSpaced(ctx, 'STEREO', topRightX, topY + fontSize * 1.6, h * 0.0015, 'right');
  drawLetterSpaced(ctx, '16:9', topRightX, topY + fontSize * 3.2, h * 0.0015, 'right');

  // Bottom-left, above the info bar: catalog code + running timecode.
  const blX = w * SAFE_MARGIN_X;
  const blY = h * 0.88;
  drawLetterSpaced(ctx, 'TSH-001', blX, blY, h * 0.0015, 'left');
  drawLetterSpaced(ctx, formatTimecode(timeSec), blX, blY + fontSize * 1.6, h * 0.0015, 'left');

  ctx.restore();
}
