import { formatTime } from '../../utils/media';

interface TimelineProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onRestart: () => void;
  onSeek: (timeSec: number) => void;
  disabled: boolean;
}

/** Playback controls and scrub bar shown beneath the preview canvas. */
export function Timeline({
  isPlaying,
  currentTime,
  duration,
  onPlayPause,
  onRestart,
  onSeek,
  disabled,
}: TimelineProps) {
  return (
    <div className="timeline">
      <div className="timeline__controls">
        <button type="button" className="btn" onClick={onRestart} disabled={disabled}>
          ⏮ Restart
        </button>
        <button type="button" className="btn btn--primary" onClick={onPlayPause} disabled={disabled}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <span className="timeline__time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <input
        type="range"
        className="timeline__scrub"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(currentTime, duration || 0)}
        disabled={disabled}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
    </div>
  );
}
