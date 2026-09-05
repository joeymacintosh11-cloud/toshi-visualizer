import { useEffect, useMemo, useRef, useState } from 'react';
import { useToshiStore } from '../../state/store';
import { LiveAudioAnalyzer } from '../../audio/audioAnalyzer';
import { VisualizerEngine } from '../../renderer/canvasRenderer';
import { resolveBackgroundTime } from '../../renderer/backgroundTiming';
import { PREVIEW_QUALITY_DIMENSIONS } from '../../renderer/qualityTiers';
import type { AudioFrameData } from '../../types/visualizer';

const BG_DRIFT_CORRECTION_SEC = 0.15;
// Live time display only needs to feel smooth to the eye, not hit every
// frame — updating React state at 60fps would re-render the Preview/Timeline
// tree far more often than useful.
const TIME_UI_UPDATE_INTERVAL_SEC = 0.1;

const SILENT_FRAME: AudioFrameData = { bass: 0, mid: 0, high: 0, transient: 0 };

/**
 * Owns the live preview's canvas render loop, audio playback/analysis, and
 * background video sync. Reads current settings from the store imperatively
 * on every animation frame so slider changes apply instantly with no extra
 * wiring, while React re-renders stay limited to play/pause/throttled time
 * updates — per-frame audio levels and shake/flicker state live entirely
 * inside the VisualizerEngine/effect helpers, never in React state.
 *
 * The background <video> element's source is whichever of the lightweight
 * preview proxy or the original upload is currently appropriate — export
 * always reads the original file directly and is unaffected by this choice.
 */
