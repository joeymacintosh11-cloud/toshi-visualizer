import { useToshiStore } from '../../state/store';
import { Section } from './Section';
import { Slider } from './Slider';
import { Toggle } from './Toggle';

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** Sliders controlling motion: background push zoom, shake, title punch, flicker. */
export function MotionSection() {
  const effects = useToshiStore((s) => s.effects);
  const setEffects = useToshiStore((s) => s.setEffects);

  return (
    <Section title="Motion">
      <Slider
        label="Background Zoom Amount"
        value={effects.backgroundZoomAmount}
        formatValue={percent}
        onChange={(backgroundZoomAmount) => setEffects({ backgroundZoomAmount })}
      />
      <Slider
        label="Camera Shake"
        value={effects.cameraShake}
        formatValue={percent}
        disabled={!effects.cameraShakeEnabled}
        onChange={(cameraShake) => setEffects({ cameraShake })}
      />
      <Toggle
        label="Enable Camera Shake"
        checked={effects.cameraShakeEnabled}
        onChange={(cameraShakeEnabled) => setEffects({ cameraShakeEnabled })}
      />
      <Slider
        label="Title Punch"
        value={effects.titlePunch}
        formatValue={percent}
        onChange={(titlePunch) => setEffects({ titlePunch })}
      />
      <Slider
        label="Flicker Intensity"
        value={effects.flickerIntensity}
        formatValue={percent}
        onChange={(flickerIntensity) => setEffects({ flickerIntensity })}
      />
    </Section>
  );
}
