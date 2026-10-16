// Other systems: Gino isn't packaged for them, but the app still builds and runs with
// these defaults (never idle, never busy).

#![allow(dead_code)]

use tauri::{Runtime, WebviewWindow};

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

pub fn remove_legacy_login_item() {}
