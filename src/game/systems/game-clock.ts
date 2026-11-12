/**
 * The in-game clock.
 *
 * A pure, renderer-free accumulator: it is fed the scene's `delta` and reports
 * the in-game hour, minute and period. It never reads the system clock, so
 * changing the computer's time changes nothing, and a full day takes exactly
 * `CYCLE_DURATION_MS` of *played* time.
 *
 * Two deliberate guards:
 *
 * - A frame delta is capped at `MAX_FRAME_MS`. A backgrounded browser tab
 *   stops requesting animation frames, and the first frame after it comes
 *   back arrives with a delta of the whole hidden stretch — without the cap,
 *   the town would jump hours into the night every time you switched tabs.
 * - `freeze` turns `tick` into a no-op, so a developer can hold a time still
 *   and inspect it. The clock still reports a full state.
 */

import { CYCLE_DURATION_MS, DEFAULT_START_HOUR, PERIODS, type Period } from '../config/halloween'

/** Longest span of in-game time a single frame may advance (tab-switch guard). */
export const MAX_FRAME_MS = 250

export interface ClockState {
  /** In-game hour, 0–23. */
  hour: number
  /** In-game minute, 0–59. */
  minute: number
  /** Which part of the day that hour falls in. */
  period: Period
}

/** Day 06:00–17:59, evening 18:00–19:59, night 20:00–05:59. */
export function periodAt(hour: number): Period {
  const h = wrapHour(hour)

  if (h >= PERIODS.day.startHour && h < PERIODS.day.endHour) return 'day'
  if (h >= PERIODS.evening.startHour && h < PERIODS.evening.endHour) return 'evening'
  return 'night'
}

export class GameClock {
  private readonly durationMs: number
  /** The hour the current run started from / was last set to. */
  private originHour: number
  /** Played time since that origin. */
  private elapsedMs = 0
  private frozen = false

  constructor(startHour: number = DEFAULT_START_HOUR, durationMs: number = CYCLE_DURATION_MS) {
    this.originHour = wrapHour(startHour)
    this.durationMs = Math.max(1, durationMs)
  }

  /** The current in-game time. */
  get state(): ClockState {
    const hourFloat = this.hourFloat()
    const hour = Math.floor(hourFloat)
    const minute = Math.floor((hourFloat - hour) * 60)

    return { hour, minute, period: periodAt(hourFloat) }
  }

  /** Fractional hour, 0–24. Handy for the lighting curve. */
  get hour(): number {
    return this.hourFloat()
  }

  get isFrozen(): boolean {
    return this.frozen
  }

  /**
   * Advance the clock by a frame delta. A frozen clock ignores the delta.
   * Returns the resulting state.
   */
  tick(deltaMs: number): ClockState {
    if (this.frozen) return this.state
    if (deltaMs > 0) this.elapsedMs += Math.min(deltaMs, MAX_FRAME_MS)
    return this.state
  }

  /** Jump to an in-game hour without carrying the old elapsed time over. */
  setHour(hour: number): ClockState {
    this.originHour = wrapHour(hour)
    this.elapsedMs = 0
    return this.state
  }

  freeze(frozen = true): void {
    this.frozen = frozen
  }

  private hourFloat(): number {
    return wrapHour(this.originHour + (this.elapsedMs / this.durationMs) * 24)
  }
}

/**
 * `?time=21:30` → 21.5. Missing or malformed values return `undefined`, so
 * the caller silently falls back to the default start hour.
 */
export function parseTimeOverride(search: string): number | undefined {
  const raw = readParam(search, 'time')
  if (!raw) return undefined

  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!match) return undefined

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
  if (hour > 23 || minute > 59) return undefined

  return hour + minute / 60
}

/** `?timeFrozen=1` (or `true`) holds the clock still. */
export function parseFrozenOverride(search: string): boolean {
  const raw = readParam(search, 'timeFrozen')
  return raw === '1' || raw === 'true'
}

function readParam(search: string, name: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search
  return new URLSearchParams(query).get(name)
}

function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24
}
