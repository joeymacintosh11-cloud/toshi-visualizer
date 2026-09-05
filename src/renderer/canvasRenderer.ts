import type {
  AudioFrameData,
  BackgroundSettings,
  BeatInfo,
  EffectSettings,
} from '../types/visualizer';
import { drawBackground, drawPendingPlaceholder, type BackgroundDrawSource } from './backgroundRenderer';
import {
  applyChromaticAberration,
  applyExposureFlash,
  applyGrain,
  applyLineFlash,
  applyScanlines,
  applyVignette,
  getCameraShakeOffset,
  getFlickerAlpha,
} from './effectsRenderer';
import {
  drawBottomBar,
  drawLogo,
  drawMetadata,
  drawOverlays,
  drawSignature,
  drawTitleBlock,
} from './typographyRenderer';
import { getQualityAdjustments, type PreviewQuality } from './qualityTiers';

export interface RenderFrameParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  backgroundSource: BackgroundDrawSource | null;
  beatInfo: BeatInfo;
  backgroundSettings: BackgroundSettings;
  effects: EffectSettings;
  audioFrame: AudioFrameData;
  frameIndex: number;
  timeSec: number;
  logoImage: HTMLImageElement | null;
  /**
   * Preview performance tier. Omit (or 'high') for full-fidelity rendering —
   * export never passes this, so it always renders at full quality
   * regardless of whatever the live preview is currently using.
   */
  qualityTier?: PreviewQuality;
  /** True while a background proxy is being generated — draws a lightweight placeholder instead of decoding the (possibly huge) original. */
  backgroundPending?: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// One-pole low-pass rates for motion smoothing — higher = snappier,
// lower = smoother. Applied on top of the already-shaped transient/bass
// envelopes purely to remove the visible "jump" on the exact frame a
// transient fires, per the "avoid sudden snapping" motion-polish brief.
// Both engine instances (live preview and export) hold their own state, and
// since export renders frames strictly in sequence, this stays fully
// deterministic frame-to-frame.
const TITLE_PUNCH_SMOOTHING = 0.4;
const BACKGROUND_ZOOM_SMOOTHING = 0.22;

/**
 * Owns the offscreen "scene" canvas used as an intermediate composite so
 * chromatic aberration can be applied as a single final pass over the fully
 * composed frame (background + typography) rather than per-layer.
 */
export class VisualizerEngine {
  private sceneCanvas: HTMLCanvasElement;
  private sceneCtx: CanvasRenderingContext2D;
  private smoothedTitleScale = 1;
  private smoothedZoom = 1;

  constructor() {
    this.sceneCanvas = document.createElement('canvas');
    this.sceneCtx = this.sceneCanvas.getContext('2d')!;
  }

