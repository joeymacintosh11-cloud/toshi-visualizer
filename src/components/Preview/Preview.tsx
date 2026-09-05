import { usePlaybackEngine } from './usePlaybackEngine';
import { Timeline } from '../Timeline/Timeline';
import { PreviewQualitySelector } from './PreviewQualitySelector';

/** 16:9 live canvas preview, exactly mirroring what export will produce. */
export function Preview() {
  const {
    canvasRef,
    audioElRef,
    videoElRef,
    isPlaying,
    currentTime,
    duration,
    play,
    pause,
    restart,
    seek,
    previewWidth,
    previewHeight,
  } = usePlaybackEngine();

  return (
    <div className="preview-column">
      <PreviewQualitySelector />
      <div className="preview-canvas-wrap">
        <canvas ref={canvasRef} width={previewWidth} height={previewHeight} className="preview-canvas" />
      </div>
      <Timeline
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        onPlayPause={() => (isPlaying ? pause() : play())}
        onRestart={restart}
        onSeek={seek}
        disabled={duration === 0}
      />
      {/* Hidden media elements driving playback; the canvas is the visible output. */}
      <audio ref={audioElRef} hidden />
      <video ref={videoElRef} hidden playsInline />
    </div>
  );
}
