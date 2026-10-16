// Counts active screen time and decides when a stretch is due.
// Pure logic with no Electron imports, so it can be tested with plain Node.

export type TickStatus = 'paused' | 'away' | 'counting' | 'due';

export interface SchedulerOptions {
  /** active time between reminders */
  intervalMs: number;
  /** idle this long counts as a break: the timer restarts */
  idleResetMs: number;
  now?: () => number;
}

export class Scheduler {
  private intervalMs: number;
  private readonly idleResetMs: number;
  private readonly now: () => number;
  private activeMs: number;
  private dueMs: number;
  pausedUntil: number;

  constructor({ intervalMs, idleResetMs, now = () => Date.now() }: SchedulerOptions) {
    this.intervalMs = intervalMs;
    this.idleResetMs = idleResetMs;
    this.now = now;
    this.activeMs = 0;
    this.dueMs = intervalMs;
    this.pausedUntil = 0;
  }

  /**
   * Call regularly.
   * @param dtMs    time since the last tick
   * @param idleMs  how long the keyboard and mouse have been idle
   */
  tick(dtMs: number, idleMs: number): TickStatus {
    const now = this.now();
    if (this.pausedUntil) {
      if (now < this.pausedUntil) return 'paused';
      this.pausedUntil = 0;
      this.reset();
    }
    // A long gap between ticks means the machine slept: treat it as a break.
    if (idleMs >= this.idleResetMs || dtMs >= this.idleResetMs) {
      this.reset();
      return 'away';
    }
    this.activeMs += dtMs;
    return this.activeMs >= this.dueMs ? 'due' : 'counting';
  }

  reset(): void {
    this.activeMs = 0;
    this.dueMs = this.intervalMs;
  }

  /** The stretch was done, skipped or stopped: start a full interval. */
  complete(): void {
    this.reset();
  }

  snooze(ms: number): void {
    this.activeMs = 0;
    this.dueMs = ms;
  }

  pause(ms: number): void {
    this.pausedUntil = this.now() + ms;
  }

  pauseUntil(timestamp: number): void {
    this.pausedUntil = timestamp;
  }

  resume(): void {
    this.pausedUntil = 0;
    this.reset();
  }

  isPaused(): boolean {
    return this.pausedUntil > this.now();
  }

  setInterval(ms: number): void {
    const wasFullInterval = this.dueMs === this.intervalMs;
    this.intervalMs = ms;
    if (wasFullInterval) this.dueMs = ms;
  }

  msLeft(): number {
    return Math.max(0, this.dueMs - this.activeMs);
  }
}
