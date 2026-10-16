// The card window: making it, placing it, showing it and putting it away, and the commands the
// card page calls (card_ready, card_action, card_resize, card_closed).
//
// Gino is idle almost all the time, and a web view costs a lot of memory even when hidden, so
// the window only exists while a card is up: it is made for each card and destroyed when the
// card is put away. It stays hidden until the page says it is listening (card_ready), so it
// never flashes up empty.
//
// Each card gets a window of its own, labelled card-1, card-2 and so on. Destroying a window
// takes a moment, and the last card's page can still call in meanwhile; anything from a window
// that isn't the current card's is ignored.
//
// Everything that touches the window runs on the main thread, and never while holding the
// app's state lock: from another thread, Tauri's window calls wait for the main thread, which
// may itself be waiting for that lock.

use std::sync::mpsc::{Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    Position, Size, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::app::Gino;
use crate::placement::{self, Rect, Screen};
use crate::store::{SavedCardPos, Settings};
use crate::{platform, tray};

// The window's size in the page's CSS pixels (see window_size).
const WIN_W: f64 = 440.0; // card 404 + shadow room
pub const WIN_H: f64 = 214.0;
const EDGE: f64 = 8.0; // gap to the screen edge, in logical pixels

/// A page that hasn't said it's listening by then isn't going to.
const READY_TIMEOUT: Duration = Duration::from_secs(20);

/// The card's WebView2 command line. It replaces wry's, so wry's --disable-features list
/// comes first. Then no network at all: the card is a local page, and without these WebView2
/// fetches its settings from Microsoft, looks for a proxy and checks for component updates.
/// Then software rendering: for a card this small it looks the same, uses about 50 MB less
/// memory and less CPU while Gino moves than the GPU path does. The host rules come last (see
/// webview2_args).
#[cfg(windows)]
const WEBVIEW2_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
     --disable-background-networking --disable-component-update --no-proxy-server --disable-gpu";

/// No host name resolves. Gino's own page and its IPC (tauri.localhost, ipc.localhost) never
/// go near the network: WebView2 hands those requests to Gino. Anything else is blocked anyway
/// (the CSP, on_navigation), but a blocked navigation is only cancelled once its request has
/// started, and WebView2 preconnects to the page's own host; with this neither gets as far as
/// a DNS lookup or a TCP connection.
#[cfg(windows)]
const NO_HOSTS: &str = "MAP * ~NOTFOUND";

/// The card's WebView2 command line, for a page from `dev` (a dev build) or Gino's own.
#[cfg(windows)]
fn webview2_args(dev: Option<&Url>) -> String {
    // A dev build's page comes from the dev server, which has to resolve.
    let except = dev
        .and_then(Url::host_str)
        .map(|host| format!(", EXCLUDE {host}"))
        .unwrap_or_default();
    format!("{WEBVIEW2_ARGS} --host-resolver-rules=\"{NO_HOSTS}{except}\"")
}

/// Placement works in one coordinate space across all screens. On Windows that's physical
/// pixels. On macOS, tao reports screens scaled by each screen's own scale but windows by the
/// window's current one, so the only shared space there is logical points.
const LOGICAL: bool = cfg!(target_os = "macos");
/// The unit a saved card position is in, so a position saved in the other one is never used.
const UNIT: &str = if LOGICAL { "logical" } else { "physical" };

/// The card window's side of the app state (kept in app::Inner, under its lock).
#[derive(Default)]
pub struct CardState {
    /// Counts the cards shown. The current card's window is labelled after it.
    pub attempt: u64,
    /// The current window's page is listening (it called card_ready).
    pub ready: bool,
    /// The card waiting for the page to listen.
    pub pending: Option<ShowPayload>,
    /// The card on screen, sent again if the page reloads.
    pub current: Option<ShowPayload>,
    /// This card's stretch has been counted: a second "done" doesn't count again.
    pub counted: bool,
    /// Where we last put the card, to tell our own moves from your drags.
    pub placed_at: Option<Rect>,
    /// The height the card last asked for, in the page's CSS pixels.
    pub height: f64,
    /// When this card was asked for (fast mode reports how long it took to appear).
    pub asked_at: Option<Instant>,
}

/// Rust → card: what to show (ShowPayload in src/types.ts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowPayload {
    mode: &'static str,
    exercise: Value,
    today_count: u32,
    snooze_min: u32,
    interval_min: u32,
    auto_snooze_min: u32,
}

