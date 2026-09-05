// Visual design tokens for the Toshi V2 look. Centralizes the values that
// were previously scattered as magic numbers across the renderer files, so
// the brand treatment (typography scale, spacing, safe areas, opacity,
// shadow depth) can be tuned in one place. Purely presentational — nothing
// here touches audio analysis, playback, export, or upload logic.
import { BRAND_COLORS } from './brandColors';

export { BRAND_COLORS };

// ---------- Typography ----------
// Anton (bold condensed display) for the title, Oswald (condensed label
// face) for everything else — the same pairing as V1, per brand direction.
export const FONT_DISPLAY = 'Anton';
export const FONT_LABEL = "'Oswald', 'Arial Narrow', sans-serif";

// ---------- Safe area ----------
// Consistent margins so no overlay sits too close to the frame edge, a
// platform's own player chrome, or the bottom info bar.
export const SAFE_MARGIN_X = 0.045; // fraction of width, both sides
export const SAFE_MARGIN_TOP = 0.05; // fraction of height

// ---------- Title block ----------
export const TITLE_MAX_SIZE_RATIO = 0.108; // of height — ceiling for short titles
export const TITLE_MIN_SIZE_RATIO = 0.05; // of height — floor for long titles, never smaller
export const TITLE_MAX_WIDTH_RATIO = 0.6; // of width — available before the metadata zone
export const TITLE_BASELINE_Y_RATIO = 0.695; // moved up from V1's 0.74 for more bottom-bar breathing room
export const TITLE_TO_TYPELINE_GAP_RATIO = 0.05;
export const TITLE_HORIZONTAL_COMPRESSION = 0.985; // extremely subtle analog/anamorphic softness

export const TITLE_SHADOW_COLOR = 'rgba(0,0,0,0.55)';
export const TITLE_SHADOW_BLUR_RATIO = 0.07; // of font size
export const TITLE_SHADOW_OFFSET_Y_RATIO = 0.028; // of font size
export const TITLE_GLOW_COLOR = 'rgba(184,134,11,0.14)'; // gold, very low alpha
export const TITLE_GLOW_BLUR_RATIO = 0.14; // of font size
export const TITLE_STROKE_COLOR = 'rgba(11,11,11,0.4)';
export const TITLE_STROKE_WIDTH_RATIO = 0.016; // of font size

// ---------- Type-beat line ----------
export const TYPE_LINE_SIZE_RATIO = 0.0205; // unchanged size — V3 only adjusts opacity/contrast, per brief
export const TYPE_LINE_OPACITY = 0.84; // V3: bumped from 0.72 for readability on bright/busy footage
export const TYPE_LINE_LETTER_SPACING_RATIO = 0.0038;
export const TYPE_LINE_RULE_WIDTH_RATIO = 0.03; // small recurring gold divider motif, width relative to canvas width
export const TYPE_LINE_RULE_GAP_RATIO = 0.016; // gap between type line and the rule beneath it
export const TYPE_LINE_SHADOW_COLOR = 'rgba(0,0,0,0.5)'; // subtle footage-separation shadow, added in V3
export const TYPE_LINE_SHADOW_BLUR_RATIO = 0.35; // of font size
export const TYPE_LINE_SHADOW_OFFSET_Y_RATIO = 0.06; // of font size

// ---------- Right-side metadata module ----------
export const METADATA_RIGHT_X_RATIO = 0.945;
export const METADATA_TOP_Y_RATIO = 0.585;
export const METADATA_PRIMARY_SIZE_RATIO = 0.026; // BPM — strongest
export const METADATA_SECONDARY_SIZE_RATIO = 0.019; // Key — secondary
export const METADATA_TERTIARY_SIZE_RATIO = 0.0142; // Producer — smallest
export const METADATA_LINE_GAP_RATIO = 0.0285;
export const METADATA_RULE_WIDTH_RATIO = 0.085;

// ---------- Bottom info bar ----------
export const BOTTOM_BAR_HEIGHT_RATIO = 0.064;
export const BOTTOM_BAR_TEXT_SIZE_RATIO = 0.0148;
export const BOTTOM_BAR_MAX_ALPHA = 0.6; // softer translucent strip, was 0.72
export const BOTTOM_BAR_TEXT_OPACITY = 0.82;

// ---------- Logo ----------
export const LOGO_MARGIN_RATIO = 0.045;
export const LOGO_HEIGHT_RATIO = 0.092; // V3: +~12% over V2's 0.082 for visibility on busy/dark footage
export const LOGO_OPACITY = 0.96;
export const LOGO_SHADOW_COLOR = 'rgba(0,0,0,0.5)';
export const LOGO_SHADOW_BLUR_RATIO = 0.35; // of logo height
// V3: soft radial backing glow behind the logo — never a hard-edged card —
// so it stays legible over bright/busy footage without looking pasted on.
export const LOGO_BACKING_ALPHA = 0.24; // peak alpha at logo center, radial falloff to 0
export const LOGO_BACKING_RADIUS_RATIO = 1.7; // multiple of logo height

// ---------- Toshi signature element (catalog/tape-index motif) ----------
// Static brand mark placed just below the logo: a thin gold rule, "TSH / 001",
// and a tiny secondary label. Deliberately understated — see typographyRenderer.
export const SIGNATURE_GAP_BELOW_LOGO_RATIO = 0.032; // gap between logo bottom edge and signature block
export const SIGNATURE_RULE_WIDTH_RATIO = 0.032; // short thin line, fraction of canvas width
export const SIGNATURE_TEXT_SIZE_RATIO = 0.0132;
export const SIGNATURE_TEXT_OPACITY = 0.78;
export const SIGNATURE_TEXT_LETTER_SPACING_RATIO = 0.0028;
export const SIGNATURE_SUBLABEL_SIZE_RATIO = 0.0102;
export const SIGNATURE_SUBLABEL_OPACITY = 0.38;
export const SIGNATURE_SUBLABEL_LETTER_SPACING_RATIO = 0.0032;
export const SIGNATURE_RULE_TO_TEXT_GAP_RATIO = 0.014;
export const SIGNATURE_TEXT_TO_SUBLABEL_GAP_RATIO = 0.02;

// ---------- Technical/DVD overlay layer (optional, restrained) ----------
export const OVERLAY_TEXT_OPACITY = 0.42; // was 0.55 — background texture, not primary UI
export const OVERLAY_REC_DOT_OPACITY = 0.68;

// ---------- Shared line/rule thickness ----------
export const RULE_THICKNESS_RATIO = 0.0016; // of height
