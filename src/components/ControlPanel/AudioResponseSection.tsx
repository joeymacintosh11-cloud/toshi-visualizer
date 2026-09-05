import { useToshiStore } from '../../state/store';
import { Section } from './Section';
import { Slider } from './Slider';

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** Sliders controlling how strongly each frequency band drives the visuals. */
export function AudioResponseSection() {
  const effects = useToshiStore((s) => s.effects);
  const setEffects = useToshiStore((s) => s.setEffects);

  return (
    <Section title="Audio Response">
      <Slider
        label="Master Visualizer Intensity"
        value={effects.masterIntensity}
        max={1.5}
        formatValue={percent}
        onChange={(masterIntensity) => setEffects({ masterIntensity })}
      />
      <Slider
        label="Bass Sensitivity"
        value={effects.bassSensitivity}
        formatValue={percent}
        onChange={(bassSensitivity) => setEffects({ bassSensitivity })}
      />
      <Slider
        label="Mid Sensitivity"
        value={effects.midSensitivity}
        formatValue={percent}
        onChange={(midSensitivity) => setEffects({ midSensitivity })}
      />
      <Slider
        label="High Sensitivity"
        value={effects.highSensitivity}
        formatValue={percent}
        onChange={(highSensitivity) => setEffects({ highSensitivity })}
      />
      <Slider
        label="Transient Sensitivity"
        value={effects.transientSensitivity}
        formatValue={percent}
        onChange={(transientSensitivity) => setEffects({ transientSensitivity })}
      />
      <Slider
        label="Smoothing"
        value={effects.smoothing}
        max={0.95}
        formatValue={percent}
        onChange={(smoothing) => setEffects({ smoothing })}
      />
    </Section>
  );
}
