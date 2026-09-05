import { useToshiStore } from '../../state/store';
import type { FitMode } from '../../types/visualizer';
import { Section } from './Section';
import { Slider } from './Slider';
import { Toggle } from './Toggle';

const FIT_MODES: FitMode[] = ['cover', 'contain', 'crop'];

/** Background video framing, timing, and the "2000s Video Mode" color-grade toggle. */
export function BackgroundSection() {
  const backgroundSettings = useToshiStore((s) => s.backgroundSettings);
  const background = useToshiStore((s) => s.background);
  const setBackgroundSettings = useToshiStore((s) => s.setBackgroundSettings);

  return (
    <Section title="Background Video" defaultOpen={false}>
      <label className="text-field">
        <span className="text-field__label">Fit Mode</span>
        <select
          value={backgroundSettings.fitMode}
          onChange={(e) => setBackgroundSettings({ fitMode: e.target.value as FitMode })}
        >
          {FIT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode[0].toUpperCase() + mode.slice(1)}
            </option>
          ))}
        </select>
      </label>

      <Slider
        label="Horizontal Position"
        min={-1}
        max={1}
        value={backgroundSettings.posX}
        onChange={(posX) => setBackgroundSettings({ posX })}
      />
      <Slider
        label="Vertical Position"
        min={-1}
        max={1}
        value={backgroundSettings.posY}
        onChange={(posY) => setBackgroundSettings({ posY })}
      />
      <Slider
        label="Zoom"
        min={1}
        max={2}
        value={backgroundSettings.zoom}
        onChange={(zoom) => setBackgroundSettings({ zoom })}
      />
      <Slider
        label="Playback Speed"
        min={0.25}
        max={2}
        value={backgroundSettings.playbackSpeed}
        onChange={(playbackSpeed) => setBackgroundSettings({ playbackSpeed })}
      />
      <Slider
        label="Start Offset (sec)"
        min={0}
        max={background ? Math.max(0, background.durationSec - 1) : 60}
        step={0.1}
        value={backgroundSettings.startOffsetSec}
        formatValue={(v) => `${v.toFixed(1)}s`}
        onChange={(startOffsetSec) => setBackgroundSettings({ startOffsetSec })}
      />

      <Toggle
        label="2000s Video Mode"
        checked={backgroundSettings.twoThousandsMode}
        onChange={(twoThousandsMode) => setBackgroundSettings({ twoThousandsMode })}
      />
    </Section>
  );
}
