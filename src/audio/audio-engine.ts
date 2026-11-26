import {
  birdChirp, bookClose, computerOff, computerOn, cricketLoop, doorClose, doorOpen, footstep, keyClick, pageTurn,
  pencil, windLoop,
} from './synth'

/**
 * WebTown's one audio system (decision A1 in .kiro/specs/audio/design.md): a Web Audio graph with a master gain and
 * two buses (ambience, effects), short synthesised effects and two ambient loops. Phaser's own sound manager is
 * switched off, so this is the only AudioContext.
 *
 *   effect sources -> effects gain --\
 *   wind, crickets, birds -> ambience gain -> indoor low-pass --> master gain -> speakers
 *
 * Nothing is audible until a real user gesture (`unlock`), nothing is scheduled while muted or hidden, and volume
 * changes only move gains. Every sound is local: none is ever sent to other players.
 */

export type SoundName =
  | 'step-grass' | 'step-path' | 'step-wood'
  | 'door-open' | 'door-close'
  | 'computer-on' | 'computer-off' | 'key'
  | 'page-turn' | 'pencil' | 'book-close'

export interface AudioSettings {
  /** 0..1 each. */
  master: number
  ambient: number
  effects: number
  muted: boolean
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = { master: 0.6, ambient: 0.35, effects: 0.5, muted: false }

export interface Ambience {
  /** 0 in daylight, 1 at night (the sky's `night`). */
  night: number
}

// ── The parts of the Web Audio API used (tests pass a fake) ─────────────────────────────────────────────────

export interface ParamLike {
  value: number
  setTargetAtTime(target: number, start: number, timeConstant: number): unknown
  setValueAtTime(value: number, time: number): unknown
  cancelScheduledValues(time: number): unknown
}
export interface NodeLike {
  connect(to: NodeLike): unknown
  disconnect(): unknown
}
export interface GainLike extends NodeLike { gain: ParamLike }
export interface FilterLike extends NodeLike { type: string; frequency: ParamLike; Q: ParamLike }
export interface BufferLike { readonly duration: number; getChannelData(channel: number): Float32Array }
export interface SourceLike extends NodeLike {
  buffer: BufferLike | null
  loop: boolean
  playbackRate: ParamLike
  onended: (() => void) | null
  start(when?: number): unknown
  stop(when?: number): unknown
}
export interface AnalyserLike extends NodeLike { fftSize: number; getFloatTimeDomainData(out: Float32Array): void }
export interface ContextLike {
  readonly currentTime: number
  readonly sampleRate: number
  readonly state: string
  readonly destination: NodeLike
  createGain(): GainLike
  createBiquadFilter(): FilterLike
  createBufferSource(): SourceLike
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike
  createAnalyser?(): AnalyserLike
  resume(): Promise<unknown>
  suspend(): Promise<unknown>
}

export interface AudioEngineOptions {
  createContext: () => ContextLike | null
  now?: () => number
  random?: () => number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

// ── Limits (decision A9) ─────────────────────────────────────────────────────────────────────────────────────

interface Spec {
  /** Variants are picked in turn (never the same twice in a row). */
  make: Array<(sr: number) => Float32Array>
  /** Minimum time between two plays of this sound, ms. */
  gap: number
  /** At most this many playing at once. */
  max: number
  volume: number
}

const variants = <T>(n: number, f: (v: number) => T): T[] => Array.from({ length: n }, (_, v) => f(v))

const SPECS: Record<SoundName, Spec> = {
  'step-grass': { make: variants(4, v => (sr: number) => footstep('grass', v, sr)), gap: 150, max: 2, volume: 0.8 },
  'step-path': { make: variants(4, v => (sr: number) => footstep('path', v, sr)), gap: 150, max: 2, volume: 0.8 },
  'step-wood': { make: variants(4, v => (sr: number) => footstep('wood', v, sr)), gap: 150, max: 2, volume: 0.75 },
  'door-open': { make: [doorOpen], gap: 400, max: 1, volume: 0.9 },
  'door-close': { make: [doorClose], gap: 400, max: 1, volume: 0.9 },
  'computer-on': { make: [computerOn], gap: 500, max: 1, volume: 0.8 },
  'computer-off': { make: [computerOff], gap: 500, max: 1, volume: 0.8 },
  'key': { make: variants(4, v => (sr: number) => keyClick(v, sr)), gap: 35, max: 2, volume: 0.55 },
  'page-turn': { make: [pageTurn], gap: 300, max: 1, volume: 0.85 },
  'pencil': { make: variants(3, v => (sr: number) => pencil(v, sr)), gap: 90, max: 2, volume: 0.7 },
  'book-close': { make: [bookClose], gap: 300, max: 1, volume: 0.85 },
}

/** At most this many effects at once, of all kinds. */
export const MAX_EFFECT_VOICES = 8
/** How quickly gains follow a change (time constant, s): smooth, no clicks, no restart. */
const RAMP = 0.08
/** Indoors, the town's ambience comes through the walls: muffled and quieter. */
const INDOOR_CUTOFF_HZ = 650
const OUTDOOR_CUTOFF_HZ = 16000
const INDOOR_LEVEL = 0.45

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** How loud each ambient layer is, for a given night (0..1). Pure, so the day/night crossfade can be tested. */
export function ambienceLevels(night: number): { wind: number; crickets: number; birds: boolean } {
  const n = clamp01(night)
  const dusk = n * n * (3 - 2 * n) // smoothstep
  return { wind: 0.55 - 0.2 * dusk, crickets: 0.6 * dusk, birds: n < 0.35 }
}

export interface PlayRecord { name: SoundName; at: number }

export class AudioEngine {
  private ctx: ContextLike | null = null
  private master: GainLike | null = null
  private effectsBus: GainLike | null = null
  private ambientBus: GainLike | null = null
  private indoorFilter: FilterLike | null = null
  private windGain: GainLike | null = null
  private cricketGain: GainLike | null = null
  private loops: SourceLike[] = []
  private analyser: AnalyserLike | null = null
  private readonly buffers = new Map<string, BufferLike>()
  private readonly lastAt = new Map<SoundName, number>()
  private readonly lastVariant = new Map<SoundName, number>()
  private readonly playing = new Map<SoundName, number>()
  private voices = 0
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS }
  private ambience: Ambience | null = null
  private indoors = false
  private hidden = false
  private birdTimer: unknown = null
  private readonly o: Required<AudioEngineOptions>
  /** The last plays (name and time), for tests and debugging. */
  readonly history: PlayRecord[] = []

