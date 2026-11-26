/**
 * WebTown's sounds, made in code (decision A2 in .kiro/specs/audio/design.md): filtered noise and soft tones with
 * gentle envelopes, from a seeded generator, so every sound is original work, nothing is downloaded, and each one
 * is quiet by construction (peaks well below full scale, soft attacks, fade-in and fade-out so nothing clicks).
 * Pure: plain Float32Array samples at a given sample rate; the engine turns them into AudioBuffers.
 */

export type Surface = 'grass' | 'path' | 'wood'

/** Small fast seeded generator (mulberry32), so a sound is the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TAU = Math.PI * 2

/** A biquad filter (RBJ cookbook) run over a buffer in place. */
function biquad(data: Float32Array, sr: number, type: 'lowpass' | 'highpass' | 'bandpass', freq: number | ((i: number) => number), q = 0.707): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  let lastF = -1
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0
  for (let i = 0; i < data.length; i++) {
    const f = Math.min(typeof freq === 'number' ? freq : freq(i), sr * 0.45)
    if (f !== lastF) {
      lastF = f
      const w = (TAU * f) / sr
      const cos = Math.cos(w)
      const alpha = Math.sin(w) / (2 * q)
      const a0 = 1 + alpha
      if (type === 'lowpass') {
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2
      } else if (type === 'highpass') {
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2
      } else {
        b0 = alpha; b1 = 0; b2 = -alpha
      }
      a1 = -2 * cos; a2 = 1 - alpha
      b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0
    }
    const x = data[i]!
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    data[i] = y
  }
}

/** Attack (linear) then exponential decay with time constant `tau`, in seconds. */
const env = (t: number, attack: number, tau: number): number => (t < attack ? t / attack : Math.exp(-(t - attack) / tau))

function noise(n: number, rng: () => number): Float32Array {
  const d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = rng() * 2 - 1
  return d
}

/** Scales to `peak`, and fades the first and last few milliseconds so nothing clicks. */
function finish(d: Float32Array, sr: number, peak: number, fadeMs = 3): Float32Array {
  let max = 0
  for (let i = 0; i < d.length; i++) {
    const v = Math.abs(d[i]!)
    if (Number.isFinite(v) && v > max) max = v
  }
  const k = max > 0 ? peak / max : 0
  const fade = Math.max(1, Math.round((sr * fadeMs) / 1000))
  for (let i = 0; i < d.length; i++) {
    let v = Number.isFinite(d[i]!) ? d[i]! * k : 0
    if (i < fade) v *= i / fade
    if (i >= d.length - fade) v *= (d.length - 1 - i) / fade
    d[i] = v
  }
  return d
}

const mix = (into: Float32Array, from: Float32Array, at = 0, gain = 1): void => {
  for (let i = 0; i < from.length && at + i < into.length; i++) into[at + i]! += from[i]! * gain
}

// ── Footsteps ──────────────────────────────────────────────────────────────────────────────────────────────