/// The answer to a card action: 'done' sends back today's count (ActionReply in src/types.ts).
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionReply {
    #[serde(skip_serializing_if = "Option::is_none")]
    today_count: Option<u32>,
}

/// A saved spot, if it was saved in this system's unit. The Electron version saved positions
/// without a unit, in its own coordinates; those would land in the wrong place.
pub fn saved_pos(settings: &Settings) -> Option<placement::CardPos> {
    settings
        .card_pos
        .as_ref()
        .filter(|p| p.unit.as_deref() == Some(UNIT))
        .map(|p| placement::CardPos {
            x: p.x,
            bottom: p.bottom,
        })
}

/// Sends the label of a moved card window to the thread that waits for moves to settle.
pub struct Moves(Sender<String>);

/// Start the thread that remembers where you drag the card. Once, at start-up.
pub fn start(app: &AppHandle) {
    let (moved, moves) = std::sync::mpsc::channel();
    let handle = app.clone();
    thread::spawn(move || settle_moves(handle, moves));
    app.manage(Moves(moved));
}

// ---------- the window ----------

/// The window label for card number `attempt`. capabilities/default.json matches "card-*".
fn label_for(attempt: u64) -> String {
    format!("card-{attempt}")
}

/// The current card's window label, if a card is up (or on its way).
fn current_label(app: &AppHandle) -> Option<String> {
    let gino = app.try_state::<Gino>()?;
    let s = gino.lock();
    s.card_visible.then(|| label_for(s.card.attempt))
}

/// The current card's window, if it has one.
fn window(app: &AppHandle) -> Option<WebviewWindow> {
    current_label(app).and_then(|label| app.get_webview_window(&label))
}

/// Whether a call comes from the current card's window.
fn is_current(app: &AppHandle, win: &WebviewWindow) -> bool {
    current_label(app).as_deref() == Some(win.label())
}

/// Only Gino's own page: http(s)://tauri.localhost on Windows, tauri://localhost on macOS, and
/// in a dev build the dev server's page, `dev` (see dev_server). The card has no links, so
/// anything else is something going wrong.
fn is_own_page(url: &Url, dev: Option<&Url>) -> bool {
    if dev.is_some_and(|dev| dev.origin() == url.origin()) {
        return true;
    }
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

/// Where the page comes from in a dev build (npm start): tauri dev serves build/web itself
/// (http://127.0.0.1:1430) and passes that on as build.devUrl. A release build has none, so it
/// only ever allows its own page.
fn dev_server(app: &AppHandle) -> Option<Url> {
    if tauri::is_dev() {
        app.config().build.dev_url.clone()
    } else {
        None
    }
}

/// The tallest card a page may ask for, in CSS pixels. The tallest real one (the thoracic
/// stretch with How to open) is about 280.
const MAX_H: f64 = 640.0;

/// The height to make the window for a card that asks for `height` CSS pixels: the usual one
/// for nonsense, never more than MAX_H.
fn card_height(height: f64) -> f64 {
    if height.is_finite() && height > 0.0 {
        height.min(MAX_H)
    } else {
        WIN_H
    }
}

/// The window's size in logical pixels, for a card `height` CSS pixels tall (shadow room
/// included). WebView2 draws the page bigger by Windows' text size (Settings > Accessibility >
/// Text size) on top of the screen's scale, so a CSS pixel is `text_scale` logical pixels: the
/// window grows by as much, and the page still gets its 440 CSS pixels. The card comes out
/// bigger, laid out the same, like other apps that follow the setting.
fn window_size(height: f64, text_scale: f64) -> (f64, f64) {
    (WIN_W * text_scale, height * text_scale)
}

/// Make the window for card number `attempt`, hidden; it loads the page, which calls card_ready.
fn build(app: &AppHandle, attempt: u64) -> tauri::Result<WebviewWindow> {
    let label = label_for(attempt);
    // At its full width from the start, so the page never lays out squeezed.
    let (width, height) = window_size(WIN_H, platform::text_scale());
    let dev = dev_server(app);
    #[cfg(windows)]
    let browser_args = webview2_args(dev.as_ref());
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Gino")
        .inner_size(width, height)
        .visible(false)
        .focused(false)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .shadow(false)
        .on_navigation(move |url| is_own_page(url, dev.as_ref()))
        .on_page_load(|win, load| {
            // A reload (the page crashed, say) must say it's listening again before it gets
            // the card back.
            let app = win.app_handle();
            if load.event() != PageLoadEvent::Started || !is_current(app, &win) {
                return;
            }
            if let Some(gino) = app.try_state::<Gino>() {
                let mut s = gino.lock();
                s.card.ready = false;
                if s.card.pending.is_none() {
                    s.card.pending = s.card.current.take();
                }
            }
        });
    // Windows: never take keyboard focus, so you can't accidentally type into it.
    #[cfg(windows)]
    let builder = builder
        .focusable(false)
        .additional_browser_args(&browser_args);
    // macOS: on every desktop, and the first click goes straight to the button.
    #[cfg(target_os = "macos")]
    let builder = builder
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true);
    let win = builder.build()?;
    platform::prepare_card_window(&win);

    // The card is dragged by its body (bridge.ts); remember where you drop it.
    let moved = app.try_state::<Moves>().map(|m| m.0.clone());
    win.on_window_event(move |event| match event {
        WindowEvent::Moved(_) => {
            if let Some(moved) = &moved {
                let _ = moved.send(label.clone());
            }
        }
        // The card has no close button; only Gino puts it away (with destroy, which skips this).
        WindowEvent::CloseRequested { api, .. } => api.prevent_close(),
        _ => {}
    });
    Ok(win)
}

