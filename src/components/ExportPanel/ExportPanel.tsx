import { useRef, useState } from 'react';
import { useToshiStore } from '../../state/store';
import type {
  ExportFramerate,
  ExportProgress,
  ExportQuality,
  ExportResolution,
} from '../../types/visualizer';
import { decodeAudioFile } from '../../audio/audioAnalyzer';
import { cleanupExportRender, ExportError, exportVisualizerVideo } from '../../export/videoExporter';
import { Section } from '../ControlPanel/Section';

const RESOLUTIONS: ExportResolution[] = ['1920x1080', '2560x1440', '3840x2160'];
const FRAMERATES: ExportFramerate[] = [24, 25, 30, 60];
const QUALITIES: ExportQuality[] = ['draft', 'high', 'maximum'];

/** Resolution/framerate/quality selectors, export trigger, and progress readout. */
export function ExportPanel() {
  const audio = useToshiStore((s) => s.audio);
  const background = useToshiStore((s) => s.background);
  const beatInfo = useToshiStore((s) => s.beatInfo);
  const backgroundSettings = useToshiStore((s) => s.backgroundSettings);
  const effects = useToshiStore((s) => s.effects);
  const exportSettings = useToshiStore((s) => s.exportSettings);
  const setExportSettings = useToshiStore((s) => s.setExportSettings);
  const logoImage = useToshiStore((s) => s.logoImage);

  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  async function handleExport() {
    if (!audio) {
      setError('Upload a beat before exporting.');
      return;
    }
    setError(null);
    setIsExporting(true);
    setProgress({ stage: 'analyzing-audio', currentFrame: 0, totalFrames: 0, message: 'Starting…' });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const audioBuffer = await decodeAudioFile(audio.file);
      const result = await exportVisualizerVideo({
        beatInfo,
        audio,
        audioBuffer,
        background,
        backgroundSettings,
        effects,
        exportSettings,
        logoImage,
        onProgress: setProgress,
        signal: controller.signal,
      });

      const a = document.createElement('a');
      a.href = result.downloadUrl;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser's download manager a moment to start reading the
      // file before the backend deletes the render's temp directory.
      setTimeout(() => cleanupExportRender(result.downloadUrl), 15_000);
    } catch (err) {
      if (err instanceof ExportError && err.reason === 'export cancelled') {
        setProgress(null);
      } else {
        console.error(err);
        setError(err instanceof ExportError ? `Export failed: ${err.message}` : 'Export failed.');
        setProgress(null);
      }
    } finally {
      setIsExporting(false);
      abortControllerRef.current = null;
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  const progressPct =
    progress && progress.totalFrames > 0 ? Math.round((progress.currentFrame / progress.totalFrames) * 100) : 0;

  return (
    <Section title="Export">
      <label className="text-field">
        <span className="text-field__label">Resolution</span>
        <select
          value={exportSettings.resolution}
          onChange={(e) => setExportSettings({ resolution: e.target.value as ExportResolution })}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="text-field">
        <span className="text-field__label">Framerate</span>
        <select
          value={exportSettings.framerate}
          onChange={(e) => setExportSettings({ framerate: Number(e.target.value) as ExportFramerate })}
        >
          {FRAMERATES.map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
      </label>

      <label className="text-field">
        <span className="text-field__label">Quality</span>
        <select
          value={exportSettings.quality}
          onChange={(e) => setExportSettings({ quality: e.target.value as ExportQuality })}
        >
          {QUALITIES.map((q) => (
            <option key={q} value={q}>
              {q[0].toUpperCase() + q.slice(1)}
            </option>
          ))}
        </select>
      </label>

      <div className="export-actions">
        <button type="button" className="btn btn--primary" disabled={isExporting} onClick={handleExport}>
          {isExporting ? 'Exporting…' : 'Export MP4'}
        </button>
        {isExporting && (
          <button type="button" className="btn" onClick={handleCancel}>
            Cancel export
          </button>
        )}
      </div>

      {error && <p className="field-error">{error}</p>}

      {progress && (
        <div className="export-progress">
          <div className="export-progress__bar">
            <div className="export-progress__fill" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="export-progress__label">{progress.message}</p>
        </div>
      )}
    </Section>
  );
}
