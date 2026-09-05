import { useEffect, useRef, useState } from 'react';
import { useToshiStore } from '../../state/store';
import { getAudioDuration, getVideoMeta, formatTime } from '../../utils/media';
import {
  checkExistingProxy,
  checkFFmpegAvailability,
  decideBackgroundProxy,
  generateBackgroundProxy,
  ProxyGenerationError,
  type BackgroundProxyResult,
} from '../../video/backgroundProxy';
import { Section } from './Section';
import { Toggle } from './Toggle';

/** Beat and background video upload controls, with filename/duration readouts. */
export function UploadSection() {
  const audio = useToshiStore((s) => s.audio);
  const background = useToshiStore((s) => s.background);
  const backgroundSettings = useToshiStore((s) => s.backgroundSettings);
  const backgroundProxy = useToshiStore((s) => s.backgroundProxy);
  const backgroundProxyStatus = useToshiStore((s) => s.backgroundProxyStatus);
  const backgroundProxyError = useToshiStore((s) => s.backgroundProxyError);
  const setAudio = useToshiStore((s) => s.setAudio);
  const setBackground = useToshiStore((s) => s.setBackground);
  const setBackgroundOriginalMeta = useToshiStore((s) => s.setBackgroundOriginalMeta);
  const setBackgroundSettings = useToshiStore((s) => s.setBackgroundSettings);
  const setBackgroundProxy = useToshiStore((s) => s.setBackgroundProxy);
  const setBackgroundProxyStatus = useToshiStore((s) => s.setBackgroundProxyStatus);
  const setBackgroundProxyError = useToshiStore((s) => s.setBackgroundProxyError);

  const [audioError, setAudioError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [ffmpegSetupMessage, setFfmpegSetupMessage] = useState<string | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // Guards against a proxy generation for a since-replaced upload finishing
  // late and overwriting the state for whatever was uploaded after it.
  const proxyRequestIdRef = useRef(0);

  // Proactively surface a setup message if native ffmpeg isn't installed,
  // rather than waiting for the first upload to fail.
  useEffect(() => {
    let cancelled = false;
    void checkFFmpegAvailability().then((status) => {
      if (!cancelled && !status.available) setFfmpegSetupMessage(status.setupMessage);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAudioSelect(file: File | undefined) {
    setAudioError(null);
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const durationSec = await getAudioDuration(url);
      setAudio({ file, url, durationSec });
    } catch {
      setAudioError('Could not read this audio file. Try a different WAV or MP3.');
      URL.revokeObjectURL(url);
    }
  }

  function applyProxyResult(result: BackgroundProxyResult) {
    setBackgroundProxy({ url: result.url, width: result.width, height: result.height, durationSec: result.durationSec, fps: result.fps });
    if (result.originalMeta) {
      setBackgroundOriginalMeta({ codec: result.originalMeta.codec, fps: result.originalMeta.fps });
    }
    setBackgroundProxyStatus('ready');
  }

  /** Runs (or re-runs) proxy generation for a given file, guarded against stale/superseded requests. */
  async function runProxyGeneration(file: File) {
    const requestId = ++proxyRequestIdRef.current;
    setBackgroundProxyError(null);
    setBackgroundProxyStatus('generating');
    try {
      // Skip the upload entirely if this exact source was already proxied.
      const existing = await checkExistingProxy(file);
      if (proxyRequestIdRef.current !== requestId) return;
      if (existing) {
        applyProxyResult(existing);
        return;
      }

      const proxy = await generateBackgroundProxy(file);
      if (proxyRequestIdRef.current !== requestId) return;
      applyProxyResult(proxy);
    } catch (err) {
      if (proxyRequestIdRef.current !== requestId) return;
      const reason = err instanceof ProxyGenerationError ? err.reason : 'unexpected error';
      if (err instanceof ProxyGenerationError && err.reason === 'ffmpeg-not-installed') {
        setFfmpegSetupMessage(err.detail);
      }
      console.error('Background proxy generation failed:', err);
      setBackgroundProxyStatus('error');
      setBackgroundProxyError(reason);
    }
  }

  async function handleBackgroundSelect(file: File | undefined) {
    setVideoError(null);
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const meta = await getVideoMeta(url);
      // setBackground also clears any previous proxy and revokes its Blob URL.
      setBackground({ file, url, durationSec: meta.duration, width: meta.width, height: meta.height });

      const decision = decideBackgroundProxy({
        width: meta.width,
        height: meta.height,
        durationSec: meta.duration,
        fileSizeBytes: file.size,
      });

      if (!decision.needed) {
        setBackgroundProxyStatus('not-needed');
        return;
      }

      await runProxyGeneration(file);
    } catch {
      setVideoError('Could not read this video file. Try a different MP4 or MOV.');
      URL.revokeObjectURL(url);
    }
  }

  function handleRetryOptimization() {
    if (!background) return;
    void runProxyGeneration(background.file);
  }

  return (
    <Section title="Audio & Background">
      {ffmpegSetupMessage && (
        <p className="field-error proxy-status__line--error" style={{ marginBottom: '0.5rem' }}>
          {ffmpegSetupMessage}
        </p>
      )}

      <div className="upload-field">
        <div className="upload-field__row">
          <button type="button" className="btn" onClick={() => audioInputRef.current?.click()}>
            Upload Beat
          </button>
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/wav,audio/mpeg,.wav,.mp3"
            hidden
            onChange={(e) => handleAudioSelect(e.target.files?.[0])}
          />
          {audio && (
            <span className="upload-field__meta">
              {audio.file.name} · {formatTime(audio.durationSec)}
            </span>
          )}
        </div>
        {audioError && <p className="field-error">{audioError}</p>}
      </div>

      <div className="upload-field">
        <div className="upload-field__row">
          <button type="button" className="btn" onClick={() => videoInputRef.current?.click()}>
            Upload Background
          </button>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            hidden
            onChange={(e) => handleBackgroundSelect(e.target.files?.[0])}
          />
          {background && (
            <span className="upload-field__meta">
              {background.file.name} · {formatTime(background.durationSec)}
            </span>
          )}
        </div>
        {videoError && <p className="field-error">{videoError}</p>}

        {background && (
          <div className="proxy-status">
            <p className="proxy-status__line">Original:</p>
            <p className="proxy-status__line proxy-status__line--ready">
              <span className="proxy-status__value">{background.width} × {background.height}</span>
              {background.codec && <> · {background.codec.toUpperCase()}</>}
              {background.fps ? <> · {Math.round(background.fps)} fps</> : null}
            </p>

            {backgroundProxyStatus === 'generating' && (
              <p className="proxy-status__line proxy-status__line--pending">Preparing preview…</p>
            )}

            {backgroundProxyStatus === 'ready' && backgroundProxy && (
              <>
                <p className="proxy-status__line" style={{ marginTop: '0.3rem' }}>Preview:</p>
                <p className="proxy-status__line proxy-status__line--ready">
                  <span className="proxy-status__value">{backgroundProxy.width} × {backgroundProxy.height}</span> · H.264 ·{' '}
                  {Math.round(backgroundProxy.fps)} fps
                </p>
                <p className="proxy-status__line proxy-status__line--pending">Preview optimized</p>
              </>
            )}

            {backgroundProxyStatus === 'not-needed' && (
              <p className="proxy-status__line">Preview: Original source</p>
            )}

            {backgroundProxyStatus === 'error' && (
              <>
                <p className="proxy-status__line proxy-status__line--error">
                  Preview optimization failed: {backgroundProxyError ?? 'unknown error'}
                </p>
                <p className="proxy-status__line">Preview: Original source (see console for full details)</p>
                <button type="button" className="btn-icon proxy-status__retry" onClick={handleRetryOptimization}>
                  Retry optimization
                </button>
              </>
            )}
          </div>
        )}

        <Toggle
          label="Loop background if shorter than beat"
          checked={backgroundSettings.loop}
          onChange={(loop) => setBackgroundSettings({ loop })}
        />
        <Toggle
          label="Mute original background audio"
          checked={backgroundSettings.muteOriginalAudio}
          onChange={(muteOriginalAudio) => setBackgroundSettings({ muteOriginalAudio })}
        />
      </div>
    </Section>
  );
}
