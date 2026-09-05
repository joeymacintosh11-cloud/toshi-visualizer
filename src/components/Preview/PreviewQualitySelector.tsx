import { useToshiStore } from '../../state/store';
import { PREVIEW_QUALITY_DIMENSIONS, type PreviewQuality } from '../../renderer/qualityTiers';

const OPTIONS: PreviewQuality[] = ['low', 'medium', 'high'];

/**
 * Preview-only performance control — internal canvas render resolution and
 * effect fidelity. Never affects export, which always renders at the
 * resolution/quality chosen in the Export panel.
 */
export function PreviewQualitySelector() {
  const previewQuality = useToshiStore((s) => s.previewQuality);
  const setPreviewQuality = useToshiStore((s) => s.setPreviewQuality);

  return (
    <div className="preview-quality">
      <span className="preview-quality__label">Preview Quality</span>
      <div className="preview-quality__options">
        {OPTIONS.map((option) => {
          const dims = PREVIEW_QUALITY_DIMENSIONS[option];
          return (
            <button
              key={option}
              type="button"
              className={`preview-quality__btn${option === previewQuality ? ' preview-quality__btn--active' : ''}`}
              onClick={() => setPreviewQuality(option)}
              title={`${dims.width} × ${dims.height}`}
            >
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
