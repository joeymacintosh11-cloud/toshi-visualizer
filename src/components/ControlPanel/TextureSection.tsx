import { useToshiStore } from '../../state/store';
import { Section } from './Section';
import { Slider } from './Slider';
import { Toggle } from './Toggle';

const percent = (v: number) => `${Math.round(v * 100)}%`;
const signedPercent = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;

/** Visual texture and color-grade sliders, each with an individual enable toggle where relevant. */
export function TextureSection() {
  const effects = useToshiStore((s) => s.effects);
  const setEffects = useToshiStore((s) => s.setEffects);

  return (
    <Section title="Visual Texture" defaultOpen={false}>
      <Slider
        label="Grain"
        value={effects.grain}
        formatValue={percent}
        disabled={!effects.grainEnabled}
        onChange={(grain) => setEffects({ grain })}
      />
      <Toggle
        label="Enable Grain"
        checked={effects.grainEnabled}
        onChange={(grainEnabled) => setEffects({ grainEnabled })}
      />

      <Slider
        label="Scanlines"
        value={effects.scanlines}
        formatValue={percent}
        disabled={!effects.scanlinesEnabled}
        onChange={(scanlines) => setEffects({ scanlines })}
      />
      <Toggle
        label="Enable Scanlines"
        checked={effects.scanlinesEnabled}
        onChange={(scanlinesEnabled) => setEffects({ scanlinesEnabled })}
      />

      <Slider
        label="Vignette"
        value={effects.vignette}
        formatValue={percent}
        disabled={!effects.vignetteEnabled}
        onChange={(vignette) => setEffects({ vignette })}
      />
      <Toggle
        label="Enable Vignette"
        checked={effects.vignetteEnabled}
        onChange={(vignetteEnabled) => setEffects({ vignetteEnabled })}
      />

      <Slider
        label="Chromatic Aberration"
        value={effects.chromaticAberration}
        formatValue={percent}
        disabled={!effects.chromaticAberrationEnabled}
        onChange={(chromaticAberration) => setEffects({ chromaticAberration })}
      />
      <Toggle
        label="Enable Chromatic Aberration"
        checked={effects.chromaticAberrationEnabled}
        onChange={(chromaticAberrationEnabled) => setEffects({ chromaticAberrationEnabled })}
      />

      <Slider
        label="Background Brightness"
        value={effects.backgroundBrightness}
        min={-1}
        max={1}
        formatValue={signedPercent}
        onChange={(backgroundBrightness) => setEffects({ backgroundBrightness })}
      />
      <Slider
        label="Contrast"
        value={effects.contrast}
        min={-1}
        max={1}
        formatValue={signedPercent}
        onChange={(contrast) => setEffects({ contrast })}
      />
      <Slider
        label="Saturation"
        value={effects.saturation}
        min={-1}
        max={1}
        formatValue={signedPercent}
        onChange={(saturation) => setEffects({ saturation })}
      />
      <Slider
        label="Blur"
        value={effects.blur}
        min={0}
        max={8}
        step={0.1}
        formatValue={(v) => `${v.toFixed(1)}px`}
        onChange={(blur) => setEffects({ blur })}
      />

      <Toggle
        label="Show Technical Overlays (DVD/camcorder style)"
        checked={effects.showOverlays}
        onChange={(showOverlays) => setEffects({ showOverlays })}
      />
    </Section>
  );
}