/** One footstep on a surface; `variant` (0..3) changes it slightly so steps never sound identical. */
export function footstep(surface: Surface, variant: number, sr: number): Float32Array {
  const rng = seeded(1000 + variant * 31 + (surface === 'grass' ? 0 : surface === 'path' ? 7 : 13))
  const jitter = 0.92 + rng() * 0.16
  if (surface === 'grass') {
    // A soft rustle: two quick brushes of bright noise (heel, then toe).
    const n = Math.round(sr * 0.13)
    const out = new Float32Array(n)
    for (const [at, gain] of [[0, 1], [0.022, 0.6]] as const) {
      const len = Math.round(sr * 0.08)
      const d = noise(len, rng)
      biquad(d, sr, 'bandpass', 2600 * jitter, 0.7)
      biquad(d, sr, 'highpass', 900)
      for (let i = 0; i < len; i++) d[i]! *= env(i / sr, 0.006, 0.022)
      mix(out, d, Math.round(sr * at), gain)
    }
    return finish(out, sr, 0.22)
  }
  if (surface === 'path') {
    // Packed road: a dull tap with a little grit.
    const n = Math.round(sr * 0.1)
    const out = noise(n, rng)
    biquad(out, sr, 'bandpass', 950 * jitter, 1.1)
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] = out[i]! * env(t, 0.003, 0.018) + 0.55 * Math.sin(TAU * 105 * jitter * t) * env(t, 0.002, 0.022)
    }
    biquad(out, sr, 'lowpass', 3200)
    return finish(out, sr, 0.24)
  }
  // Wooden floor: a soft, hollow knock.
  const n = Math.round(sr * 0.14)
  const out = noise(n, rng)
  biquad(out, sr, 'lowpass', 1400)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const body = Math.sin(TAU * 150 * jitter * t) * 0.8 + Math.sin(TAU * 235 * jitter * t) * 0.35
    out[i] = out[i]! * 0.35 * env(t, 0.002, 0.012) + body * env(t, 0.003, 0.045)
  }
  return finish(out, sr, 0.22)
}

// ── Doors ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A gentle wooden door opening: a soft latch, then a short, low creak. */
export function doorOpen(sr: number): Float32Array {
  const rng = seeded(2001)
  const n = Math.round(sr * 0.8)
  const out = new Float32Array(n)
  // Latch.
  const latch = noise(Math.round(sr * 0.03), rng)
  biquad(latch, sr, 'bandpass', 2200, 2)
  for (let i = 0; i < latch.length; i++) latch[i]! *= env(i / sr, 0.001, 0.006)
  mix(out, latch, 0, 0.5)
  // Creak: friction pulses whose rate rises, through a wooden resonance.
  const start = Math.round(sr * 0.06)
  const len = n - start
  const creak = new Float32Array(len)
  let phase = 0
  for (let i = 0; i < len; i++) {
    const t = i / sr
    const rate = 22 + 26 * (t / (len / sr)) + 4 * Math.sin(TAU * 1.7 * t)
    phase += rate / sr
    const pulse = phase % 1 < 0.08 ? 1 - (phase % 1) / 0.08 : 0
    const swell = Math.sin(Math.PI * Math.min(1, t / (len / sr))) ** 1.5
    creak[i] = (pulse + (rng() * 2 - 1) * 0.08) * swell
  }
  biquad(creak, sr, 'bandpass', 620, 3)
  biquad(creak, sr, 'lowpass', 1800)
  mix(out, creak, start, 1)
  return finish(out, sr, 0.26, 8)
}

/** A soft door closing: a padded thud and the latch. */
export function doorClose(sr: number): Float32Array {
  const rng = seeded(2002)
  const n = Math.round(sr * 0.42)
  const out = noise(n, rng)
  biquad(out, sr, 'lowpass', 380)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const f = 62 + 30 * Math.exp(-t / 0.05)
    out[i] = out[i]! * 0.6 * env(t, 0.004, 0.05) + Math.sin(TAU * f * t) * env(t, 0.004, 0.09)
  }
  const latch = noise(Math.round(sr * 0.025), rng)
  biquad(latch, sr, 'bandpass', 2600, 2.5)
  for (let i = 0; i < latch.length; i++) latch[i]! *= env(i / sr, 0.001, 0.005)
  mix(out, latch, Math.round(sr * 0.05), 0.35)
  return finish(out, sr, 0.28, 6)
}

// ── Computer ───────────────────────────────────────────────────────────────────────────────────────────────

/** A soft tone with a little third harmonic, like an old machine's speaker, but rounded. */
const softTone = (t: number, f: number): number => Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * 3 * f * t)

