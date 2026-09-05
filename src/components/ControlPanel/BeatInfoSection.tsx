import { useToshiStore } from '../../state/store';
import type { BeatInfo } from '../../types/visualizer';
import { Section } from './Section';

const FIELDS: { key: keyof BeatInfo; label: string }[] = [
  { key: 'title', label: 'Beat Title' },
  { key: 'typeBeatLine', label: 'Type Beat / Artist Reference' },
  { key: 'bpm', label: 'BPM' },
  { key: 'key', label: 'Key' },
  { key: 'producer', label: 'Producer Name' },
  { key: 'website', label: 'Website' },
  { key: 'usageNotice', label: 'Usage Notice' },
  { key: 'purchaseCta', label: 'Purchase CTA' },
];

/** Form for all beat metadata rendered into the visualizer composition. */
export function BeatInfoSection() {
  const beatInfo = useToshiStore((s) => s.beatInfo);
  const setBeatInfo = useToshiStore((s) => s.setBeatInfo);

  return (
    <Section title="Beat Information">
      {FIELDS.map(({ key, label }) => (
        <label key={key} className="text-field">
          <span className="text-field__label">{label}</span>
          <input
            type="text"
            value={beatInfo[key]}
            onChange={(e) => setBeatInfo({ [key]: e.target.value })}
          />
        </label>
      ))}
    </Section>
  );
}
