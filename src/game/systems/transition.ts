/**
 * Guards a door against firing twice.
 *
 * A transition is "busy" from the moment E is accepted until the scene has
 * finished arriving. After that a short cooldown keeps E inert, so the same
 * key press (or a key-repeat that slips through) cannot walk the player
 * straight back out. Pure: time is passed in, never read.
 */
export class TransitionLock {
  private busy = false
  private blockedUntil = 0
  private readonly cooldownMs: number

  constructor(cooldownMs: number) {
    this.cooldownMs = cooldownMs
  }

  /** True while a transition is running. */
  get isBusy(): boolean {
    return this.busy
  }

  /** Claims the lock. Returns false when busy or still cooling down. */
  tryBegin(now: number): boolean {
    if (this.busy || now < this.blockedUntil) return false
    this.busy = true
    return true
  }

  /** Called when the destination scene is ready. Starts the cooldown. */
  release(now: number): void {
    this.busy = false
    this.blockedUntil = now + this.cooldownMs
  }

  /** Clears everything, e.g. after a failed transition. No cooldown. */
  reset(): void {
    this.busy = false
    this.blockedUntil = 0
  }
}