export function usePlaybackEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const analyzerRef = useRef<LiveAudioAnalyzer | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeUiUpdateRef = useRef(0);
  const boundVideoUrlRef = useRef<string | null>(null);
  const [engine] = useState(() => new VisualizerEngine());

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audio = useToshiStore((s) => s.audio);
  const background = useToshiStore((s) => s.background);
  const backgroundProxy = useToshiStore((s) => s.backgroundProxy);
  const backgroundProxyStatus = useToshiStore((s) => s.backgroundProxyStatus);
  const previewQuality = useToshiStore((s) => s.previewQuality);

  const previewDims = PREVIEW_QUALITY_DIMENSIONS[previewQuality];

  // Prefer the lightweight proxy for live playback; fall back to the
  // original source once a proxy is confirmed not needed, or generation
  // has failed and there's nothing else to show. Critically, while a proxy
  // is actively being generated we do NOT fall back to the (possibly huge)
  // original — that would defeat the entire point of proxying it, stuttering
  // the preview for however long the transcode takes. The canvas shows a
  // lightweight placeholder instead (see the render loop below).
  const effectiveBackgroundUrl = useMemo(() => {
    if (backgroundProxy) return backgroundProxy.url;
    if (backgroundProxyStatus === 'generating') return null;
    return background?.url ?? null;
  }, [backgroundProxy, backgroundProxyStatus, background]);

  const isBackgroundPending = Boolean(background) && backgroundProxyStatus === 'generating';

  // Bind the audio element's source and duration when the uploaded beat changes.
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    if (audio) {
      el.src = audio.url;
      setDuration(audio.durationSec);
    } else {
      el.removeAttribute('src');
      setDuration(0);
    }
    setCurrentTime(0);
    setIsPlaying(false);
  }, [audio]);

  // Bind the background video element's source to whichever of proxy/original
  // is currently effective. Only touches the element when the URL actually
  // changes (e.g. proxy finishes generating shortly after upload), so an
  // in-progress playback position isn't reset on every render.
  useEffect(() => {
    const el = videoElRef.current;
    if (!el) return;
    if (effectiveBackgroundUrl === boundVideoUrlRef.current) return;
    boundVideoUrlRef.current = effectiveBackgroundUrl;

    if (effectiveBackgroundUrl) {
      const wasPlaying = isPlaying;
      el.src = effectiveBackgroundUrl;
      if (wasPlaying) void el.play().catch(() => {});
    } else {
      el.removeAttribute('src');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBackgroundUrl]);

  // Keep the background element's mute/loop/speed in sync with settings.
  useEffect(() => {
    const unsubscribe = useToshiStore.subscribe((s) => {
      const el = videoElRef.current;
      if (!el) return;
      el.muted = s.backgroundSettings.muteOriginalAudio;
      el.playbackRate = s.backgroundSettings.playbackSpeed;
    });
    return unsubscribe;
  }, []);

  // Main render loop: runs continuously while mounted so the canvas always
  // reflects the current scrub position, even when paused.
  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const audioEl = audioElRef.current;
      const videoEl = videoElRef.current;
      if (canvas && engine) {
        try {
          const ctx = canvas.getContext('2d')!;
          const state = useToshiStore.getState();
          const timeSec = audioEl?.currentTime ?? 0;

          if (audioEl && !audioEl.paused) {
            const now = performance.now();
            if (now - lastTimeUiUpdateRef.current >= TIME_UI_UPDATE_INTERVAL_SEC * 1000) {
              lastTimeUiUpdateRef.current = now;
              setCurrentTime(timeSec);
            }
          }

          // Keep background video roughly in sync with the beat clock without
          // seeking every single frame (which would stutter decode).
          if (videoEl && effectiveBackgroundUrl && videoEl.duration) {
            const targetBgTime = resolveBackgroundTime(timeSec, state.backgroundSettings, videoEl.duration);
            const drift = Math.abs(videoEl.currentTime - targetBgTime);
            if (!isPlaying || drift > BG_DRIFT_CORRECTION_SEC) {
              videoEl.currentTime = targetBgTime;
            }
          }

          const audioFrame: AudioFrameData =
            isPlaying && analyzerRef.current
              ? analyzerRef.current.getLevels(state.effects.smoothing, state.effects.transientSensitivity)
              : SILENT_FRAME;

          const frameIndex = Math.floor(timeSec * 30);

          engine.renderFrame({
            ctx,
            width: canvas.width,
            height: canvas.height,
            backgroundSource:
              videoEl && effectiveBackgroundUrl
                ? { element: videoEl, width: videoEl.videoWidth, height: videoEl.videoHeight }
                : null,
            beatInfo: state.beatInfo,
            backgroundSettings: state.backgroundSettings,
            effects: state.effects,
            audioFrame,
            frameIndex,
            timeSec,
            logoImage: state.logoImage,
            qualityTier: previewQuality,
            backgroundPending: isBackgroundPending,
          });
        } catch (err) {
          // A single bad frame (e.g. a video seek edge case) shouldn't kill
          // the whole live preview loop.
          console.error('Preview render error:', err);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, engine, effectiveBackgroundUrl, previewQuality, isBackgroundPending]);

  async function play() {
    const audioEl = audioElRef.current;
    if (!audioEl || !audio) return;

    if (!analyzerRef.current) {
      analyzerRef.current = new LiveAudioAnalyzer(audioEl);
    }
    await analyzerRef.current.resume();

    const videoEl = videoElRef.current;
    if (videoEl && effectiveBackgroundUrl) {
      void videoEl.play().catch(() => {});
    }

    await audioEl.play();
    setIsPlaying(true);
  }

  function pause() {
    audioElRef.current?.pause();
    videoElRef.current?.pause();
    setIsPlaying(false);
  }

  function restart() {
    if (audioElRef.current) audioElRef.current.currentTime = 0;
    setCurrentTime(0);
  }

  function seek(timeSec: number) {
    if (audioElRef.current) audioElRef.current.currentTime = timeSec;
    setCurrentTime(timeSec);
  }

  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return;
    const onEnded = () => setIsPlaying(false);
    audioEl.addEventListener('ended', onEnded);
    return () => audioEl.removeEventListener('ended', onEnded);
  }, []);

  useEffect(() => {
    return () => {
      analyzerRef.current?.dispose();
    };
  }, []);

  return {
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
    previewWidth: previewDims.width,
    previewHeight: previewDims.height,
  };
}
