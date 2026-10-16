// Counts active screen time and decides when a stretch is due.
// Pure logic with no Electron imports, so it can be tested with plain Node.

class Scheduler {
  /**
   * @param {object} o
   * @param {number} o.intervalMs   active time between reminders
   * @param {number} o.idleResetMs  idle this long counts as a break: the timer restarts
   * @param {() => number} [o.now]
   */
  constructor({ intervalMs, idleResetMs, now = () => Date.now() }) {
    this.intervalMs = intervalMs;
    this.idleResetMs = idleResetMs;
    this.now = now;
    this.activeMs = 0;
    this.dueMs = intervalMs;
    this.pausedUntil = 0;
  }

  /**
   * Call regularly.
   * @param {number} dtMs    time since the last tick
   * @param {number} idleMs  how long the keyboard and mouse have been idle
   * @returns {'paused'|'away'|'counting'|'due'}
   */
  tick(dtMs, idleMs) {
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

  reset() {
    this.activeMs = 0;
    this.dueMs = this.intervalMs;
  }

  /** The stretch was done, skipped or stopped: start a full interval. */
  complete() {
    this.reset();
  }

  snooze(ms) {
    this.activeMs = 0;
    this.dueMs = ms;
  }

  pause(ms) {
    this.pausedUntil = this.now() + ms;
  }

  pauseUntil(timestamp) {
    this.pausedUntil = timestamp;
  }

  resume() {
    this.pausedUntil = 0;
    this.reset();
  }

  isPaused() {
    return this.pausedUntil > this.now();
  }

  setInterval(ms) {
    const wasFullInterval = this.dueMs === this.intervalMs;
    this.intervalMs = ms;
    if (wasFullInterval) this.dueMs = ms;
  }

  msLeft() {
    return Math.max(0, this.dueMs - this.activeMs);
  }
}

module.exports = { Scheduler };
