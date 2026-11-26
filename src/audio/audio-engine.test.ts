import { describe, expect, it } from 'vitest'
import {
  AudioEngine, DEFAULT_AUDIO_SETTINGS, MAX_EFFECT_VOICES, ambienceLevels,
  type BufferLike, type ContextLike, type FilterLike, type GainLike, type NodeLike, type ParamLike, type SourceLike,
} from './audio-engine'

/** A Web Audio stand-in that records what the engine does. Sound sources end only when `end()` is called. */
class FakeParam implements ParamLike {
  targets: number[] = []
  constructor(public value = 1) {}
  setTargetAtTime(target: number): void { this.targets.push(target); this.value = target }
  setValueAtTime(value: number): void { this.targets.push(value); this.value = value }
  cancelScheduledValues(): void {}
}
class FakeNode implements NodeLike {
  connected: NodeLike[] = []
  connect(to: NodeLike): void { this.connected.push(to) }
  disconnect(): void { this.connected = [] }
}
class FakeGain extends FakeNode implements GainLike { gain = new FakeParam(1) }
class FakeFilter extends FakeNode implements FilterLike { type = 'lowpass'; frequency = new FakeParam(350); Q = new FakeParam(1) }
class FakeSource extends FakeNode implements SourceLike {
  buffer: BufferLike | null = null
  loop = false
  playbackRate = new FakeParam(1)
  onended: (() => void) | null = null
  started = false
  stopped = false
  start(): void { this.started = true }
  stop(): void { this.stopped = true }
  end(): void { this.onended?.() }
}
class FakeContext implements ContextLike {
  currentTime = 0
  sampleRate = 8000
  state = 'suspended'
  destination = new FakeNode()
  sources: FakeSource[] = []
  gains: FakeGain[] = []
  filters: FakeFilter[] = []
  resumes = 0
  suspends = 0
  createGain(): FakeGain { const g = new FakeGain(); this.gains.push(g); return g }
  createBiquadFilter(): FakeFilter { const f = new FakeFilter(); this.filters.push(f); return f }
  createBufferSource(): FakeSource { const s = new FakeSource(); this.sources.push(s); return s }
  createBuffer(_c: number, length: number): BufferLike {
    const data = new Float32Array(length)
    return { duration: length / this.sampleRate, getChannelData: () => data }
  }
  async resume(): Promise<void> { this.resumes++; this.state = 'running' }
  async suspend(): Promise<void> { this.suspends++; this.state = 'suspended' }
}

function setup() {
  let now = 0
  const contexts: FakeContext[] = []
  const timers = new Map<number, () => void>()
  let timerId = 0
  const engine = new AudioEngine({
    createContext: () => { const c = new FakeContext(); contexts.push(c); return c },
    now: () => now,
    random: () => 0.5,
    setTimer: (run) => { timers.set(++timerId, run); return timerId },
    clearTimer: id => { timers.delete(id as number) },
  })
  const start = async (): Promise<FakeContext> => {
    engine.unlock()
    await Promise.resolve()
    return contexts[0]!
  }
  return { engine, contexts, timers, start, advance: (ms: number) => { now += ms } }
}

/** The master gain: the one connected to the speakers. */
const masterOf = (c: FakeContext): FakeGain => c.gains.find(g => g.connected.includes(c.destination))!
const effectSources = (c: FakeContext): FakeSource[] => c.sources.filter(s => !s.loop && s.buffer && s.playbackRate.value === 1)

