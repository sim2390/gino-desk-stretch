// The tray (Windows) / menu bar (macOS) icon, its menu and its tooltip.
//
// The menu is built once and then kept current in place (labels, ticks, what's enabled),
// so it never has to be swapped out from under you while it's open. All of it runs on the
// main thread: `update` can be called from anywhere and hands the work over.

use std::sync::Mutex;

use chrono::{Local, TimeZone};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::app::{self, Gino, Inner};
use crate::card;

const TRAY_ID: &str = "gino";
const INTERVALS: [u32; 5] = [15, 20, 30, 45, 60];
/// Where Pause / Resume sits in the menu.
const PAUSE_AT: usize = 4;

#[cfg(target_os = "macos")]
const LOGIN_LABEL: &str = "Open at login";
#[cfg(not(target_os = "macos"))]
const LOGIN_LABEL: &str = "Start with Windows";

/// The menu items that change.
#[derive(Clone)]
struct Items {
    menu: Menu<Wry>,
    status: MenuItem<Wry>,
    today: MenuItem<Wry>,
    stretch: MenuItem<Wry>,
    /// Shown while running; Resume takes its place while paused.
    pause: Submenu<Wry>,
    resume: MenuItem<Wry>,
    every: Vec<(u32, CheckMenuItem<Wry>)>,
    /// Windows only.
    busy: Option<CheckMenuItem<Wry>>,
    login: CheckMenuItem<Wry>,
    reset_pos: MenuItem<Wry>,
    /// Which of Pause / Resume is in the menu now.
    showing_resume: bool,
}

struct TrayItems(Mutex<Items>);

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let items = build_menu(app)?;
    #[cfg(target_os = "macos")]
    let icon = Image::from_bytes(include_bytes!("../../assets/trayTemplate@2x.png"))?;
    #[cfg(not(target_os = "macos"))]
    let icon = Image::from_bytes(include_bytes!("../../assets/tray@2x.png"))?;
    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Gino")
        .menu(&items.menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            // Fresh status for the menu you're about to open (and the tooltip).
            if let TrayIconEvent::Enter { .. } = event {
                refresh(tray.app_handle());
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);
    builder.build(app)?;
    app.manage(TrayItems(Mutex::new(items)));
    refresh(app);
    Ok(())
}

fn build_menu(app: &AppHandle) -> tauri::Result<Items> {
    let item = |id: &str, text: &str, enabled: bool| {
        MenuItem::with_id(app, id, text, enabled, None::<&str>)
    };
    let check =
        |id: &str, text: &str| CheckMenuItem::with_id(app, id, text, true, false, None::<&str>);

    let status = item("status", "Gino", false)?;
    let today = item("today", "No stretches yet today", false)?;
    let stretch = item("stretch", "Stretch now", true)?;
    let pause = Submenu::with_id_and_items(
        app,
        "pause",
        "Pause",
        true,
        &[
            &item("pause-30", "For 30 minutes", true)?,
            &item("pause-60", "For 1 hour", true)?,
            &item("pause-120", "For 2 hours", true)?,
            &item("pause-tomorrow", "Until tomorrow", true)?,
        ],
    )?;
    let resume = item("resume", "Resume", true)?;
    let every = INTERVALS
        .iter()
        .map(|&m| Ok((m, check(&format!("every-{m}"), &format!("{m} minutes"))?)))
        .collect::<tauri::Result<Vec<_>>>()?;
    let every_items: Vec<&dyn IsMenuItem<Wry>> = every
        .iter()
        .map(|(_, i)| i as &dyn IsMenuItem<Wry>)
        .collect();
    let every_menu =
        Submenu::with_id_and_items(app, "every", "Remind me every", true, &every_items)?;
    let busy = if cfg!(windows) {
        Some(check("busy", "Hold off during calls and full-screen apps")?)
    } else {
        None
    };
    let login = check("login", LOGIN_LABEL)?;
    let reset_pos = item("reset-pos", "Reset card position", false)?;

    let menu = Menu::with_items(
        app,
        &[
            &status,
            &today,
            &PredefinedMenuItem::separator(app)?,
            &stretch,
            &pause,
            &PredefinedMenuItem::separator(app)?,
            &every_menu,
        ],
    )?;
    if let Some(busy) = &busy {
        menu.append(busy)?;
    }
    menu.append_items(&[
        &login,
        &reset_pos,
        &PredefinedMenuItem::separator(app)?,
        &item("quit", "Quit Gino", true)?,
    ])?;

    Ok(Items {
        menu,
        status,
        today,
        stretch,
        pause,
        resume,
        every,
        busy,
        login,
        reset_pos,
        showing_resume: false,
    })
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "stretch" => card::show_stretch(app),
        "pause-30" => app::pause_for(app, 30),
        "pause-60" => app::pause_for(app, 60),
        "pause-120" => app::pause_for(app, 120),
        "pause-tomorrow" => app::pause_until_tomorrow(app),
        "resume" => app::resume(app),
        "busy" => app::toggle_wait_when_busy(app),
        "login" => toggle_login(app),
        "reset-pos" => card::reset_pos(app),
        "quit" => app.exit(0),
        _ => {
            if let Some(m) = id.strip_prefix("every-").and_then(|m| m.parse().ok()) {
                app::set_interval_min(app, m);
            }
        }
    }
    // Clicking a check item ticks it by itself; put every tick back to what's true.
    refresh(app);
}