  constructor(options: AudioEngineOptions) {
    this.o = {
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      random: Math.random,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
      ...options,
    }
  }

  /** True once a user gesture has started the audio. */
  get unlocked(): boolean {
    return this.ctx !== null
  }

  get state(): string {
    return this.ctx?.state ?? 'locked'
  }

  get currentSettings(): AudioSettings {
    return { ...this.settings }
  }

  /** How many effects are sounding right now. */
  get activeVoices(): number {
    return this.voices
  }

  /**
   * Starts the audio. Call from a user gesture only (browsers refuse audio before one). Safe to call repeatedly; the
   * context is created once.
   */
  unlock(): void {
    if (!this.ctx) {
      const ctx = this.o.createContext()
      if (!ctx) return
      this.ctx = ctx
      this.build(ctx)
    }
    if (!this.settings.muted && !this.hidden && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined)
    this.syncAmbience()
  }

  /**
   * Starts listening for the first gesture (and for the tab being hidden). Returns the clean-up. Installing twice
   * installs once.
   */
  install(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, doc: Pick<Document, 'addEventListener' | 'removeEventListener'> & { hidden: boolean }): () => void {
    if (this.installed) return this.installed
    const gesture = (): void => this.unlock()
    const visibility = (): void => this.setHidden(doc.hidden)
    for (const e of ['pointerdown', 'keydown', 'touchend'] as const) target.addEventListener(e, gesture, { capture: true, passive: true })
    doc.addEventListener('visibilitychange', visibility)
    this.setHidden(doc.hidden)
    const uninstall = (): void => {
      for (const e of ['pointerdown', 'keydown', 'touchend'] as const) target.removeEventListener(e, gesture, { capture: true })
      doc.removeEventListener('visibilitychange', visibility)
      this.installed = null
    }
    this.installed = uninstall
    return uninstall
  }
  private installed: (() => void) | null = null