describe('the audio engine', () => {
  it('makes no sound and no AudioContext before a user gesture', () => {
    const { engine, contexts } = setup()
    expect(engine.play('step-grass')).toBe(false)
    engine.setAmbience({ night: 0 })
    expect(contexts).toHaveLength(0)
    expect(engine.state).toBe('locked')
  })

  it('starts on the first gesture, with one AudioContext however often it is unlocked or installed', async () => {
    const { engine, contexts } = setup()
    const listeners: Array<[string, () => void]> = []
    const target = { addEventListener: (e: string, f: () => void) => { listeners.push([e, f]) }, removeEventListener: () => undefined }
    const doc = { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined }
    const un1 = engine.install(target as never, doc as never)
    const un2 = engine.install(target as never, doc as never)
    expect(un1).toBe(un2)
    expect(listeners.map(([e]) => e)).toEqual(['pointerdown', 'keydown', 'touchend'])
    listeners[1]![1]() // a key press
    listeners[0]![1]()
    engine.unlock()
    await Promise.resolve()
    expect(contexts).toHaveLength(1)
    expect(engine.state).toBe('running')
    expect(engine.play('door-open')).toBe(true)
  })

  it('plays each effect once per call, with a minimum gap and a cap on overlapping copies', async () => {
    const { engine, start, advance } = setup()
    const c = await start()
    expect(engine.play('step-grass')).toBe(true)
    expect(engine.play('step-grass')).toBe(false) // within the 150 ms gap
    advance(160)
    expect(engine.play('step-grass')).toBe(true)
    advance(160)
    expect(engine.play('step-grass')).toBe(false) // two still sounding: the cap
    effectSources(c)[0]!.end()
    expect(engine.play('step-grass')).toBe(true)
    expect(engine.activeVoices).toBe(2)
    expect(engine.history.map(h => h.name)).toEqual(['step-grass', 'step-grass', 'step-grass'])
  })

  it('never has more than the total voice limit sounding', async () => {
    const { engine, start, advance } = setup()
    await start()
    const names = ['step-grass', 'step-path', 'step-wood', 'door-open', 'door-close', 'computer-on', 'computer-off', 'key', 'page-turn', 'pencil', 'book-close'] as const
    let played = 0
    for (const n of names) if (engine.play(n)) played++
    advance(1000)
    for (const n of names) if (engine.play(n)) played++
    expect(engine.activeVoices).toBe(MAX_EFFECT_VOICES)
    expect(played).toBe(MAX_EFFECT_VOICES)
  })

  it('never plays the same footstep variant twice in a row', async () => {
    const { engine, start, advance } = setup()
    const c = await start()
    const seen: Array<BufferLike | null> = []
    for (let i = 0; i < 6; i++) {
      engine.play('step-path')
      const last = effectSources(c)[effectSources(c).length - 1]!
      seen.push(last.buffer)
      last.end()
      advance(200)
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1])
  })

  it('changes volumes by moving gains only: nothing restarts', async () => {
    const { engine, start } = setup()
    const c = await start()
    engine.setAmbience({ night: 0 })
    const sources = c.sources.length
    engine.setSettings({ master: 0.2, ambient: 0.9, effects: 0.1, muted: false })
    expect(c.sources.length).toBe(sources)
    expect(c.sources.filter(s => s.stopped)).toEqual([])
    expect(masterOf(c).gain.value).toBeCloseTo(0.2)
    expect(engine.currentSettings).toEqual({ master: 0.2, ambient: 0.9, effects: 0.1, muted: false })
    engine.setSettings({ master: 7, ambient: -1, effects: Number.NaN, muted: false })
    expect(engine.currentSettings).toEqual({ master: 1, ambient: 0, effects: 0, muted: false })
  })

  it('mutes everything at once: silent output, suspended, nothing new plays, no birds scheduled', async () => {
    const { engine, start, timers } = setup()
    const c = await start()
    engine.setAmbience({ night: 0 })
    expect(timers.size).toBe(1) // a bird later
    engine.setSettings({ ...DEFAULT_AUDIO_SETTINGS, muted: true })
    await Promise.resolve()
    expect(masterOf(c).gain.value).toBe(0)
    expect(c.state).toBe('suspended')
    expect(timers.size).toBe(0)
    expect(engine.play('door-open')).toBe(false)

    engine.setSettings({ ...DEFAULT_AUDIO_SETTINGS, muted: false })
    await Promise.resolve()
    expect(c.state).toBe('running')
    expect(masterOf(c).gain.value).toBeCloseTo(DEFAULT_AUDIO_SETTINGS.master)
    expect(engine.play('door-open')).toBe(true)
  })

  it('stays quiet while the tab is hidden, and carries on when it is shown again', async () => {
    const { engine, contexts } = setup()
    let visibility: () => void = () => undefined
    const doc = { hidden: false, addEventListener: (_e: string, f: () => void) => { visibility = f }, removeEventListener: () => undefined }
    engine.install({ addEventListener: () => undefined, removeEventListener: () => undefined } as never, doc as never)
    engine.unlock()
    await Promise.resolve()
    doc.hidden = true
    visibility()
    await Promise.resolve()
    expect(contexts[0]!.state).toBe('suspended')
    expect(engine.play('step-grass')).toBe(false)
    doc.hidden = false
    visibility()
    await Promise.resolve()
    expect(contexts[0]!.state).toBe('running')
    expect(engine.play('step-grass')).toBe(true)
  })
})

describe('ambience', () => {
  it('crossfades from day (wind and birds) to night (softer wind and crickets)', () => {
    const day = ambienceLevels(0)
    const dusk = ambienceLevels(0.5)
    const night = ambienceLevels(1)
    expect(day).toEqual({ wind: 0.55, crickets: 0, birds: true })
    expect(night.crickets).toBeGreaterThan(dusk.crickets)
    expect(dusk.crickets).toBeGreaterThan(0)
    expect(night.wind).toBeLessThan(day.wind)
    expect(night.birds).toBe(false)
    expect(dusk.birds).toBe(false)
  })

  it('starts two loops once, follows the sky, muffles indoors, and stops when the town is left', async () => {
    const { engine, start } = setup()
    const c = await start()
    engine.setAmbience({ night: 0 })
    engine.setAmbience({ night: 0.2 })
    engine.setAmbience({ night: 1 })
    const loops = c.sources.filter(s => s.loop)
    expect(loops).toHaveLength(2)
    expect(loops.every(s => s.started)).toBe(true)

    const filter = c.filters[0]!
    engine.setIndoors(true)
    expect(filter.frequency.value).toBeLessThan(1000)
    engine.setIndoors(false)
    expect(filter.frequency.value).toBeGreaterThan(10000)

    engine.setAmbience(null)
    expect(loops.every(s => s.stopped)).toBe(true)
    engine.setAmbience({ night: 0 })
    expect(c.sources.filter(s => s.loop)).toHaveLength(4) // new loops, the old ones stay stopped
  })

  it('ignores the tiny changes the sky makes every frame', async () => {
    const { engine, start } = setup()
    const c = await start()
    engine.setAmbience({ night: 0.5 })
    const wind = c.gains.find(g => g.gain.targets.length > 0 && c.sources.some(s => s.loop && s.connected.includes(g)))!
    const before = wind.gain.targets.length
    for (let i = 0; i < 50; i++) engine.setAmbience({ night: 0.5 + i * 0.0001 })
    expect(wind.gain.targets.length).toBe(before)
    engine.setAmbience({ night: 0.6 })
    expect(wind.gain.targets.length).toBe(before + 1)
  })
})