fn toggle_login(app: &AppHandle) {
    let autostart = app.autolaunch();
    let result = match autostart.is_enabled() {
        Ok(true) => autostart.disable(),
        _ => autostart.enable(),
    };
    if let Err(e) = result {
        eprintln!("Could not change the login item: {e}");
    }
}

/// Bring the menu and tooltip up to date. Any thread.
pub fn update(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || refresh(&handle));
}

/// What the menu shows, read under the lock in one go.
struct View {
    status: String,
    today: u32,
    card_visible: bool,
    paused: bool,
    interval_min: u32,
    wait_when_busy: bool,
    has_pos: bool,
}

/// Main thread.
fn refresh(app: &AppHandle) {
    let gino = app.state::<Gino>();
    let view = {
        let s = gino.lock();
        View {
            status: status_line(&s, gino.cfg.min, gino.cfg.fast),
            today: s.stats.today_count(&crate::store::today_key()),
            card_visible: s.card_visible,
            paused: s.sched.is_paused(app::now_ms()),
            interval_min: s.settings.interval_min,
            wait_when_busy: s.settings.wait_when_busy,
            has_pos: card::saved_pos(&s.settings).is_some(),
        }
    };
    let login = app.autolaunch().is_enabled().unwrap_or(false);
    let Some(tray_items) = app.try_state::<TrayItems>() else {
        return;
    };
    let (items, swap) = {
        let mut t = tray_items.0.lock().unwrap_or_else(|e| e.into_inner());
        let swap = t.showing_resume != view.paused;
        t.showing_resume = view.paused;
        (t.clone(), swap)
    };

    let mut results = vec![
        items.status.set_text(&view.status),
        items.today.set_text(if view.today == 0 {
            "No stretches yet today".to_string()
        } else {
            format!("Done today: {}", view.today)
        }),
        items.stretch.set_enabled(!view.card_visible),
    ];
    if swap {
        let (out, into): (&dyn IsMenuItem<Wry>, &dyn IsMenuItem<Wry>) = if view.paused {
            (&items.pause, &items.resume)
        } else {
            (&items.resume, &items.pause)
        };
        results.push(items.menu.remove(out));
        results.push(items.menu.insert(into, PAUSE_AT));
    }
    for (m, item) in &items.every {
        results.push(item.set_checked(*m == view.interval_min));
    }
    if let Some(busy) = &items.busy {
        results.push(busy.set_checked(view.wait_when_busy));
    }
    results.push(items.login.set_checked(login));
    results.push(items.reset_pos.set_enabled(view.has_pos));
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        results.push(tray.set_tooltip(Some(format!("Gino: {}", view.status))));
    }
    if let Some(Err(e)) = results.into_iter().find(Result::is_err) {
        eprintln!("Could not update the tray menu: {e}");
    }
}

fn status_line(s: &Inner, min: u64, fast: bool) -> String {
    if let Some(until) = s
        .sched
        .paused_until()
        .filter(|_| s.sched.is_paused(app::now_ms()))
    {
        return format!("Paused until {}", fmt_time(until));
    }
    if s.card_visible {
        return "Stretch on screen".into();
    }
    if let Some(reason) = s.waiting {
        return format!("Holding off: {reason}");
    }
    let left = s.sched.ms_left().div_ceil(min.max(1)).max(1);
    format!(
        "Next stretch in {left} {}",
        if fast { "sec" } else { "min" }
    )
}