  renderFrame(params: RenderFrameParams): void {
    const {
      ctx,
      width,
      height,
      backgroundSource,
      beatInfo,
      backgroundSettings,
      effects,
      audioFrame,
      frameIndex,
      timeSec,
      logoImage,
      qualityTier = 'high',
      backgroundPending = false,
    } = params;

    const quality = getQualityAdjustments(qualityTier, effects);

    if (this.sceneCanvas.width !== width || this.sceneCanvas.height !== height) {
      this.sceneCanvas.width = width;
      this.sceneCanvas.height = height;
    }
    const scene = this.sceneCtx;
    scene.clearRect(0, 0, width, height);

    // Resolve raw analyser bands into sensitivity- and master-scaled
    // "reactive" values used to drive every visual response below.
    const bassReactive = clamp01(audioFrame.bass * effects.bassSensitivity * effects.masterIntensity);
    const midReactive = clamp01(audioFrame.mid * effects.midSensitivity * effects.masterIntensity);
    const highReactive = clamp01(audioFrame.high * effects.highSensitivity * effects.masterIntensity);
    // Note: transientSensitivity is already baked into audioFrame.transient
    // at analysis time (it controls the detection threshold), so it is not
    // re-applied here — only master intensity scales its visual magnitude.
    const transientReactive = clamp01(audioFrame.transient * effects.masterIntensity);

    // Background push zoom: mostly transient-driven (kick punch) with a
    // small continuous contribution from sustained bass energy. Smoothed
    // frame-to-frame so a transient's instant attack doesn't read as a
    // visible zoom "jump" — the punch still lands, just eased in.
    const zoomDriver = clamp01(bassReactive * 0.4 + transientReactive * 0.8);
    const targetZoom = 1 + effects.backgroundZoomAmount * 0.025 * zoomDriver;
    this.smoothedZoom += (targetZoom - this.smoothedZoom) * BACKGROUND_ZOOM_SMOOTHING;
    const reactiveZoom = this.smoothedZoom;

    const shake =
      effects.cameraShakeEnabled
        ? getCameraShakeOffset(frameIndex, midReactive, effects.cameraShake, height)
        : { x: 0, y: 0 };

    scene.save();
    scene.translate(shake.x, shake.y);
    drawBackground(
      scene,
      backgroundSource,
      width,
      height,
      backgroundSettings,
      reactiveZoom,
      effects.backgroundBrightness,
      effects.contrast,
      effects.saturation,
      quality.blurPx,
      quality.skipBloom,
    );
    if (!backgroundSource && backgroundPending) {
      drawPendingPlaceholder(scene, width, height);
    }
    scene.restore();

    // Mid-driven micro-flashes sit on top of the (shaken) footage, before
    // the fixed graphics layer, so they read as in-camera events.
    applyExposureFlash(scene, width, height, midReactive);
    if (effects.cameraShakeEnabled) {
      applyLineFlash(scene, width, height, frameIndex, midReactive * effects.cameraShake);
    }

    // Fixed branded graphics layer — does not move with camera shake.
    drawLogo(scene, logoImage, width, height);
    // Static signature mark — deliberately not audio-reactive, see its doc comment.
    drawSignature(scene, logoImage, width, height);

    // Bass-driven title punch: smoothed the same way as the background
    // zoom above, and the peak is kept intentionally subtle (max ~1.3%
    // scale) so it reads as a musical accent rather than a UI bounce.
    const targetTitleScale = 1 + effects.titlePunch * 0.013 * transientReactive;
    this.smoothedTitleScale += (targetTitleScale - this.smoothedTitleScale) * TITLE_PUNCH_SMOOTHING;
    const titleOffsetY = -(effects.titlePunch * (3 / 1080) * height) * transientReactive;
    drawTitleBlock(scene, width, height, beatInfo, this.smoothedTitleScale, titleOffsetY);

    drawMetadata(scene, width, height, beatInfo);
    if (effects.showOverlays) {
      const recBlinkOn = Math.floor(timeSec) % 2 === 0;
      drawOverlays(scene, width, height, timeSec, recBlinkOn);
    }
    drawBottomBar(scene, width, height, beatInfo);

    // High frequencies subtly increase grain/scanline visibility on top of
    // their base slider values ("texture visibility" reacting to highs) —
    // kept restrained so a bright hi-hat passage doesn't wash the footage
    // in visible noise. Both are further scaled down on the Low preview
    // quality tier.
    if (effects.grainEnabled) {
      applyGrain(
        scene,
        width,
        height,
        effects.grain * (1 + highReactive * 0.35) * quality.grainAlphaMultiplier,
        frameIndex,
      );
    }
    if (effects.scanlinesEnabled) {
      applyScanlines(
        scene,
        width,
        height,
        effects.scanlines * (1 + highReactive * 0.25),
        quality.scanlineSpacingMultiplier,
      );
    }

    const flickerAlpha = getFlickerAlpha(frameIndex, highReactive, effects.flickerIntensity);
    if (flickerAlpha > 0) {
      scene.save();
      scene.globalCompositeOperation = 'screen';
      scene.globalAlpha = flickerAlpha;
      scene.fillStyle = '#ffffff';
      scene.fillRect(0, 0, width, height);
      scene.restore();
    }

    if (effects.vignetteEnabled) {
      applyVignette(scene, width, height, effects.vignette, bassReactive);
    }

    ctx.clearRect(0, 0, width, height);
    if (quality.chromaticAberrationEnabled && effects.chromaticAberration > 0) {
      // Scale with resolution so the fringing reads the same at 4K export
      // as it does in the 720p live preview, matching the camera-shake scaling above.
      const resolutionScale = height / 1080;
      applyChromaticAberration(
        ctx,
        this.sceneCanvas,
        width,
        height,
        effects.chromaticAberration * resolutionScale,
      );
    } else {
      ctx.drawImage(this.sceneCanvas, 0, 0, width, height);
    }
  }
}
