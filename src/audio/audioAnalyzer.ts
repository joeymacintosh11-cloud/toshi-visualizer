import type { AudioAnalysisResult, AudioFrameData } from '../types/visualizer';
import { applyHannWindow, fft } from './fft';
import { computeTransientEnvelope, TransientTracker } from './transientDetector';

export const BAND_RANGES = {
  bass: [20, 150] as const,
  mid: [150, 2000] as const,
  high: [2000, 12000] as const,
};

const FFT_SIZE = 2048;

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  try {
    const buffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    return buffer;
  } finally {
    void audioCtx.close();
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  const mono = new Float32Array(length);
  for (let c = 0; c < numberOfChannels; c++) {
    const channelData = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i] / numberOfChannels;
    }
  }
  return mono;
}

function bandEnergyFromSpectrum(
  magnitudes: Float32Array,
  sampleRate: number,
  fftSize: number,
  [lowHz, highHz]: readonly [number, number],
): number {
  const binHz = sampleRate / fftSize;
  const startBin = Math.max(1, Math.floor(lowHz / binHz));
  const endBin = Math.min(magnitudes.length - 1, Math.ceil(highHz / binHz));
  if (endBin <= startBin) return 0;
  let sum = 0;
  for (let b = startBin; b <= endBin; b++) sum += magnitudes[b];
  return sum / (endBin - startBin + 1);
}

/**
 * Analyzes an entire decoded audio buffer and returns smoothed bass/mid/high
 * energy plus a transient envelope for every output video frame. This is the
 * deterministic pre-analysis pass used before export: the same file and
 * settings always produce identical results, independent of machine speed.
 * Runs in chunks (yielding to the event loop) so the UI stays responsive
 * and progress can be reported.
 */
export async function analyzeAudioBufferDeterministic(
  audioBuffer: AudioBuffer,
  fps: number,
  smoothing: number,
  transientSensitivity: number,
  onProgress?: (done: number, total: number) => void,
): Promise<AudioAnalysisResult> {
  const sampleRate = audioBuffer.sampleRate;
  const mono = mixToMono(audioBuffer);
  const durationSec = audioBuffer.duration;
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));

  const rawBass = new Float32Array(totalFrames);
  const rawMid = new Float32Array(totalFrames);
  const rawHigh = new Float32Array(totalFrames);

  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);
  const magnitudes = new Float32Array(FFT_SIZE / 2);

  const CHUNK_SIZE = 120;

  for (let i = 0; i < totalFrames; i++) {
    const centerSample = Math.round(((i + 0.5) / fps) * sampleRate);
    const start = centerSample - FFT_SIZE / 2;

    real.fill(0);
    imag.fill(0);
    for (let s = 0; s < FFT_SIZE; s++) {
      const srcIdx = start + s;
      real[s] = srcIdx >= 0 && srcIdx < mono.length ? mono[srcIdx] : 0;
    }
    applyHannWindow(real);
    fft(real, imag);

    for (let b = 0; b < magnitudes.length; b++) {
      magnitudes[b] = Math.hypot(real[b], imag[b]);
    }

    rawBass[i] = bandEnergyFromSpectrum(magnitudes, sampleRate, FFT_SIZE, BAND_RANGES.bass);
    rawMid[i] = bandEnergyFromSpectrum(magnitudes, sampleRate, FFT_SIZE, BAND_RANGES.mid);
    rawHigh[i] = bandEnergyFromSpectrum(magnitudes, sampleRate, FFT_SIZE, BAND_RANGES.high);

    if (i % CHUNK_SIZE === 0) {
      onProgress?.(i, totalFrames);
      await new Promise(requestAnimationFrame);
    }
  }

  // Auto-normalize each band independently using a high percentile as the
  // "loud" reference, so quietly-mastered beats still produce a full 0..1
  // range of reaction instead of staying near zero.
  const normalize = (raw: Float32Array): number[] => {
    const sorted = Array.from(raw).sort((a, b) => a - b);
    const percentileIdx = Math.floor(sorted.length * 0.95);
    const reference = Math.max(sorted[percentileIdx] ?? 0, 1e-6);
    return Array.from(raw, (v) => Math.min(1, v / reference));
  };

  const normBass = normalize(rawBass);
  const normMid = normalize(rawMid);
  const normHigh = normalize(rawHigh);

  // Causal exponential smoothing to avoid jitter, matching the live preview.
  const smooth = (values: number[]): number[] => {
    const out = new Array(values.length);
    let prev = values[0] ?? 0;
    for (let i = 0; i < values.length; i++) {
      prev = prev * smoothing + values[i] * (1 - smoothing);
      out[i] = prev;
    }
    return out;
  };

  const bassSmoothed = smooth(normBass);
  const midSmoothed = smooth(normMid);
  const highSmoothed = smooth(normHigh);
  const transientEnvelope = computeTransientEnvelope(bassSmoothed, fps, transientSensitivity);

  const frames: AudioFrameData[] = bassSmoothed.map((bass, i) => ({
    bass,
    mid: midSmoothed[i],
    high: highSmoothed[i],
    transient: transientEnvelope[i],
  }));

  onProgress?.(totalFrames, totalFrames);

  return { frames, fps, durationSec, sampleRate };
}