/// Pixels to the placement unit, on a screen or window with this scale.
fn to_unit(v: i32, scale: f64) -> i32 {
    if LOGICAL {
        (f64::from(v) / scale).round() as i32
    } else {
        v
    }
}

fn rect_to_unit(x: i32, y: i32, width: u32, height: u32, scale: f64) -> Rect {
    Rect {
        x: to_unit(x, scale),
        y: to_unit(y, scale),
        width: to_unit(width as i32, scale),
        height: to_unit(height as i32, scale),
    }
}

/// The screens as placement.rs wants them, in the placement unit.
fn screens(app: &AppHandle) -> Vec<Screen> {
    let primary = app.primary_monitor().ok().flatten();
    let monitors = app.available_monitors().unwrap_or_else(|e| {
        eprintln!("Could not list the screens: {e}");
        Vec::new()
    });
    monitors
        .iter()
        .map(|m| {
            let (pos, size, work) = (m.position(), m.size(), m.work_area());
            let scale = m.scale_factor();
            Screen {
                bounds: rect_to_unit(pos.x, pos.y, size.width, size.height, scale),
                work_area: rect_to_unit(
                    work.position.x,
                    work.position.y,
                    work.size.width,
                    work.size.height,
                    scale,
                ),
                // In logical points the card is the same size on every screen.
                scale: if LOGICAL { 1.0 } else { scale },
                primary: primary
                    .as_ref()
                    .is_some_and(|p| p.position() == pos && p.size() == size),
            }
        })
        .collect()
}

/// Put the card where it goes, `height` CSS pixels tall. Main thread.
fn place(app: &AppHandle, win: &WebviewWindow, height: f64) {
    let screens = screens(app);
    let (width, tall) = window_size(height, platform::text_scale());
    let gino = app.state::<Gino>();
    let r = {
        let mut s = gino.lock();
        let r = placement::card_bounds(&screens, saved_pos(&s.settings), width, tall, EDGE);
        // Noted before the move, so the move it causes isn't taken for a drag.
        s.card.placed_at = Some(r);
        s.card.height = height;
        r
    };
    let (w, h) = (r.width.max(1) as u32, r.height.max(1) as u32);
    let (pos, size): (Position, Size) = if LOGICAL {
        (
            LogicalPosition::new(f64::from(r.x), f64::from(r.y)).into(),
            LogicalSize::new(f64::from(w), f64::from(h)).into(),
        )
    } else {
        (
            PhysicalPosition::new(r.x, r.y).into(),
            PhysicalSize::new(w, h).into(),
        )
    };
    // Moving onto a screen with another scale can make Windows resize the window, so the
    // size comes after the move, and the move once more in case that shifted it.
    for result in [
        win.set_position(pos),
        win.set_size(size),
        win.set_position(pos),
    ] {
        if let Err(e) = result {
            eprintln!("Could not place the card: {e}");
        }
    }
}

