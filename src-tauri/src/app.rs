// The app: state, the timer loop, and wiring the tray and the card together.
//
// Threads: Tauri's main thread runs the tray menu, the card's commands and every window and
// tray call; one timer thread ticks the scheduler. They share `Inner` behind one lock, which
// is only ever held for quick reads and changes, never across a call into Tauri.

use std::panic::{self, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{Days, Local};
use serde_json::Value;
use tauri::{App, AppHandle, Manager, RunEvent};

use crate::card::{self, CardState};
use crate::scheduler::{Scheduler, TickStatus};
use crate::store::{Settings, Stats, Store};
use crate::{exercises, platform, tray};

/// A real minute, for the idle reset and pauses, which stay real time in fast mode.
pub const REAL_MIN: u64 = 60 * 1000;

/// Fixed for the whole run.
pub struct Config {
    /// `npm run fast` turns minutes into seconds so you can watch a full cycle quickly.
    pub fast: bool,
    /// A reminder "minute" in milliseconds: the interval and snooze are counted in these.
    pub min: u64,
    pub tick: Duration,
    /// GINO_NO_BREAKS=1, for test runs only: ignore idle time, a locked screen and sleep, so a
    /// test can drive cards on an unattended (locked) machine.
    pub no_breaks: bool,
}

impl Config {
    fn from_env() -> Self {
        let fast = std::env::args().any(|a| a == "--fast")
            || std::env::var("GINO_FAST").is_ok_and(|v| v == "1");
        Config {
            fast,
            min: if fast { 1000 } else { REAL_MIN },
            tick: Duration::from_millis(if fast { 1000 } else { 15 * 1000 }),
            no_breaks: std::env::var("GINO_NO_BREAKS").is_ok_and(|v| v == "1"),
        }
    }
}

/// What changes while Gino runs. Lock it with `Gino::lock`.
pub struct Inner {
    pub settings: Settings,
    pub stats: Stats,
    pub sched: Scheduler,
    /// A card is up (or on its way up).
    pub card_visible: bool,
    pub card: CardState,
    /// Why a due stretch is being held back.
    pub waiting: Option<&'static str>,
    last_check: Option<Instant>,
    /// "Try one now" on the welcome card: show a stretch once it has gone.
    pub show_after_close: bool,
}

impl Inner {
    pub fn new(settings: Settings, stats: Stats, sched: Scheduler) -> Self {
        Inner {
            settings,
            stats,
            sched,
            card_visible: false,
            card: CardState {
                height: card::WIN_H,
                ..CardState::default()
            },
            waiting: None,
            last_check: None,
            show_after_close: false,
        }
    }
}

/// The app's state, managed by Tauri: `app.state::<Gino>()`.
pub struct Gino {
    pub cfg: Config,
    pub store: Store,
    exercises: Vec<Value>,
    walk_flags: Vec<bool>,
    inner: Mutex<Inner>,
    /// Taken while writing a file, so saves from different threads can't land out of order.
    io: Mutex<()>,
}

impl Gino {
    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        // If something panicked while holding the lock, carry on with the state as it is
        // rather than taking the reminders down too.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Every third reminder is the walkaround; the rest rotate through the stretches.
    /// The caller saves the stats once it has let go of the lock.
    pub fn pick_next(&self, s: &mut Inner) -> Value {
        let i = s.stats.pick_next(&self.walk_flags);
        self.exercises.get(i).cloned().unwrap_or(Value::Null)
    }

    /// Write settings.json as it is now. Call it without holding the state lock: the file
    /// is written from a copy, so the timer and the menu don't wait for the disk.
    pub fn save_settings(&self) {
        let _io = self.io.lock().unwrap_or_else(|e| e.into_inner());
        let settings = self.lock().settings.clone();
        self.store.save_settings(&settings);
    }

    /// Write stats.json as it is now. Like save_settings, without holding the state lock.
    pub fn save_stats(&self) {
        let _io = self.io.lock().unwrap_or_else(|e| e.into_inner());
        let stats = self.lock().stats.clone();
        self.store.save_stats(&stats);
    }
}

/// Milliseconds since the Unix epoch, which is how the scheduler keeps pauses.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

// ---------- start-up ----------

pub fn run() {
    let builder = tauri::Builder::default()
        // First, so a second launch is caught before anything else starts. It shows the
        // welcome card, because that says where Gino lives (unless Gino is still starting:
        // see card::show).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            card::show_welcome(app)
        }));
    // "Open at login". Windows writes its own Run value instead (see platform).
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(autostart());
    let app = builder
        .invoke_handler(tauri::generate_handler![
            card::card_ready,
            card::card_action,
            card::card_resize,
            card::card_closed
        ])
        .setup(|app| setup(app))
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Gino could not start: {e}");
            std::process::exit(1);
        }
    };
    app.run(|_app, event| match event {
        // Keep running in the tray whatever happens to the window; only Quit (which comes
        // with an exit code) ends the app.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        // Opening Gino again from Finder or Spotlight while it runs: macOS tells the running
        // app instead of starting a second one. Like a second launch on Windows, show the
        // welcome card, which says where Gino lives.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => card::show_welcome(_app),
        _ => {}
    });
}