  /** Applies new settings: gains move; nothing restarts. Muting silences at once and stops scheduling. */
  setSettings(next: AudioSettings): void {
    const was = this.settings.muted
    this.settings = {
      master: clamp01(next.master), ambient: clamp01(next.ambient), effects: clamp01(next.effects), muted: next.muted === true,
    }
    const ctx = this.ctx
    if (!ctx || !this.master || !this.ambientBus || !this.effectsBus) return
    const t = ctx.currentTime
    if (this.settings.muted) {
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setValueAtTime(0, t)
      this.stopBirds()
      void ctx.suspend().catch(() => undefined)
      return
    }
    this.master.gain.setTargetAtTime(this.settings.master, t, RAMP)
    this.ambientBus.gain.setTargetAtTime(this.settings.ambient, t, RAMP)
    this.effectsBus.gain.setTargetAtTime(this.settings.effects, t, RAMP)
    if (was && !this.hidden) {
      void ctx.resume().catch(() => undefined)
      this.syncAmbience()
    }
  }

  /** Plays an effect, unless locked, muted, hidden, too soon after the last one, or too many are playing. */
  play(name: SoundName, options: { volume?: number } = {}): boolean {
    const ctx = this.ctx
    if (!ctx || !this.effectsBus || this.settings.muted || this.hidden || ctx.state !== 'running') return false
    const spec = SPECS[name]
    const now = this.o.now()
    if (now - (this.lastAt.get(name) ?? -Infinity) < spec.gap) return false
    if ((this.playing.get(name) ?? 0) >= spec.max || this.voices >= MAX_EFFECT_VOICES) return false

    const last = this.lastVariant.get(name) ?? -1
    let variant = 0
    if (spec.make.length > 1) {
      variant = Math.floor(this.o.random() * (spec.make.length - 1))
      if (variant >= last) variant++
    }
    const buffer = this.buffer(`${name}#${variant}`, spec.make[variant]!)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = spec.volume * clamp01(options.volume ?? 1)
    source.connect(gain)
    gain.connect(this.effectsBus)

    this.lastAt.set(name, now)
    this.lastVariant.set(name, variant)
    this.playing.set(name, (this.playing.get(name) ?? 0) + 1)
    this.voices++
    let ended = false
    source.onended = () => {
      if (ended) return
      ended = true
      this.playing.set(name, Math.max(0, (this.playing.get(name) ?? 1) - 1))
      this.voices = Math.max(0, this.voices - 1)
      source.disconnect()
      gain.disconnect()
    }
    source.start()
    this.history.push({ name, at: now })
    if (this.history.length > 100) this.history.splice(0, this.history.length - 100)
    return true
  }

  /** Sets the ambience (the town's sky), or stops it with null (leaving the game). */
  setAmbience(next: Ambience | null): void {
    const prev = this.ambience
    this.ambience = next
    if (next && prev && Math.abs(next.night - prev.night) < 0.01) {
      this.ambience = prev // tiny changes: keep the last applied value, so a slow drift still crosses the threshold
      return
    }
    this.syncAmbience()
  }

  /** Inside a house the town is heard through the walls; out in the town, as it is. */
  setIndoors(indoors: boolean): void {
    if (this.indoors === indoors) return
    this.indoors = indoors
    const ctx = this.ctx
    if (!ctx || !this.indoorFilter || !this.ambientGainOuter) return
    const t = ctx.currentTime
    this.indoorFilter.frequency.setTargetAtTime(indoors ? INDOOR_CUTOFF_HZ : OUTDOOR_CUTOFF_HZ, t, 0.25)
    this.ambientGainOuter.gain.setTargetAtTime(indoors ? INDOOR_LEVEL : 1, t, 0.25)
  }

  /** The level coming out right now (RMS of the master output); for tests in a real browser. */
  measure(): number {
    const ctx = this.ctx
    if (!ctx || !this.master || !ctx.createAnalyser) return 0
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.master.connect(this.analyser)
    }
    const data = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += v * v
    return Math.sqrt(sum / data.length)
  }

