// What Gino needs from the operating system. Windows and macOS each implement the same
// functions; other systems get harmless defaults so the app still builds and runs.
//
//   idle_ms()                    how long the keyboard and mouse have been idle
//   busy_reason()                why now is a bad moment (a call, a full-screen app...), or None
//   screen_locked()              the screen is locked or the screen saver is on
//   prepare_card_window(w)       make the card window never take keyboard focus
//   show_without_focus(w)        show the card window without activating it
//   text_scale()                 how much bigger than the screen's scale the web view draws (text size)
//   remove_legacy_login_item()   drop the start-at-login entry the Electron version left behind
//   login_item_enabled(app)      "Start with Windows" / "Open at login" is on
//   set_login_item(app, on)      switch it on or off

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use self::macos::*;

#[cfg(not(any(windows, target_os = "macos")))]
mod other;
#[cfg(not(any(windows, target_os = "macos")))]
pub use self::other::*;