/// Moves come in bursts (all through a drag on macOS, once at the end on Windows), so look
/// once they settle.
fn settle_moves(app: AppHandle, moves: Receiver<String>) {
    while let Ok(mut label) = moves.recv() {
        while let Ok(later) = moves.recv_timeout(Duration::from_millis(300)) {
            label = later;
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || remember_pos(&handle, &label));
    }
}

/// Save where you dragged the card in window `label`, if that's still the current card.
/// Main thread.
fn remember_pos(app: &AppHandle, label: &str) {
    if current_label(app).as_deref() != Some(label) {
        return;
    }
    let Some(win) = app.get_webview_window(label) else {
        return;
    };
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return;
    };
    // Window positions come in pixels at the window's own scale.
    let scale = win.scale_factor().unwrap_or(1.0);
    let b = rect_to_unit(pos.x, pos.y, size.width, size.height, scale);
    let gino = app.state::<Gino>();
    {
        let mut s = gino.lock();
        // Our own placing reports a move too; only a real drag lands somewhere new.
        let ours = s
            .card
            .placed_at
            .is_some_and(|p| (b.x - p.x).abs() <= 2 && (b.y - p.y).abs() <= 2);
        if ours || !s.card_visible {
            return;
        }
        s.settings.card_pos = Some(SavedCardPos {
            x: b.x,
            bottom: b.y + b.height,
            unit: Some(UNIT.into()),
        });
        s.card.placed_at = Some(b);
    }
    gino.save_settings();
    tray::update(app); // "Reset card position" comes on
}

/// Forget the dragged spot: back to the corner of the main screen.
pub fn reset_pos(app: &AppHandle) {
    let gino = app.state::<Gino>();
    let again = {
        let mut s = gino.lock();
        s.settings.card_pos = None;
        s.card.current.is_some().then_some(s.card.height)
    };
    gino.save_settings();
    if let Some(height) = again {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(win) = window(&handle) {
                place(&handle, &win, height);
            }
        });
    }
}

// ---------- showing and putting away ----------

enum What {
    Stretch,
    Welcome,
}

/// Show the next stretch in the rotation. Does nothing while a card is up. Any thread.
pub fn show_stretch(app: &AppHandle) {
    show(app, What::Stretch);
}

/// Show the welcome card, which says where Gino lives. Does nothing while a card is up.
pub fn show_welcome(app: &AppHandle) {
    show(app, What::Welcome);
}

fn show(app: &AppHandle, what: What) {
    // A second launch can arrive while Gino is still starting up: nothing to show yet.
    let Some(gino) = app.try_state::<Gino>() else {
        return;
    };
    let attempt = {
        let mut s = gino.lock();
        if s.card_visible {
            return;
        }
        let (mode, exercise) = match what {
            What::Stretch => ("stretch", gino.pick_next(&mut s)),
            What::Welcome => ("welcome", welcome_card(&s.settings)),
        };
        let payload = ShowPayload {
            mode,
            exercise,
            today_count: s.stats.today_count(&crate::store::today_key()),
            snooze_min: s.settings.snooze_min,
            interval_min: s.settings.interval_min,
            auto_snooze_min: s.settings.auto_snooze_min,
        };
        // Up from now on, so nothing else starts a card while this one's window is made.
        s.card_visible = true;
        s.waiting = None;
        s.card.attempt += 1;
        s.card.ready = false;
        s.card.pending = Some(payload);
        s.card.current = None;
        s.card.counted = false;
        s.card.asked_at = Some(Instant::now());
        s.card.attempt
    };
    if matches!(what, What::Stretch) {
        gino.save_stats(); // the rotation moved on
    }
    // Made from the event loop itself, never inside a command, a menu click or a second
    // launch's message: on Windows, making a web view inside another one's callback can
    // deadlock. Hence a thread that queues it.
    let handle = app.clone();
    thread::spawn(move || {
        let h = handle.clone();
        let _ = handle.run_on_main_thread(move || open(&h, attempt));
    });

    // If the page never says it's listening, give up rather than block every later card.
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(READY_TIMEOUT);
        let h = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let gino = h.state::<Gino>();
            let stuck = {
                let s = gino.lock();
                s.card.attempt == attempt && s.card_visible && s.card.current.is_none()
            };
            if stuck {
                eprintln!("The card page didn't load; giving up on this card.");
                put_away(&h);
            }
        });
    });
}

