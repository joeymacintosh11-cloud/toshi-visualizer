import type { EffectSettings, VisualizerPreset } from '../types/visualizer';

const baseEffects: EffectSettings = {
  masterIntensity: 1,
  bassSensitivity: 0.6,
  midSensitivity: 0.5,
  highSensitivity: 0.5,
  transientSensitivity: 0.5,
  smoothing: 0.6,

  backgroundZoomAmount: 0.5,
  cameraShake: 0.3,
  titlePunch: 0.5,
  flickerIntensity: 0.3,

  grain: 0.2,
  scanlines: 0.15,
  vignette: 0.35,
  backgroundBrightness: -0.05,
  contrast: 0.1,
  saturation: -0.05,
  blur: 0,
  chromaticAberration: 0.1,

  showOverlays: false,
  grainEnabled: true,
  scanlinesEnabled: true,
  vignetteEnabled: true,
  chromaticAberrationEnabled: true,
  cameraShakeEnabled: true,
};

/** Toshi Classic — balanced, clean, warm, premium; minimal reaction. The safe default for most uploads. */
const toshiClassic: VisualizerPreset = {
  id: 'toshi-classic',
  name: 'Toshi Classic',
  builtIn: true,
  background: { twoThousandsMode: true },
  effects: {
    ...baseEffects,
    bassSensitivity: 0.45,
    transientSensitivity: 0.35,
    backgroundZoomAmount: 0.3,
    cameraShake: 0.08,
    titlePunch: 0.35,
    flickerIntensity: 0.12,
    grain: 0.12,
    scanlines: 0.08,
    vignette: 0.28,
    contrast: 0.08,
    saturation: -0.03,
    chromaticAberration: 0.04,
    showOverlays: false,
  },
};

/** Gritty 2000s — stronger contrast, heavier grain, subtle scanlines, slightly stronger punch, mild chromatic aberration. */
const gritty2000s: VisualizerPreset = {
  id: 'gritty-2000s',
  name: 'Gritty 2000s',
  builtIn: true,
  background: { twoThousandsMode: true },
  effects: {
    ...baseEffects,
    bassSensitivity: 0.75,
    midSensitivity: 0.6,
    highSensitivity: 0.6,
    transientSensitivity: 0.65,
    backgroundZoomAmount: 0.6,
    cameraShake: 0.35,
    titlePunch: 0.6,
    flickerIntensity: 0.3,
    grain: 0.5,
    scanlines: 0.18,
    vignette: 0.42,
    contrast: 0.28,
    saturation: -0.12,
    chromaticAberration: 0.2,
    showOverlays: false,
  },
};

/** Clean Cinematic — nearly no retro effects, clean typography, very subtle grain, no overlays, softer image processing. */
const cleanCinematic: VisualizerPreset = {
  id: 'clean-cinematic',
  name: 'Clean Cinematic',
  builtIn: true,
  background: { twoThousandsMode: false },
  effects: {
    ...baseEffects,
    bassSensitivity: 0.3,
    midSensitivity: 0.2,
    highSensitivity: 0.18,
    transientSensitivity: 0.28,
    smoothing: 0.78,
    backgroundZoomAmount: 0.2,
    cameraShake: 0,
    titlePunch: 0.25,
    flickerIntensity: 0,
    grain: 0.04,
    scanlines: 0,
    vignette: 0.18,
    contrast: 0.04,
    saturation: 0,
    blur: 0.4,
    chromaticAberration: 0,
    showOverlays: false,
    scanlinesEnabled: false,
    chromaticAberrationEnabled: false,
    cameraShakeEnabled: false,
  },
};

/** Street DVD — early-2000s hip-hop DVD homage: stronger technical overlay language, stronger scanlines, still premium — not parody VHS. */
const streetDvd: VisualizerPreset = {
  id: 'street-dvd',
  name: 'Street DVD',
  builtIn: true,
  background: { twoThousandsMode: true },
  effects: {
    ...baseEffects,
    bassSensitivity: 0.6,
    midSensitivity: 0.55,
    highSensitivity: 0.55,
    transientSensitivity: 0.5,
    backgroundZoomAmount: 0.45,
    cameraShake: 0.22,
    titlePunch: 0.5,
    flickerIntensity: 0.3,
    grain: 0.32,
    scanlines: 0.45,
    vignette: 0.33,
    contrast: 0.16,
    saturation: -0.07,
    chromaticAberration: 0.13,
    showOverlays: true,
  },
};

export const DEFAULT_PRESETS: VisualizerPreset[] = [
  toshiClassic,
  gritty2000s,
  cleanCinematic,
  streetDvd,
];

export const DEFAULT_EFFECTS: EffectSettings = toshiClassic.effects;
