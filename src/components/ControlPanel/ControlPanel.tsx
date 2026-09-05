import { UploadSection } from './UploadSection';
import { BeatInfoSection } from './BeatInfoSection';
import { BackgroundSection } from './BackgroundSection';
import { AudioResponseSection } from './AudioResponseSection';
import { MotionSection } from './MotionSection';
import { TextureSection } from './TextureSection';
import { PresetPanel } from '../PresetPanel/PresetPanel';
import { ExportPanel } from '../ExportPanel/ExportPanel';

/** Left column: every control grouped into collapsible sections. */
export function ControlPanel() {
  return (
    <div className="control-panel">
      <div className="control-panel__brand">
        <span className="control-panel__brand-name">TOSHI</span>
        <span className="control-panel__brand-sub">Visualizer Generator</span>
      </div>
      <UploadSection />
      <BeatInfoSection />
      <BackgroundSection />
      <PresetPanel />
      <AudioResponseSection />
      <MotionSection />
      <TextureSection />
      <ExportPanel />
    </div>
  );
}
