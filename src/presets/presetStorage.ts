import type { VisualizerPreset } from '../types/visualizer';

const STORAGE_KEY = 'toshi-visualizer-custom-presets';

export function loadCustomPresets(): VisualizerPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomPresets(presets: VisualizerPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function saveCustomPreset(preset: VisualizerPreset): VisualizerPreset[] {
  const existing = loadCustomPresets();
  const index = existing.findIndex((p) => p.id === preset.id);
  const next =
    index >= 0
      ? existing.map((p, i) => (i === index ? preset : p))
      : [...existing, preset];
  saveCustomPresets(next);
  return next;
}

export function renameCustomPreset(id: string, name: string): VisualizerPreset[] {
  const next = loadCustomPresets().map((p) => (p.id === id ? { ...p, name } : p));
  saveCustomPresets(next);
  return next;
}

export function deleteCustomPreset(id: string): VisualizerPreset[] {
  const next = loadCustomPresets().filter((p) => p.id !== id);
  saveCustomPresets(next);
  return next;
}
