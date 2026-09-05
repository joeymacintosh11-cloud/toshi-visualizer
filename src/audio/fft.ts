// Minimal iterative radix-2 Cooley-Tukey FFT, in place, no dependencies.
// Used for deterministic offline audio analysis (export must not depend on
// AnalyserNode timing, which is tied to realtime/offline context scheduling).

/** Performs an in-place FFT. `real`/`imag` length must be a power of two. */
export function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angleStep = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < halfLen; k++) {
        const angle = angleStep * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const evenIdx = i + k;
        const oddIdx = i + k + halfLen;
        const evenR = real[evenIdx];
        const evenI = imag[evenIdx];
        const oddR = real[oddIdx] * wr - imag[oddIdx] * wi;
        const oddI = real[oddIdx] * wi + imag[oddIdx] * wr;
        real[evenIdx] = evenR + oddR;
        imag[evenIdx] = evenI + oddI;
        real[oddIdx] = evenR - oddR;
        imag[oddIdx] = evenI - oddI;
      }
    }
  }
}

/** Applies a Hann window in place to reduce spectral leakage. */
export function applyHannWindow(samples: Float32Array): void {
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    samples[i] *= 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
}