/** A gentle retro start-up: a faint fan coming up and a two-note chime. */
export function computerOn(sr: number): Float32Array {
  const rng = seeded(3001)
  const n = Math.round(sr * 1.0)
  const fan = noise(n, rng)
  biquad(fan, sr, 'lowpass', 500)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const fanEnv = Math.min(1, t / 0.4) * Math.exp(-Math.max(0, t - 0.5) / 0.25)
    const n1 = t >= 0.12 ? softTone(t - 0.12, 523.25) * env(t - 0.12, 0.012, 0.16) : 0
    const n2 = t >= 0.26 ? softTone(t - 0.26, 783.99) * env(t - 0.26, 0.015, 0.28) : 0
    out[i] = fan[i]! * 0.25 * fanEnv + 0.55 * n1 + 0.5 * n2
  }
  biquad(out, sr, 'lowpass', 4000)
  return finish(out, sr, 0.18, 10)
}

/** Switching off: a short tone sliding down, and the fan winding down. */
export function computerOff(sr: number): Float32Array {
  const rng = seeded(3002)
  const n = Math.round(sr * 0.55)
  const fan = noise(n, rng)
  biquad(fan, sr, 'lowpass', 420)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const f = 620 * Math.exp(-t / 0.18) + 180
    phase += f / sr
    const tone = Math.sin(TAU * phase) + 0.15 * Math.sin(TAU * 3 * phase)
    out[i] = tone * env(t, 0.01, 0.12) * 0.6 + fan[i]! * 0.2 * Math.exp(-t / 0.2)
  }
  biquad(out, sr, 'lowpass', 3000)
  return finish(out, sr, 0.16, 8)
}

/** One soft key press: a small muted click. `variant` 0..3. */
export function keyClick(variant: number, sr: number): Float32Array {
  const rng = seeded(3100 + variant)
  const n = Math.round(sr * 0.035)
  const out = noise(n, rng)
  biquad(out, sr, 'bandpass', 2400 + variant * 180, 1.4)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    out[i] = out[i]! * env(t, 0.0008, 0.005) + 0.3 * Math.sin(TAU * (1500 + variant * 90) * t) * env(t, 0.0005, 0.003)
  }
  biquad(out, sr, 'lowpass', 6000)
  return finish(out, sr, 0.12, 1)
}

// ── Sketchbook ─────────────────────────────────────────────────────────────────────────────────────────────

/** A paper page turning: a rustle that brightens as it goes, with a slight flutter. */
export function pageTurn(sr: number): Float32Array {
  const rng = seeded(4001)
  const n = Math.round(sr * 0.48)
  const out = noise(n, rng)
  biquad(out, sr, 'bandpass', i => 1100 + 3200 * (i / n), 0.9)
  let flutter = 1
  for (let i = 0; i < n; i++) {
    const t = i / sr
    if (i % Math.round(sr * 0.012) === 0) flutter = 0.6 + rng() * 0.4
    const shape = Math.sin(Math.PI * Math.min(1, t / 0.46)) ** 0.8
    out[i] = out[i]! * shape * flutter
  }
  biquad(out, sr, 'highpass', 500)
  return finish(out, sr, 0.17, 10)
}

/** A short stroke of a soft pencil on paper: fine grain, no edges. `variant` 0..2. */
export function pencil(variant: number, sr: number): Float32Array {
  const rng = seeded(4100 + variant)
  const n = Math.round(sr * 0.17)
  const out = noise(n, rng)
  biquad(out, sr, 'bandpass', 3600 + variant * 300, 1.6)
  let grain = 1
  for (let i = 0; i < n; i++) {
    const t = i / sr
    if (i % Math.round(sr * 0.004) === 0) grain = 0.5 + rng() * 0.5
    out[i] = out[i]! * grain * Math.sin(Math.PI * (t / 0.17))
  }
  return finish(out, sr, 0.07, 12)
}

/** Closing a book: a soft papery thump. */
export function bookClose(sr: number): Float32Array {
  const rng = seeded(4002)
  const n = Math.round(sr * 0.3)
  const out = noise(n, rng)
  biquad(out, sr, 'lowpass', 900)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    out[i] = out[i]! * 0.7 * env(t, 0.003, 0.03) + Math.sin(TAU * (118 + 20 * Math.exp(-t / 0.03)) * t) * env(t, 0.003, 0.06)
  }
  return finish(out, sr, 0.24, 5)
}