  private setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return
    this.hidden = hidden
    const ctx = this.ctx
    if (!ctx) return
    if (hidden) {
      this.stopBirds()
      void ctx.suspend().catch(() => undefined)
    } else if (!this.settings.muted) {
      void ctx.resume().catch(() => undefined)
      this.syncAmbience()
    }
  }

  // ── Graph ────────────────────────────────────────────────────────────────────────────────────────────────

  private ambientGainOuter: GainLike | null = null

  private build(ctx: ContextLike): void {
    const master = ctx.createGain()
    master.gain.value = this.settings.muted ? 0 : this.settings.master
    master.connect(ctx.destination)
    const effects = ctx.createGain()
    effects.gain.value = this.settings.effects
    effects.connect(master)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = this.indoors ? INDOOR_CUTOFF_HZ : OUTDOOR_CUTOFF_HZ
    filter.Q.value = 0.5
    const outer = ctx.createGain()
    outer.gain.value = this.indoors ? INDOOR_LEVEL : 1
    filter.connect(outer)
    outer.connect(master)
    const ambient = ctx.createGain()
    ambient.gain.value = this.settings.ambient
    ambient.connect(filter)
    this.master = master
    this.effectsBus = effects
    this.indoorFilter = filter
    this.ambientGainOuter = outer
    this.ambientBus = ambient
  }

  private buffer(key: string, make: (sr: number) => Float32Array): BufferLike {
    const found = this.buffers.get(key)
    if (found) return found
    const ctx = this.ctx!
    const samples = make(ctx.sampleRate)
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buffer.getChannelData(0).set(samples)
    this.buffers.set(key, buffer)
    return buffer
  }

  /** Starts, adjusts or stops the ambient layers to match the current ambience. */
  private syncAmbience(): void {
    const ctx = this.ctx
    if (!ctx || !this.ambientBus) return
    const amb = this.ambience
    if (!amb) {
      this.stopBirds()
      if (this.windGain && this.cricketGain) {
        this.windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3)
        this.cricketGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3)
      }
      const loops = this.loops
      this.loops = []
      for (const s of loops) s.stop(ctx.currentTime + 1.5)
      this.windGain = this.cricketGain = null
      return
    }
    if (this.settings.muted || this.hidden) return
    if (!this.windGain || !this.cricketGain) {
      this.windGain = ctx.createGain()
      this.cricketGain = ctx.createGain()
      this.windGain.gain.value = 0
      this.cricketGain.gain.value = 0
      this.windGain.connect(this.ambientBus)
      this.cricketGain.connect(this.ambientBus)
      for (const [key, make, gain] of [['wind', windLoop, this.windGain], ['crickets', cricketLoop, this.cricketGain]] as const) {
        const s = ctx.createBufferSource()
        s.buffer = this.buffer(key, make)
        s.loop = true
        s.connect(gain)
        s.start()
        this.loops.push(s)
      }
    }
    const levels = ambienceLevels(amb.night)
    this.windGain.gain.setTargetAtTime(levels.wind, ctx.currentTime, 1.5)
    this.cricketGain.gain.setTargetAtTime(levels.crickets, ctx.currentTime, 1.5)
    if (levels.birds) this.scheduleBird()
    else this.stopBirds()
  }

  private scheduleBird(): void {
    if (this.birdTimer !== null) return
    const wait = 6000 + this.o.random() * 12000
    this.birdTimer = this.o.setTimer(() => {
      this.birdTimer = null
      const ctx = this.ctx
      const amb = this.ambience
      if (!ctx || !amb || this.settings.muted || this.hidden || ctx.state !== 'running' || !ambienceLevels(amb.night).birds || !this.ambientBus) return
      const variant = Math.floor(this.o.random() * 3)
      const s = ctx.createBufferSource()
      s.buffer = this.buffer(`bird#${variant}`, sr => birdChirp(variant, sr))
      s.playbackRate.value = 0.94 + this.o.random() * 0.12
      const g = ctx.createGain()
      g.gain.value = 0.25 + this.o.random() * 0.2
      s.connect(g)
      g.connect(this.ambientBus)
      s.onended = () => { s.disconnect(); g.disconnect() }
      s.start()
      this.scheduleBird()
    }, wait)
  }

  private stopBirds(): void {
    if (this.birdTimer !== null) this.o.clearTimer(this.birdTimer)
    this.birdTimer = null
  }
}