#[cfg(target_os = "macos")]
fn autostart() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let builder = tauri_plugin_autostart::Builder::new().app_name("Gino");
    let builder = builder.macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);
    builder.build()
}

/// GINO_DATA_DIR if set (tests and trying things out), otherwise the folder the Electron
/// version used: %APPDATA%\Gino, ~/Library/Application Support/Gino.
fn data_dir(app: &App) -> Option<PathBuf> {
    match std::env::var_os("GINO_DATA_DIR").filter(|v| !v.is_empty()) {
        Some(dir) => Some(PathBuf::from(dir)),
        None => app.path().config_dir().ok().map(|d| d.join("Gino")),
    }
}

fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // A menu bar app: no Dock icon.
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    // A run with its own data folder is a test: it leaves the real login items alone.
    let testing = std::env::var_os("GINO_DATA_DIR").is_some_and(|v| !v.is_empty());
    if !testing {
        platform::remove_legacy_login_item();
    }

    let cfg = Config::from_env();
    let dir = data_dir(app).ok_or("can't find the folder for Gino's settings")?;
    let store = Store::new(dir);
    let mut settings = store.load_settings();
    // A spot saved by the Electron version (no unit) is in other coordinates: back to the
    // corner instead (dropped from the file with the next save).
    if card::saved_pos(&settings).is_none() {
        settings.card_pos = None;
    }
    let stats = store.load_stats();
    let sched = Scheduler::new(
        u64::from(settings.interval_min) * cfg.min,
        u64::from(settings.idle_reset_min) * REAL_MIN,
    );
    let exercises = exercises::all();
    let walk_flags = exercises.iter().map(exercises::is_walk).collect();
    let first_run = !settings.welcomed;
    let fast = cfg.fast;
    let tick = cfg.tick;

    app.manage(Gino {
        cfg,
        store,
        exercises,
        walk_flags,
        inner: Mutex::new(Inner::new(settings, stats, sched)),
        io: Mutex::new(()),
    });

    // No card window yet: it's made for each card (see card.rs).
    let handle = app.handle().clone();
    card::start(&handle);
    tray::create(&handle)?;

    let timer = handle.clone();
    thread::Builder::new()
        .name("gino-timer".into())
        .spawn(move || timer_loop(timer, tick))?;

    // GINO_QUIT_AFTER=<seconds>: quit by itself, for test runs.
    let quit_after = std::env::var("GINO_QUIT_AFTER")
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .and_then(|secs| Duration::try_from_secs_f64(secs).ok())
        .filter(|d| !d.is_zero());
    if let Some(after) = quit_after {
        let quitter = handle.clone();
        thread::spawn(move || {
            thread::sleep(after);
            quitter.exit(0);
        });
    }

    if first_run {
        let gino = handle.state::<Gino>();
        gino.lock().settings.welcomed = true;
        gino.save_settings();
        card::show_welcome(&handle);
    }
    if fast {
        println!("Gino fast mode: reminder minutes are seconds.");
    }
    Ok(())
}

// ---------- the timer ----------

fn timer_loop(app: AppHandle, tick: Duration) {
    let mut last = Instant::now();
    let mut last_wall = SystemTime::now();
    loop {
        thread::sleep(tick);
        let elapsed = last.elapsed();
        last = Instant::now();
        // Instant doesn't count time asleep on every system (macOS); the wall clock does, so
        // a sleeping laptop still comes back as a break.
        let wall = SystemTime::now();
        let elapsed_wall = wall.duration_since(last_wall).unwrap_or_default();
        last_wall = wall;
        let dt = elapsed.max(elapsed_wall).as_millis() as u64;

        // Nothing here should panic, but if it does, report it and keep ticking.
        if panic::catch_unwind(AssertUnwindSafe(|| tick_once(&app, dt))).is_err() {
            eprintln!("Gino: a timer tick failed; carrying on.");
        }
    }
}

