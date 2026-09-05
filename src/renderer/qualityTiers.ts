import type { EffectSettings } from '../types/visualizer';

export type PreviewQuality = 'low' | 'medium' | 'high';

/** Internal canvas render resolution for each preview quality tier. */
export const PREVIEW_QUALITY_DIMENSIONS: Record<PreviewQuality, { width: number; height: number }> = {
  low: { width: 854, height: 480 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
};

export interface QualityAdjustments {
  /** Chromatic aberration is disabled outright on Low — it's the most expensive effect pass. */
  chromaticAberrationEnabled: boolean;
  /** Skips the extra blurred "highlight bloom" drawImage pass in 2000s Video Mode. */
  skipBloom: boolean;
  /** Background blur filter, possibly clamped to 0 on Low (canvas blur filters are costly). */
  blurPx: number;
  grainAlphaMultiplier: number;
  scanlineSpacingMultiplier: number;
}

/**
 * Export always calls the renderer without a quality tier, which defaults to
 * 'high' here — so export is never affected by preview performance trimming.
 */
export function getQualityAdjustments(tier: PreviewQuality, effects: EffectSettings): QualityAdjustments {
  if (tier === 'low') {
    return {
      chromaticAberrationEnabled: false,
      skipBloom: true,
      blurPx: 0,
      grainAlphaMultiplier: 0.6,
      scanlineSpacingMultiplier: 2,
    };
  }
  // Medium and High both render full effect fidelity — they differ from
  // each other only in canvas resolution (see PREVIEW_QUALITY_DIMENSIONS),
  // which already scales per-frame cost proportionally.
  return {
    chromaticAberrationEnabled: effects.chromaticAberrationEnabled,
    skipBloom: false,
    blurPx: effects.blur,
    grainAlphaMultiplier: 1,
    scanlineSpacingMultiplier: 1,
  };
}