/// Make the window for card `attempt`. Main thread.
fn open(app: &AppHandle, attempt: u64) {
    let gino = app.state::<Gino>();
    {
        let s = gino.lock();
        if s.card.attempt != attempt || !s.card_visible {
            return; // put away before it got here
        }
    }
    if let Err(e) = build(app, attempt) {
        eprintln!("Could not make the card window: {e}");
        {
            let mut s = gino.lock();
            s.card_visible = false;
            s.card.pending = None;
        }
    }
    tray::update(app);
}

/// Hand the page its card, put the window in place and show it. Main thread.
fn reveal(app: &AppHandle, win: &WebviewWindow, payload: &ShowPayload) {
    if let Err(e) = app.emit_to(win.label(), "show", payload) {
        eprintln!("Could not send the card: {e}");
    }
    place(app, win, WIN_H);
    platform::show_without_focus(win);
}

/// How long a card's window stays, hidden, before it is destroyed: long enough for WebView2 to
/// take Gino's answer to the call that put it away (card_closed). Destroyed at once, the page
/// never got that answer: WebView2 tried the call on the network instead, and Gino's handle
/// count crept up by one every two or three cards.
const DESTROY_AFTER: Duration = Duration::from_millis(250);

/// The card is done with: destroy its window (its web view processes go with it), then show
/// the next one if "Try one now" asked for it. Main thread.
fn put_away(app: &AppHandle) {
    if let Some(win) = window(app) {
        // Hidden right away, destroyed a moment later.
        let _ = win.hide();
        thread::spawn(move || {
            thread::sleep(DESTROY_AFTER);
            let w = win.clone();
            let _ = win.run_on_main_thread(move || {
                if let Err(e) = w.destroy() {
                    eprintln!("Could not close the card window: {e}");
                }
            });
        });
    }
    let gino = app.state::<Gino>();
    let again = {
        let mut s = gino.lock();
        s.card_visible = false;
        s.card.ready = false;
        s.card.pending = None;
        s.card.current = None;
        s.card.placed_at = None;
        s.card.asked_at = None;
        std::mem::take(&mut s.show_after_close)
    };
    tray::update(app);
    // "Try one now" on the welcome card: the first stretch, once this one is gone.
    if again {
        let handle = app.clone();
        thread::spawn(move || {
            thread::sleep(DESTROY_AFTER + Duration::from_millis(300));
            show_stretch(&handle);
        });
    }
}

/// Put the card away from this side (you walked away, or locked the screen), without the
/// card's own close flow. Any thread.
pub fn force_hide(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        handle.state::<Gino>().lock().show_after_close = false;
        put_away(&handle);
    });
}

fn welcome_card(settings: &Settings) -> Value {
    let place = if cfg!(target_os = "macos") {
        "I live in the menu bar."
    } else {
        "I live in the tray by the clock. If you can't see me, I'm under the ^ arrow: drag me out."
    };
    json!({
        "id": "welcome",
        "name": "Hi, I'm Gino",
        "pose": "wave",
        "text": format!(
            "Every {} minutes of screen time I'll pop up with a short stretch. {place}",
            settings.interval_min
        ),
        "dose": "",
        "howTo": [],
    })
}

// ---------- commands from the card page ----------
// Not async, so Tauri runs them on the main thread. Each takes the window it came from and
// ignores anything but the current card's.

/// The page is listening: send the card that's waiting, and show the window.
#[tauri::command]
pub fn card_ready(app: AppHandle, window: WebviewWindow) {
    if !is_current(&app, &window) {
        return;
    }
    let gino = app.state::<Gino>();
    let (payload, asked_at) = {
        let mut s = gino.lock();
        s.card.ready = true;
        let payload = s.card.pending.take();
        if payload.is_some() {
            s.card.current.clone_from(&payload);
        }
        (payload, s.card.asked_at.take())
    };
    let Some(payload) = payload else {
        return;
    };
    reveal(&app, &window, &payload);
    if let (true, Some(t)) = (gino.cfg.fast, asked_at) {
        println!(
            "Gino fast mode: card up {} ms after it was asked for.",
            t.elapsed().as_millis()
        );
    }
}

