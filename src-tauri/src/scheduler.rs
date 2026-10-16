// Counts active screen time and decides when a stretch is due.
// Pure logic with no Tauri types, so it can be tested with plain `cargo test`.
// All times are milliseconds, and the caller passes the current time in.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TickStatus {
    Paused,
    Away,
    Counting,
    Due,
}

#[derive(Debug, Clone)]
pub struct Scheduler {
    /// Active time between reminders.
    interval_ms: u64,
    /// Idle this long counts as a break: the timer restarts.
    idle_reset_ms: u64,
    active_ms: u64,
    due_ms: u64,
    /// Milliseconds since the Unix epoch; 0 = not paused.
    paused_until: u64,
}

impl Scheduler {
    pub fn new(interval_ms: u64, idle_reset_ms: u64) -> Self {
        Scheduler {
            interval_ms,
            idle_reset_ms,
            active_ms: 0,
            due_ms: interval_ms,
            paused_until: 0,
        }
    }

    /// Call regularly. `dt_ms` is the time since the last tick, `idle_ms` how long the
    /// keyboard and mouse have been idle.
    pub fn tick(&mut self, now_ms: u64, dt_ms: u64, idle_ms: u64) -> TickStatus {
        if self.paused_until != 0 {
            if now_ms < self.paused_until {
                return TickStatus::Paused;
            }
            self.paused_until = 0;
            self.reset();
        }
        // A long gap between ticks means the machine slept: treat it as a break.
        if idle_ms >= self.idle_reset_ms || dt_ms >= self.idle_reset_ms {
            self.reset();
            return TickStatus::Away;
        }
        self.active_ms = self.active_ms.saturating_add(dt_ms);
        if self.active_ms >= self.due_ms {
            TickStatus::Due
        } else {
            TickStatus::Counting
        }
    }

    pub fn reset(&mut self) {
        self.active_ms = 0;
        self.due_ms = self.interval_ms;
    }

    /// The stretch was done, skipped or stopped: start a full interval.
    pub fn complete(&mut self) {
        self.reset();
    }

    pub fn snooze(&mut self, ms: u64) {
        self.active_ms = 0;
        self.due_ms = ms;
    }

    pub fn pause(&mut self, now_ms: u64, ms: u64) {
        self.paused_until = now_ms.saturating_add(ms);
    }

    pub fn pause_until(&mut self, timestamp_ms: u64) {
        self.paused_until = timestamp_ms;
    }

    pub fn resume(&mut self) {
        self.paused_until = 0;
        self.reset();
    }

    pub fn is_paused(&self, now_ms: u64) -> bool {
        self.paused_until > now_ms
    }

    /// When the current pause ends (milliseconds since the Unix epoch), if any.
    pub fn paused_until(&self) -> Option<u64> {
        (self.paused_until != 0).then_some(self.paused_until)
    }

    pub fn set_interval(&mut self, ms: u64) {
        // A snoozed wait keeps its length; a normal one takes the new interval right away.
        let was_full_interval = self.due_ms == self.interval_ms;
        self.interval_ms = ms;
        if was_full_interval {
            self.due_ms = ms;
        }
    }

    pub fn ms_left(&self) -> u64 {
        self.due_ms.saturating_sub(self.active_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: u64 = 60 * 1000;
    const STEP: u64 = 15 * 1000;

    /// A scheduler with its own clock, ticked the way the app ticks it.
    struct Rig {
        s: Scheduler,
        clock: u64,
    }

    impl Rig {
        fn new() -> Self {
            Rig {
                s: Scheduler::new(20 * MIN, 5 * MIN),
                clock: 0,
            }
        }

        /// Tick every 15 seconds for `minutes`, with the keyboard and mouse idle for `idle_ms`.
        fn run_idle(&mut self, minutes: f64, idle_ms: u64) -> Option<TickStatus> {
            let total = (minutes * MIN as f64).round() as u64;
            let mut last = None;
            let mut t = 0;
            while t < total {
                self.clock += STEP;
                last = Some(self.s.tick(self.clock, STEP, idle_ms));
                t += STEP;
            }
            last
        }

        fn run(&mut self, minutes: f64) -> Option<TickStatus> {
            self.run_idle(minutes, 0)
        }
    }

    #[test]
    fn due_after_20_active_minutes_not_before() {
        let mut r = Rig::new();
        assert_eq!(r.run(19.75), Some(TickStatus::Counting));
        assert_eq!(r.run(0.25), Some(TickStatus::Due));
    }

    #[test]
    fn idle_for_5_minutes_counts_as_a_break_and_restarts_the_timer() {
        let mut r = Rig::new();
        r.run(15.0);
        assert_eq!(r.s.tick(r.clock, 15_000, 5 * MIN), TickStatus::Away);
        assert_eq!(r.s.ms_left(), 20 * MIN);
    }

    #[test]
    fn short_idle_does_not_reset() {
        let mut r = Rig::new();
        r.run_idle(10.0, 2 * MIN);
        assert_eq!(r.s.ms_left(), 10 * MIN);
    }

    #[test]
    fn a_sleep_sized_gap_between_ticks_counts_as_a_break() {
        let mut r = Rig::new();
        r.run(15.0);
        assert_eq!(r.s.tick(r.clock, 30 * MIN, 0), TickStatus::Away);
        assert_eq!(r.s.ms_left(), 20 * MIN);
    }

    #[test]
    fn snooze_shortens_the_next_wait_then_intervals_go_back_to_normal() {
        let mut r = Rig::new();
        r.run(20.0);
        r.s.snooze(10 * MIN);
        assert_eq!(r.run(10.0), Some(TickStatus::Due));
        r.s.complete();
        assert_eq!(r.s.ms_left(), 20 * MIN);
    }

    #[test]
    fn pause_holds_everything_and_resumes_with_a_fresh_interval() {
        let mut r = Rig::new();
        r.run(12.0);
        r.s.pause(r.clock, 30 * MIN);
        assert!(r.s.is_paused(r.clock));
        assert_eq!(r.s.paused_until(), Some(r.clock + 30 * MIN));
        assert_eq!(r.run(29.0), Some(TickStatus::Paused));
        assert_eq!(r.run(1.5), Some(TickStatus::Counting));
        assert!(r.s.ms_left() > 19 * MIN, "fresh interval after the pause");
        assert!(!r.s.is_paused(r.clock));
        assert_eq!(r.s.paused_until(), None);
    }

    #[test]
    fn changing_the_interval_applies_right_away_to_a_normal_wait() {
        let mut r = Rig::new();
        r.run(10.0);
        r.s.set_interval(30 * MIN);
        assert_eq!(r.s.ms_left(), 20 * MIN);
    }

    #[test]
    fn changing_the_interval_keeps_a_snooze_in_place() {
        let mut r = Rig::new();
        r.s.snooze(10 * MIN);
        r.s.set_interval(45 * MIN);
        assert_eq!(r.s.ms_left(), 10 * MIN);
    }

    #[test]
    fn pause_until_and_resume() {
        let mut r = Rig::new();
        r.run(5.0);
        r.s.pause_until(r.clock + 60 * MIN);
        assert_eq!(r.run(1.0), Some(TickStatus::Paused));
        r.s.resume();
        assert!(!r.s.is_paused(r.clock));
        assert_eq!(r.s.ms_left(), 20 * MIN);
        assert_eq!(r.run(1.0), Some(TickStatus::Counting));
    }
}