/**
 * Realtime analyser for the live preview: taps an HTMLMediaElement's audio
 * graph with an AnalyserNode and reduces frequency bins into smoothed
 * bass/mid/high values plus a live transient envelope every animation frame.
 */
export class LiveAudioAnalyzer {
  private audioCtx: AudioContext;
  private analyser: AnalyserNode;
  private sourceNode: MediaElementAudioSourceNode;
  private dataArray: Uint8Array<ArrayBuffer>;
  private tracker = new TransientTracker();

  private smoothedBass = 0;
  private smoothedMid = 0;
  private smoothedHigh = 0;
  private lastUpdateTime = performance.now();

  constructor(mediaElement: HTMLAudioElement) {
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0; // we apply our own smoothing
    this.sourceNode = this.audioCtx.createMediaElementSource(mediaElement);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /** Resumes the underlying AudioContext; call from a user gesture (e.g. Play). */
  async resume(): Promise<void> {
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  private bandLevel([lowHz, highHz]: readonly [number, number]): number {
    const binHz = this.audioCtx.sampleRate / this.analyser.fftSize;
    const startBin = Math.max(1, Math.floor(lowHz / binHz));
    const endBin = Math.min(this.dataArray.length - 1, Math.ceil(highHz / binHz));
    if (endBin <= startBin) return 0;
    let sum = 0;
    for (let b = startBin; b <= endBin; b++) sum += this.dataArray[b];
    return sum / (endBin - startBin + 1) / 255;
  }

  /** Call once per animation frame. Returns smoothed bass/mid/high + transient. */
  getLevels(smoothing: number, transientSensitivity: number): AudioFrameData {
    this.analyser.getByteFrequencyData(this.dataArray);

    const now = performance.now();
    const dtSec = Math.max(0.001, (now - this.lastUpdateTime) / 1000);
    this.lastUpdateTime = now;

    const rawBass = this.bandLevel(BAND_RANGES.bass);
    const rawMid = this.bandLevel(BAND_RANGES.mid);
    const rawHigh = this.bandLevel(BAND_RANGES.high);

    this.smoothedBass = this.smoothedBass * smoothing + rawBass * (1 - smoothing);
    this.smoothedMid = this.smoothedMid * smoothing + rawMid * (1 - smoothing);
    this.smoothedHigh = this.smoothedHigh * smoothing + rawHigh * (1 - smoothing);

    const transient = this.tracker.update(this.smoothedBass, dtSec, transientSensitivity);

    return { bass: this.smoothedBass, mid: this.smoothedMid, high: this.smoothedHigh, transient };
  }

  reset(): void {
    this.smoothedBass = 0;
    this.smoothedMid = 0;
    this.smoothedHigh = 0;
    this.tracker.reset();
  }

  dispose(): void {
    this.sourceNode.disconnect();
    this.analyser.disconnect();
    void this.audioCtx.close();
  }
}