/// What you did on the card. `data` is { id }, { auto } or {}, and nothing here needs it.
/// Only the card on screen counts, a stretch is counted once however often "done" comes, and
/// "Try one now" only comes from the welcome card.
#[tauri::command]
pub fn card_action(
    app: AppHandle,
    window: WebviewWindow,
    name: String,
    data: Option<Value>,
) -> ActionReply {
    let _ = data;
    if !is_current(&app, &window) {
        return ActionReply::default();
    }
    let gino = app.state::<Gino>();
    let mut counted = false;
    let reply = {
        let mut s = gino.lock();
        let Some(mode) = s.card.current.as_ref().map(|p| p.mode) else {
            return ActionReply::default(); // not on screen yet
        };
        let stretch = mode == "stretch";
        match name.as_str() {
            "done" if stretch => {
                let today = crate::store::today_key();
                if !s.card.counted {
                    s.card.counted = true;
                    s.stats.add_done(&today);
                    s.sched.complete();
                    counted = true;
                }
                ActionReply {
                    today_count: Some(s.stats.today_count(&today)),
                }
            }
            "skip" | "stop" if stretch => {
                s.sched.complete();
                ActionReply::default()
            }
            "snooze" if stretch => {
                let ms = u64::from(s.settings.snooze_min) * gino.cfg.min;
                s.sched.snooze(ms);
                ActionReply::default()
            }
            "trynow" if mode == "welcome" => {
                s.show_after_close = true;
                ActionReply::default()
            }
            _ => ActionReply::default(),
        }
    };
    if counted {
        gino.save_stats();
    }
    tray::update(&app);
    reply
}

/// The card needs the window this tall (the page's CSS pixels, shadow room included).
#[tauri::command]
pub fn card_resize(app: AppHandle, window: WebviewWindow, height: f64) {
    if !is_current(&app, &window) {
        return; // a window on its way out
    }
    place(&app, &window, card_height(height));
}

