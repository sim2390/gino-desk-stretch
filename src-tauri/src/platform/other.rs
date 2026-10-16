// Other systems: Gino isn't packaged for them, but the app still builds and runs with
// these defaults (never idle, never busy, no start at login).

use tauri::{AppHandle, Runtime, WebviewWindow};

pub fn idle_ms() -> u64 {
    0
}

pub fn busy_reason() -> Option<&'static str> {
    None
}

pub fn screen_locked() -> bool {
    false
}

pub fn prepare_card_window<R: Runtime>(_window: &WebviewWindow<R>) {}

pub fn show_without_focus<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.show();
}

pub fn text_scale() -> f64 {
    1.0
}

pub fn remove_legacy_login_item() {}

pub fn login_item_enabled<R: Runtime>(_app: &AppHandle<R>) -> bool {
    false
}

pub fn set_login_item<R: Runtime>(_app: &AppHandle<R>, _enabled: bool) -> Result<(), String> {
    Err("starting at login isn't supported on this system".into())
}
