// Core type definitions shared across the app: state shape, presets, and
// the per-frame audio analysis contract used by both live preview and export.

export type FitMode = 'cover' | 'contain' | 'crop';
export type ExportQuality = 'draft' | 'high' | 'maximum';
export type ExportResolution = '1920x1080' | '2560x1440' | '3840x2160';
export type ExportFramerate = 24 | 25 | 30 | 60;

/** User-entered metadata rendered into the visualizer composition. */
export interface BeatInfo {
  title: string;
  typeBeatLine: string;
  bpm: string;
  key: string;
  producer: string;
  website: string;
  usageNotice: string;
  purchaseCta: string;
}

export interface BackgroundSettings {
  fitMode: FitMode;
  posX: number; // -1..1, horizontal pan
  posY: number; // -1..1, vertical pan
  zoom: number; // 1 = no extra zoom
  playbackSpeed: number; // 0.25..2
  startOffsetSec: number;
  loop: boolean;
  muteOriginalAudio: boolean;
  twoThousandsMode: boolean;
}

/** All audio-reactivity and visual-texture sliders, 0..1 unless noted. */
export interface EffectSettings {
  masterIntensity: number;
  bassSensitivity: number;
  midSensitivity: number;
  highSensitivity: number;
  transientSensitivity: number;
  smoothing: number; // 0..1, higher = smoother/slower response

  backgroundZoomAmount: number;
  cameraShake: number;
  titlePunch: number;
  flickerIntensity: number;

  grain: number;
  scanlines: number;
  vignette: number;
  backgroundBrightness: number; // -1..1
  contrast: number; // -1..1
  saturation: number; // -1..1
  blur: number; // px, 0..8
  chromaticAberration: number;

  showOverlays: boolean;
  grainEnabled: boolean;
  scanlinesEnabled: boolean;
  vignetteEnabled: boolean;
  chromaticAberrationEnabled: boolean;
  cameraShakeEnabled: boolean;
}

export interface VisualizerPreset {
  id: string;
  name: string;
  builtIn: boolean;
  background: Pick<BackgroundSettings, 'twoThousandsMode'>;
  effects: EffectSettings;
}

/** One analyzed audio frame, aligned to a specific output video frame index. */
export interface AudioFrameData {
  bass: number;
  mid: number;
  high: number;
  transient: number; // 0..1 punch envelope from transient detection
}

export interface AudioAnalysisResult {
  frames: AudioFrameData[];
  fps: number;
  durationSec: number;
  sampleRate: number;
}

export interface ExportSettings {
  resolution: ExportResolution;
  framerate: ExportFramerate;
  quality: ExportQuality;
}

export type ExportStage =
  | 'idle'
  | 'analyzing-audio'
  | 'preparing-render'
  | 'rendering-frames'
  | 'encoding-video'
  | 'muxing-audio'
  | 'done'
  | 'cancelled'
  | 'error';

export interface ExportProgress {
  stage: ExportStage;
  currentFrame: number;
  totalFrames: number;
  message: string;
}

/** Live (smoothed, not-yet-transient-shaped) analyser readout for preview. */
export interface LiveAudioLevels {
  bass: number;
  mid: number;
  high: number;
  transient: number;
}