/// The close animation finished.
#[tauri::command]
pub fn card_closed(app: AppHandle, window: WebviewWindow) {
    if is_current(&app, &window) {
        put_away(&app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_welcome_card_matches_the_electron_one() {
        let settings = Settings {
            interval_min: 30,
            ..Settings::default()
        };
        let card = welcome_card(&settings);
        assert_eq!(card["id"], "welcome");
        assert_eq!(card["pose"], "wave");
        assert_eq!(card["howTo"], json!([]));
        let text = card["text"].as_str().unwrap();
        assert!(
            text.starts_with(
                "Every 30 minutes of screen time I'll pop up with a short stretch. I live in the "
            ),
            "{text}"
        );
    }

    #[test]
    fn payload_and_reply_use_the_cards_field_names() {
        let payload = ShowPayload {
            mode: "stretch",
            exercise: json!({ "id": "x" }),
            today_count: 2,
            snooze_min: 10,
            interval_min: 20,
            auto_snooze_min: 4,
        };
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            json!({ "mode": "stretch", "exercise": { "id": "x" }, "todayCount": 2, "snoozeMin": 10, "intervalMin": 20, "autoSnoozeMin": 4 })
        );
        assert_eq!(
            serde_json::to_value(ActionReply::default()).unwrap(),
            json!({})
        );
        assert_eq!(
            serde_json::to_value(ActionReply {
                today_count: Some(3)
            })
            .unwrap(),
            json!({ "todayCount": 3 })
        );
    }

    #[test]
    fn only_positions_saved_in_this_systems_unit_count() {
        let pos = |unit: Option<&str>| Settings {
            card_pos: Some(SavedCardPos {
                x: 10,
                bottom: 500,
                unit: unit.map(String::from),
            }),
            ..Settings::default()
        };
        let other = if LOGICAL { "physical" } else { "logical" };
        assert_eq!(
            saved_pos(&pos(Some(UNIT))),
            Some(placement::CardPos { x: 10, bottom: 500 })
        );
        assert_eq!(saved_pos(&pos(Some(other))), None);
        assert_eq!(saved_pos(&pos(None)), None);
        assert_eq!(saved_pos(&Settings::default()), None);
    }

    #[test]
    fn pixels_convert_to_the_placement_unit() {
        let r = rect_to_unit(3000, -1500, 1320, 642, 1.5);
        if LOGICAL {
            assert_eq!(
                r,
                Rect {
                    x: 2000,
                    y: -1000,
                    width: 880,
                    height: 428
                }
            );
        } else {
            assert_eq!(
                r,
                Rect {
                    x: 3000,
                    y: -1500,
                    width: 1320,
                    height: 642
                }
            );
        }
    }

    #[test]
    fn the_window_grows_with_the_text_size_but_the_corner_gap_does_not() {
        assert_eq!(window_size(214.0, 1.0), (WIN_W, 214.0));
        // At 150% with text at 114%, a CSS pixel is 1.71 screen pixels: the window is 440 x 197
        // CSS pixels, 8 logical pixels (12 physical) from the corner of the work area.
        let screen = Screen {
            bounds: Rect {
                x: 0,
                y: 0,
                width: 3840,
                height: 2160,
            },
            work_area: Rect {
                x: 0,
                y: 0,
                width: 3840,
                height: 2088,
            },
            scale: 1.5,
            primary: true,
        };
        let (width, height) = window_size(197.0, 1.14);
        let r = placement::card_bounds(&[screen], None, width, height, EDGE);
        assert_eq!((r.width, r.height), (752, 337));
        assert_eq!((r.x + r.width, r.y + r.height), (3828, 2076));
    }

    #[test]
    fn each_card_gets_its_own_label() {
        assert_eq!(label_for(1), "card-1");
        assert_ne!(label_for(1), label_for(2));
    }

    #[test]
    fn the_card_may_only_be_on_gino_s_own_page() {
        let ok = |u: &str| is_own_page(&Url::parse(u).unwrap(), None);
        assert!(ok("http://tauri.localhost/index.html"));
        assert!(ok("https://tauri.localhost/index.html"));
        assert!(ok("tauri://localhost/index.html"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("http://tauri.localhost.example.com/"));
        assert!(!ok("http://ipc.localhost/card_ready"));
        assert!(!ok("file:///C:/Windows/win.ini"));
        assert!(!ok("about:blank"));
        assert!(!ok("javascript:alert(1)"));
        // Without a dev server, a local server's page is someone else's.
        assert!(!ok("http://127.0.0.1:1430/index.html"));
    }

    #[test]
    fn a_dev_build_also_allows_its_dev_server_and_nothing_else() {
        let dev = Url::parse("http://127.0.0.1:1430/").unwrap();
        let ok = |u: &str| is_own_page(&Url::parse(u).unwrap(), Some(&dev));
        assert!(ok("http://127.0.0.1:1430/index.html"));
        assert!(ok("http://tauri.localhost/index.html"));
        assert!(!ok("http://127.0.0.1:1431/index.html"));
        assert!(!ok("https://127.0.0.1:1430/index.html"));
        assert!(!ok("http://localhost:1430/index.html"));
        assert!(!ok("https://example.com/"));
    }

    #[test]
    fn a_card_is_never_taller_than_the_tallest_one_could_be() {
        assert_eq!(card_height(280.0), 280.0);
        assert_eq!(card_height(5000.0), MAX_H);
        assert_eq!(card_height(f64::INFINITY), WIN_H);
        assert_eq!(card_height(f64::NAN), WIN_H);
        assert_eq!(card_height(0.0), WIN_H);
        assert_eq!(card_height(-10.0), WIN_H);
    }

    #[cfg(windows)]
    #[test]
    fn no_host_resolves_except_a_dev_server() {
        let release = webview2_args(None);
        assert!(release.starts_with(WEBVIEW2_ARGS), "{release}");
        assert!(
            release.ends_with(r#" --host-resolver-rules="MAP * ~NOTFOUND""#),
            "{release}"
        );
        let dev = webview2_args(Some(&Url::parse("http://127.0.0.1:1430/").unwrap()));
        assert!(
            dev.ends_with(r#" --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1""#),
            "{dev}"
        );
    }
}
