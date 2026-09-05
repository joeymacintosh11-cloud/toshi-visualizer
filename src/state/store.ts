import { create } from 'zustand';
import type {
  BackgroundSettings,
  BeatInfo,
  EffectSettings,
  ExportSettings,
  VisualizerPreset,
} from '../types/visualizer';
import type { PreviewQuality } from '../renderer/qualityTiers';
import { DEFAULT_EFFECTS, DEFAULT_PRESETS } from '../presets/defaultPresets';
import { loadCustomPresets } from '../presets/presetStorage';

export interface AudioFileInfo {
  file: File;
  url: string;
  durationSec: number;
}

export interface BackgroundFileInfo {
  file: File;
  url: string;
  durationSec: number;
  width: number;
  height: number;
  /** Populated from ffprobe once a proxy round-trip has happened; absent for skipped (already-lightweight) sources. */
  codec?: string;
  fps?: number;
}

export interface BackgroundProxyInfo {
  url: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
}

export type BackgroundProxyStatus = 'idle' | 'generating' | 'ready' | 'not-needed' | 'error';

/** Revokes a Blob URL if it's actually a Blob URL (guards against double-revoke / non-blob URLs). */
function revoke(url: string | undefined): void {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

interface ToshiState {
  beatInfo: BeatInfo;
  audio: AudioFileInfo | null;
  background: BackgroundFileInfo | null;
  backgroundSettings: BackgroundSettings;
  effects: EffectSettings;
  activePresetId: string;
  customPresets: VisualizerPreset[];
  exportSettings: ExportSettings;
  logoImage: HTMLImageElement | null;
  previewQuality: PreviewQuality;
  backgroundProxy: BackgroundProxyInfo | null;
  backgroundProxyStatus: BackgroundProxyStatus;
  /** Short, UI-displayable reason for the last proxy generation failure, if any. */
  backgroundProxyError: string | null;

  setBeatInfo: (partial: Partial<BeatInfo>) => void;
  setAudio: (audio: AudioFileInfo | null) => void;
  setBackground: (background: BackgroundFileInfo | null) => void;
  /** Merges ffprobe-derived codec/fps into the current background once a proxy round-trip reveals them. */
  setBackgroundOriginalMeta: (meta: { codec: string; fps: number }) => void;
  setBackgroundSettings: (partial: Partial<BackgroundSettings>) => void;
  setEffects: (partial: Partial<EffectSettings>) => void;
  applyPreset: (preset: VisualizerPreset) => void;
  setActivePresetId: (id: string) => void;
  refreshCustomPresets: () => void;
  setExportSettings: (partial: Partial<ExportSettings>) => void;
  setLogoImage: (image: HTMLImageElement | null) => void;
  setPreviewQuality: (quality: PreviewQuality) => void;
  setBackgroundProxy: (proxy: BackgroundProxyInfo | null) => void;
  setBackgroundProxyStatus: (status: BackgroundProxyStatus) => void;
  setBackgroundProxyError: (message: string | null) => void;
}

const defaultBeatInfo: BeatInfo = {
  title: 'GHETTO GEEK',
  typeBeatLine: '50 CENT x 2000s HIP-HOP TYPE BEAT',
  bpm: '94',
  key: 'F MINOR',
  producer: 'Prod. Toshi',
  website: 'toshibeats.com',
  usageNotice: 'FREE FOR NON-PROFIT USE ONLY',
  purchaseCta: 'PURCHASE LICENSE — LINK IN DESCRIPTION',
};

const defaultBackgroundSettings: BackgroundSettings = {
  fitMode: 'cover',
  posX: 0,
  posY: 0,
  zoom: 1,
  playbackSpeed: 1,
  startOffsetSec: 0,
  loop: true,
  muteOriginalAudio: true,
  twoThousandsMode: true,
};

export const useToshiStore = create<ToshiState>((set) => ({
  beatInfo: defaultBeatInfo,
  audio: null,
  background: null,
  backgroundSettings: defaultBackgroundSettings,
  effects: DEFAULT_EFFECTS,
  activePresetId: DEFAULT_PRESETS[0].id,
  customPresets: loadCustomPresets(),
  exportSettings: {
    resolution: '1920x1080',
    framerate: 30,
    quality: 'high',
  },
  logoImage: null,
  previewQuality: 'medium',
  backgroundProxy: null,
  backgroundProxyStatus: 'idle',
  backgroundProxyError: null,

  setBeatInfo: (partial) => set((s) => ({ beatInfo: { ...s.beatInfo, ...partial } })),
  setAudio: (audio) =>
    set((s) => {
      if (s.audio && s.audio.url !== audio?.url) revoke(s.audio.url);
      return { audio };
    }),
  setBackground: (background) =>
    set((s) => {
      if (s.background && s.background.url !== background?.url) revoke(s.background.url);
      // A new/removed background invalidates any proxy generated for the old one.
      if (s.backgroundProxy) revoke(s.backgroundProxy.url);
      return { background, backgroundProxy: null, backgroundProxyStatus: 'idle', backgroundProxyError: null };
    }),
  setBackgroundOriginalMeta: (meta) =>
    set((s) => (s.background ? { background: { ...s.background, ...meta } } : {})),
  setBackgroundSettings: (partial) =>
    set((s) => ({ backgroundSettings: { ...s.backgroundSettings, ...partial } })),
  setEffects: (partial) => set((s) => ({ effects: { ...s.effects, ...partial } })),
  applyPreset: (preset) =>
    set((s) => ({
      effects: { ...preset.effects },
      backgroundSettings: { ...s.backgroundSettings, twoThousandsMode: preset.background.twoThousandsMode },
      activePresetId: preset.id,
    })),
  setActivePresetId: (id) => set({ activePresetId: id }),
  refreshCustomPresets: () => set({ customPresets: loadCustomPresets() }),
  setExportSettings: (partial) =>
    set((s) => ({ exportSettings: { ...s.exportSettings, ...partial } })),
  setLogoImage: (logoImage) => set({ logoImage }),
  setPreviewQuality: (previewQuality) => set({ previewQuality }),
  setBackgroundProxy: (proxy) =>
    set((s) => {
      if (s.backgroundProxy && s.backgroundProxy.url !== proxy?.url) revoke(s.backgroundProxy.url);
      return { backgroundProxy: proxy };
    }),
  setBackgroundProxyStatus: (backgroundProxyStatus) => set({ backgroundProxyStatus }),
  setBackgroundProxyError: (backgroundProxyError) => set({ backgroundProxyError }),
}));

export function getAllPresets(): VisualizerPreset[] {
  return [...DEFAULT_PRESETS, ...useToshiStore.getState().customPresets];
}