// ── Ambience ───────────────────────────────────────────────────────────────────────────────────────────────

/** Makes a loop seamless by crossfading its tail into its head (the result is `seconds` long). */
function seamless(d: Float32Array, sr: number, seconds: number, xfade: number): Float32Array {
  const n = Math.round(sr * seconds)
  const x = Math.round(sr * xfade)
  const out = d.slice(0, n)
  for (let i = 0; i < x; i++) {
    const k = i / x
    out[i] = out[i]! * k + d[n + i]! * (1 - k)
  }
  return out
}

/** Soft wind through the town, 8 s, loops without a seam. */
export function windLoop(sr: number): Float32Array {
  const rng = seeded(5001)
  const seconds = 8
  const total = Math.round(sr * (seconds + 1))
  const d = new Float32Array(total)
  // Brown noise: integrated white noise, kept from drifting.
  let v = 0
  for (let i = 0; i < total; i++) {
    v = (v + (rng() * 2 - 1) * 0.02) * 0.998
    d[i] = v
  }
  biquad(d, sr, 'lowpass', 420)
  biquad(d, sr, 'highpass', 60)
  for (let i = 0; i < total; i++) {
    const t = i / sr
    // Slow gusts: whole cycles over the loop, so the loop point does not jump.
    d[i]! *= 0.65 + 0.25 * Math.sin((TAU * t) / seconds) + 0.1 * Math.sin((TAU * 3 * t) / seconds + 1.3)
  }
  return finish(seamless(d, sr, seconds, 1), sr, 0.5, 0)
}

/** Crickets at night, 6 s, loops without a seam (every chirp ends before the loop point). */
export function cricketLoop(sr: number): Float32Array {
  const rng = seeded(5002)
  const seconds = 6
  const n = Math.round(sr * seconds)
  const out = new Float32Array(n)
  for (const cricket of [{ f: 4650, every: 0.62, pan: 1 }, { f: 4320, every: 0.83, pan: 0.6 }]) {
    let t = rng() * 0.3
    while (t < seconds - 0.2) {
      if (rng() > 0.18) {
        // A chirp: three quick pulses.
        for (let p = 0; p < 3; p++) {
          const start = Math.round(sr * (t + p * 0.032))
          const len = Math.round(sr * 0.02)
          for (let i = 0; i < len && start + i < n; i++) {
            const s = i / sr
            out[start + i]! += cricket.pan * Math.sin(TAU * cricket.f * s) * Math.sin(Math.PI * (i / len))
          }
        }
      }
      t += cricket.every * (0.85 + rng() * 0.3)
    }
  }
  biquad(out, sr, 'lowpass', 6500)
  return finish(out, sr, 0.3, 0)
}

/** A small bird, far off: two to four quick rising whistles. `variant` 0..2. */
export function birdChirp(variant: number, sr: number): Float32Array {
  const rng = seeded(5100 + variant)
  const n = Math.round(sr * 0.5)
  const out = new Float32Array(n)
  const notes = 2 + Math.floor(rng() * 3)
  for (let k = 0; k < notes; k++) {
    const start = Math.round(sr * (k * (0.09 + rng() * 0.04)))
    const len = Math.round(sr * (0.05 + rng() * 0.03))
    const f0 = 2600 + rng() * 600 + variant * 150
    const f1 = f0 + 900 + rng() * 500
    let phase = 0
    for (let i = 0; i < len && start + i < n; i++) {
      const s = i / len
      phase += (f0 + (f1 - f0) * s) / sr
      out[start + i]! += Math.sin(TAU * phase) * Math.sin(Math.PI * s) ** 2
    }
  }
  biquad(out, sr, 'lowpass', 5200)
  return finish(out, sr, 0.22, 4)
}