enum Next {
    Nothing,
    ForceHide,
    MaybeShow,
}

fn tick_once(app: &AppHandle, dt: u64) {
    let gino = app.state::<Gino>();
    let no_breaks = gino.cfg.no_breaks;
    let idle = if no_breaks { 0 } else { platform::idle_ms() };
    let locked = !no_breaks && platform::screen_locked();
    // A gap this long between ticks means the computer slept: like a locked screen, that's a
    // break, however short.
    let tick_ms = gino.cfg.tick.as_millis() as u64;
    let slept = !no_breaks && dt > (4 * tick_ms).max(60 * 1000);
    let next = {
        let mut s = gino.lock();
        let idle_reset = u64::from(s.settings.idle_reset_min) * REAL_MIN;
        if s.card_visible {
            // You walked away with a card up, locked the screen or put the computer to sleep:
            // put it away and start fresh.
            if idle >= idle_reset || locked || slept {
                s.sched.reset();
                s.waiting = None;
                Next::ForceHide
            } else {
                Next::Nothing
            }
        } else if locked || slept {
            // A locked screen, or a sleep, is a break.
            s.sched.reset();
            s.waiting = None;
            Next::Nothing
        } else {
            match s.sched.tick(now_ms(), dt, idle) {
                TickStatus::Away => {
                    s.waiting = None;
                    Next::Nothing
                }
                TickStatus::Due => Next::MaybeShow,
                TickStatus::Paused | TickStatus::Counting => Next::Nothing,
            }
        }
    };
    match next {
        Next::ForceHide => card::force_hide(app),
        Next::MaybeShow => maybe_show(app),
        Next::Nothing => {}
    }
    tray::update(app);
}

/// A stretch is due: show it, unless now is a bad moment (a call, a full-screen app).
fn maybe_show(app: &AppHandle) {
    let gino = app.state::<Gino>();
    let check = {
        let s = gino.lock();
        if s.card_visible {
            return;
        }
        // While holding off, look again once a minute.
        if s.waiting.is_some()
            && s.last_check
                .is_some_and(|t| t.elapsed() < Duration::from_secs(60))
        {
            return;
        }
        // GINO_NO_BREAKS test runs skip it too: on a locked machine it says "screen locked".
        s.settings.wait_when_busy && !gino.cfg.no_breaks
    };
    // Outside the lock: the check reads the registry and may take a moment.
    let busy = if check { platform::busy_reason() } else { None };
    {
        let mut s = gino.lock();
        s.last_check = Some(Instant::now());
        if s.card_visible || s.sched.is_paused(now_ms()) || s.sched.ms_left() > 0 {
            return;
        }
        if let Some(reason) = busy {
            s.waiting = Some(reason);
            return; // the tray is updated at the end of this tick
        }
    }
    card::show_stretch(app);
}

// ---------- the tray menu's actions ----------

pub fn pause_for(app: &AppHandle, minutes: u64) {
    let gino = app.state::<Gino>();
    let mut s = gino.lock();
    s.sched.pause(now_ms(), minutes * REAL_MIN);
    s.waiting = None;
}

/// Until 06:00 tomorrow, local time.
pub fn pause_until_tomorrow(app: &AppHandle) {
    let six = Local::now()
        .date_naive()
        .checked_add_days(Days::new(1))
        .and_then(|d| d.and_hms_opt(6, 0, 0))
        .and_then(|t| t.and_local_timezone(Local).earliest());
    let Some(six) = six else {
        eprintln!("Could not work out tomorrow morning; pausing for 12 hours instead.");
        return pause_for(app, 12 * 60);
    };
    let gino = app.state::<Gino>();
    let mut s = gino.lock();
    s.sched.pause_until(six.timestamp_millis().max(0) as u64);
    s.waiting = None;
}

pub fn resume(app: &AppHandle) {
    app.state::<Gino>().lock().sched.resume();
}

pub fn set_interval_min(app: &AppHandle, minutes: u32) {
    let gino = app.state::<Gino>();
    {
        let mut s = gino.lock();
        s.settings.interval_min = minutes;
        s.sched.set_interval(u64::from(minutes) * gino.cfg.min);
    }
    gino.save_settings();
}

pub fn toggle_wait_when_busy(app: &AppHandle) {
    let gino = app.state::<Gino>();
    {
        let mut s = gino.lock();
        s.settings.wait_when_busy = !s.settings.wait_when_busy;
        s.waiting = None;
    }
    gino.save_settings();
}
