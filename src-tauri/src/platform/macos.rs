// macOS: idle time and a card window that doesn't steal focus.
//
// What's missing compared with Windows, plainly:
// - No quiet check: busy_reason() is always None, so Gino doesn't hold off during calls or
//   full-screen apps on macOS (the Electron version didn't either).
// - screen_locked() is always false. Idle time keeps growing while the screen is locked,
//   so a long lock still counts as a break.
// - Showing the card doesn't take focus: the app runs as an accessory (no Dock icon), and
//   showing a window doesn't activate an app that isn't already active. Clicking the card
//   does activate the app, like the Electron version on macOS.

#![allow(dead_code)]

use tauri::{Runtime, WebviewWindow};

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    // CFTimeInterval CGEventSourceSecondsSinceLastEventType(CGEventSourceStateID, CGEventType)
    fn CGEventSourceSecondsSinceLastEventType(source: i32, event_type: u32) -> f64;
}

const COMBINED_SESSION_STATE: i32 = 0; // kCGEventSourceStateCombinedSessionState
const ANY_INPUT_EVENT: u32 = !0; // kCGAnyInputEventType

/// How long the keyboard and mouse have been idle, in milliseconds.
pub fn idle_ms() -> u64 {
    let secs =
        unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) };
    if secs.is_finite() && secs > 0.0 {
        (secs * 1000.0) as u64
    } else {
        0
    }
}

/// macOS has no quiet check (yet).
pub fn busy_reason() -> Option<&'static str> {
    None
}

pub fn screen_locked() -> bool {
    false
}

/// Nothing to do: the card stays an ordinary window on macOS (see the top of this file).
pub fn prepare_card_window<R: Runtime>(_window: &WebviewWindow<R>) {}

pub fn show_without_focus<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.show();
}

pub fn remove_legacy_login_item() {}