/// "14:30", or "tomorrow 06:00" when it isn't today.
fn fmt_time(ts_ms: u64) -> String {
    let Some(t) = Local.timestamp_millis_opt(ts_ms as i64).single() else {
        return String::new();
    };
    let time = t
        .format(if twelve_hour_clock() {
            "%I:%M %p"
        } else {
            "%H:%M"
        })
        .to_string();
    if t.date_naive() == Local::now().date_naive() {
        time
    } else {
        format!("tomorrow {time}")
    }
}

/// Whether Windows is set to show times on a 12-hour clock ("Control Panel\International",
/// iTime "0"). Elsewhere, 24 hours.
#[cfg(windows)]
fn twelve_hour_clock() -> bool {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (key, value) = (wide(r"Control Panel\International"), wide("iTime"));
    let mut buf = [0u16; 8];
    let mut size = std::mem::size_of_val(&buf) as u32;
    let rc = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buf.as_mut_ptr().cast(),
            &mut size,
        )
    };
    rc == ERROR_SUCCESS && buf[0] == u16::from(b'0')
}

/// macOS (and the rest) always get 24 hours for now: the Electron version followed the
/// system's locale there, which would need a call into Foundation to read.
#[cfg(not(windows))]
fn twelve_hour_clock() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::Scheduler;
    use crate::store::{Settings, Stats};

    const MIN: u64 = 60 * 1000;

    fn inner(interval_ms: u64) -> Inner {
        Inner::new(
            Settings::default(),
            Stats::default(),
            Scheduler::new(interval_ms, 5 * MIN),
        )
    }

    /// Active time passing, in 15-second ticks like the app's.
    fn run(s: &mut Inner, ms: u64) {
        let mut done = 0;
        while done < ms {
            let step = (ms - done).min(15_000);
            s.sched.tick(app::now_ms(), step, 0);
            done += step;
        }
    }

    #[test]
    fn counts_down_in_whole_minutes_rounding_up_and_never_below_one() {
        let mut s = inner(20 * MIN);
        assert_eq!(status_line(&s, MIN, false), "Next stretch in 20 min");
        run(&mut s, 30_000);
        assert_eq!(status_line(&s, MIN, false), "Next stretch in 20 min");
        run(&mut s, 18 * MIN);
        assert_eq!(status_line(&s, MIN, false), "Next stretch in 2 min");
        run(&mut s, 75_000);
        assert_eq!(status_line(&s, MIN, false), "Next stretch in 1 min");
        run(&mut s, 15_000); // due
        assert_eq!(status_line(&s, MIN, false), "Next stretch in 1 min");
    }

    #[test]
    fn fast_mode_counts_seconds() {
        let mut s = inner(20 * 1000);
        assert_eq!(status_line(&s, 1000, true), "Next stretch in 20 sec");
        run(&mut s, 4500);
        assert_eq!(status_line(&s, 1000, true), "Next stretch in 16 sec");
    }

    #[test]
    fn paused_beats_a_card_on_screen_which_beats_holding_off() {
        let mut s = inner(20 * MIN);
        s.waiting = Some("full-screen app");
        assert_eq!(status_line(&s, MIN, false), "Holding off: full-screen app");
        s.card_visible = true;
        assert_eq!(status_line(&s, MIN, false), "Stretch on screen");
        s.sched.pause(app::now_ms(), 30 * MIN);
        let line = status_line(&s, MIN, false);
        assert!(line.starts_with("Paused until "), "{line}");
    }

    #[test]
    fn times_say_tomorrow_when_they_are_not_today() {
        let now = app::now_ms();
        let today = Local::now().date_naive();
        let at = |ms: u64| {
            Local
                .timestamp_millis_opt(ms as i64)
                .single()
                .unwrap()
                .date_naive()
        };
        // A minute from now, unless that's already tomorrow.
        let soon = now + MIN;
        assert_eq!(fmt_time(soon).starts_with("tomorrow "), at(soon) != today);
        let next_day = now + 24 * 60 * MIN;
        let text = fmt_time(next_day);
        assert!(
            text.starts_with("tomorrow ") && text.contains(':'),
            "{text}"
        );
    }
}
