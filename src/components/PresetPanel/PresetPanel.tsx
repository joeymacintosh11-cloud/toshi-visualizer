import { useState } from 'react';
import { useToshiStore } from '../../state/store';
import { DEFAULT_PRESETS } from '../../presets/defaultPresets';
import {
  deleteCustomPreset,
  renameCustomPreset,
  saveCustomPreset,
} from '../../presets/presetStorage';
import { Section } from '../ControlPanel/Section';
import type { VisualizerPreset } from '../../types/visualizer';

/** Preset selector plus save/rename/delete for custom presets (persisted to localStorage). */
export function PresetPanel() {
  const effects = useToshiStore((s) => s.effects);
  const backgroundSettings = useToshiStore((s) => s.backgroundSettings);
  const activePresetId = useToshiStore((s) => s.activePresetId);
  const customPresets = useToshiStore((s) => s.customPresets);
  const applyPreset = useToshiStore((s) => s.applyPreset);
  const refreshCustomPresets = useToshiStore((s) => s.refreshCustomPresets);

  const [newPresetName, setNewPresetName] = useState('');

  const allPresets = [...DEFAULT_PRESETS, ...customPresets];
  const activePreset = allPresets.find((p) => p.id === activePresetId);

  function handleSaveNew() {
    const name = newPresetName.trim();
    if (!name) return;
    const preset: VisualizerPreset = {
      id: `custom-${Date.now()}`,
      name,
      builtIn: false,
      background: { twoThousandsMode: backgroundSettings.twoThousandsMode },
      effects,
    };
    saveCustomPreset(preset);
    refreshCustomPresets();
    applyPreset(preset);
    setNewPresetName('');
  }

  function handleRename(preset: VisualizerPreset) {
    const name = window.prompt('Rename preset', preset.name);
    if (!name || !name.trim()) return;
    renameCustomPreset(preset.id, name.trim());
    refreshCustomPresets();
  }

  function handleDelete(preset: VisualizerPreset) {
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
    deleteCustomPreset(preset.id);
    refreshCustomPresets();
  }

  return (
    <Section title="Presets">
      <div className="preset-list">
        {allPresets.map((preset) => (
          <div key={preset.id} className="preset-list__row">
            <button
              type="button"
              className={`preset-chip${preset.id === activePresetId ? ' preset-chip--active' : ''}`}
              onClick={() => applyPreset(preset)}
              title={preset.builtIn ? 'Built-in preset' : 'Custom preset'}
            >
              {preset.name}
            </button>
            {!preset.builtIn && (
              <span className="preset-list__actions">
                <button type="button" className="btn-icon" onClick={() => handleRename(preset)}>
                  Rename
                </button>
                <button type="button" className="btn-icon" onClick={() => handleDelete(preset)}>
                  Delete
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="upload-field__row" style={{ marginTop: '0.75rem' }}>
        <input
          type="text"
          placeholder="New preset name"
          value={newPresetName}
          onChange={(e) => setNewPresetName(e.target.value)}
        />
        <button type="button" className="btn" onClick={handleSaveNew}>
          Save Current as Preset
        </button>
      </div>
      {activePreset && <p className="field-hint">Active: {activePreset.name}</p>}
    </Section>
  );
}
