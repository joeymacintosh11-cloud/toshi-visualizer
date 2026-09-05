import type { BackgroundSettings } from '../types/visualizer';

/**
 * Resolves the background clip's playback time for a given beat playback
 * time, honoring loop/start-offset/speed. Shared by the live preview and
 * the export pipeline so both resolve background timing identically.
 */
export function resolveBackgroundTime(
  beatTimeSec: number,
  settings: Pick<BackgroundSettings, 'playbackSpeed' | 'startOffsetSec' | 'loop'>,
  bgDurationSec: number,
): number {
  const raw = beatTimeSec * settings.playbackSpeed + settings.startOffsetSec;
  if (bgDurationSec <= 0) return 0;
  if (settings.loop) return raw % bgDurationSec;
  return Math.min(raw, Math.max(0, bgDurationSec - 0.05));
}
