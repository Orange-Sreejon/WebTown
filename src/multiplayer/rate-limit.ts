/** A token bucket: `rate` messages a second on average, `burst` at once. Pure; time is passed in (ms). */
export class TokenBucket {
  private tokens: number
  private last: number

  constructor(private readonly rate: number, private readonly burst: number, now: number) {
    this.tokens = burst
    this.last = now
  }

  /** True (and one token spent) when a message may pass now. */
  take(now: number): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000
    this.last = Math.max(this.last, now)
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate)
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

/** A gate for one sender's actions: at most one per `ms` (a cooldown). */
export class Cooldown {
  private next = -Infinity

  constructor(private readonly ms: number) {}

  take(now: number): boolean {
    if (now < this.next) return false
    this.next = now + this.ms
    return true
  }
}
