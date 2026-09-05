interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  /** Formats the value shown next to the label, e.g. as a percentage. */
  formatValue?: (value: number) => string;
}

const defaultFormat = (v: number) => v.toFixed(2);

/** Labeled range input with a live value readout — the base control for all sliders. */
export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  disabled = false,
  onChange,
  formatValue = defaultFormat,
}: SliderProps) {
  return (
    <label className={`slider-row${disabled ? ' slider-row--disabled' : ''}`}>
      <span className="slider-row__label">
        <span>{label}</span>
        <span className="slider-row__value">{formatValue(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
