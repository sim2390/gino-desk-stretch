// Windows: idle time, the "is now a bad moment?" check, and a card window that never takes focus.

#![allow(dead_code)]

use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use tauri::{Runtime, WebviewWindow};
use windows_sys::Win32::Foundation::{ERROR_SUCCESS, HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY,
    HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_READ, KEY_SET_VALUE, REG_SAM_FLAGS, RRF_NOEXPAND,
    RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_QWORD, RRF_RT_REG_SZ,
};
use windows_sys::Win32::System::SystemInformation::GetTickCount;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows_sys::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_APP, QUNS_BUSY, QUNS_NOT_PRESENT, QUNS_PRESENTATION_MODE,
    QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetWindowLongW, GetWindowThreadProcessId, SetWindowLongW, SetWindowPos,
    SetWindowsHookExW, ShowWindow, GWL_EXSTYLE, HCBT_ACTIVATE, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WH_CBT, WS_EX_NOACTIVATE,
};

// ---------- idle time ----------

/// How long the keyboard and mouse have been idle, in milliseconds.
pub fn idle_ms() -> u64 {
    let mut info = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return 0;
    }
    // Both are milliseconds since boot in a u32 that wraps every 49.7 days. The wrapping
    // difference is still right when the counter wrapped in between.
    u64::from(unsafe { GetTickCount() }.wrapping_sub(info.dwTime))
}

// ---------- "is now a bad moment?" ----------

// Windows records, per app, when it last started and stopped using the microphone.
// Started but not yet stopped means the mic is open right now, which almost always means a call.
const MIC_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

/// Why now is a bad moment for a stretch, in the words the tray tooltip shows after
/// "Holding off: " ("you seem to be on a call", "full-screen app", "full-screen game",
/// "presentation mode", "screen locked"), or None.
pub fn busy_reason() -> Option<&'static str> {
    if mic_in_use() {
        return Some("you seem to be on a call");
    }
    // The same signal Windows uses to hold back its own notifications. If the check
    // fails, don't block reminders.
    match notification_state()? {
        QUNS_NOT_PRESENT => Some("screen locked"),
        QUNS_BUSY | QUNS_APP => Some("full-screen app"),
        QUNS_RUNNING_D3D_FULL_SCREEN => Some("full-screen game"),
        QUNS_PRESENTATION_MODE => Some("presentation mode"),
        _ => None,
    }
}

/// The screen is locked, or the screen saver is on.
pub fn screen_locked() -> bool {
    notification_state() == Some(QUNS_NOT_PRESENT)
}

fn notification_state() -> Option<i32> {
    let mut state = 0;
    let hr = unsafe { SHQueryUserNotificationState(&mut state) };
    (hr >= 0).then_some(state)
}

fn mic_in_use() -> bool {
    // Store apps sit right under the key, desktop apps under NonPackaged; look a bit deeper
    // than that in case Windows nests them further one day.
    Key::open(HKEY_CURRENT_USER, MIC_KEY, KEY_READ).is_some_and(|k| any_app_on_mic(&k, 3))
}

fn any_app_on_mic(key: &Key, depth: u32) -> bool {
    key.subkeys().any(|sub| {
        let started = sub.qword("LastUsedTimeStart").unwrap_or(0) != 0;
        (started && sub.qword("LastUsedTimeStop") == Some(0))
            || (depth > 1 && any_app_on_mic(&sub, depth - 1))
    })
}

// ---------- the card window ----------

// The card's window handle, for the activation hook below.
static CARD: AtomicUsize = AtomicUsize::new(0);
static HOOKED: AtomicBool = AtomicBool::new(false);

/// Make the card window never take keyboard focus (clicks still work).
pub fn prepare_card_window<R: Runtime>(window: &WebviewWindow<R>) {
    // Tauri rewrites the extended style each time it shows or hides a window. Telling it the
    // card isn't focusable makes it keep WS_EX_NOACTIVATE in every rewrite.
    let _ = window.set_focusable(false);
    let Some(hwnd) = hwnd_of(window) else { return };
    // And set it right away: off the main thread, Tauri applies set_focusable a bit later.
    unsafe {
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        SetWindowLongW(hwnd, GWL_EXSTYLE, (ex | WS_EX_NOACTIVATE) as i32);
    }
    CARD.store(hwnd as usize, Ordering::Relaxed);

    // WS_EX_NOACTIVATE only stops clicks from activating the card. Tauri's show() uses
    // ShowWindow(SW_SHOW), which activates it anyway (and can take the foreground once the
    // user has been still for a few minutes), so refuse that in a hook on the card's thread.
    let thread = unsafe { GetWindowThreadProcessId(hwnd, null_mut()) };
    // Thread 0 would mean a system-wide hook: never ask for that.
    if thread != 0 && !HOOKED.swap(true, Ordering::Relaxed) {
        let hook = unsafe {
            SetWindowsHookExW(WH_CBT, Some(refuse_card_activation), null_mut(), thread)
        };
        if hook.is_null() {
            HOOKED.store(false, Ordering::Relaxed);
        }
    }
}

/// Show the card window on top without activating it.
pub fn show_without_focus<R: Runtime>(window: &WebviewWindow<R>) {
    let w = window.clone();
    // On the main thread, so Tauri's show and ours happen in this order.
    let _ = window.run_on_main_thread(move || {
        // Tauri's own show() first: Tauri skips hiding a window it thinks is hidden, so a card
        // shown only behind its back would ignore hide(). The hook keeps this from activating.
        let _ = w.show();
        let Some(hwnd) = hwnd_of(&w) else { return };
        unsafe {
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
        }
    });
}

fn hwnd_of<R: Runtime>(window: &WebviewWindow<R>) -> Option<HWND> {
    window.hwnd().ok().map(|h| h.0)
}

// Windows asks this before activating any window on the card's thread; a non-zero answer
// refuses. Only the card is refused: the tray menu needs to activate its own window.
unsafe extern "system" fn refuse_card_activation(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code == HCBT_ACTIVATE as i32 && wparam != 0 && wparam == CARD.load(Ordering::Relaxed) {
        return 1;
    }
    CallNextHookEx(null_mut(), code, wparam, lparam)
}

// ---------- the Electron version's login item ----------

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const LEGACY_RUN_VALUE: &str = "com.gino.stretch";

/// Remove the HKCU Run entry the Electron version may have left behind.
pub fn remove_legacy_login_item() {
    let Some(run) = Key::open(HKEY_CURRENT_USER, RUN_KEY, KEY_QUERY_VALUE | KEY_SET_VALUE) else {
        return;
    };
    // Only an entry that starts Electron Gino: leave anything else under that name alone.
    if run.string(LEGACY_RUN_VALUE).is_some_and(|cmd| is_electron_gino(&cmd)) {
        let name = wide(LEGACY_RUN_VALUE);
        unsafe { RegDeleteValueW(run.0, name.as_ptr()) };
    }
}

fn is_electron_gino(command: &str) -> bool {
    let c = command.to_lowercase();
    c.contains("electron.exe") || c.contains(r"\programs\gino\")
}

// ---------- registry helpers ----------

/// An open registry key, closed when dropped.
struct Key(HKEY);

impl Key {
    fn open(parent: HKEY, path: &str, access: REG_SAM_FLAGS) -> Option<Key> {
        Self::open_wide(parent, &wide(path), access)
    }

    fn open_wide(parent: HKEY, path: &[u16], access: REG_SAM_FLAGS) -> Option<Key> {
        let mut key: HKEY = null_mut();
        let rc = unsafe { RegOpenKeyExW(parent, path.as_ptr(), 0, access, &mut key) };
        (rc == ERROR_SUCCESS).then(|| Key(key))
    }

    /// The subkeys that could be opened for reading.
    fn subkeys(&self) -> impl Iterator<Item = Key> + '_ {
        (0u32..)
            .map_while(move |i| {
                // Key names are at most 255 characters.
                let mut name = [0u16; 256];
                let mut len = name.len() as u32;
                let rc = unsafe {
                    RegEnumKeyExW(
                        self.0,
                        i,
                        name.as_mut_ptr(),
                        &mut len,
                        null(),
                        null_mut(),
                        null_mut(),
                        null_mut(),
                    )
                };
                // Anything but success (no more items, or the key went away) ends the list.
                (rc == ERROR_SUCCESS).then(|| name[..=len as usize].to_vec())
            })
            .filter_map(move |name| Key::open_wide(self.0, &name, KEY_READ))
    }

    fn qword(&self, value: &str) -> Option<u64> {
        let value = wide(value);
        let mut data = 0u64;
        let mut size = size_of::<u64>() as u32;
        let rc = unsafe {
            RegGetValueW(
                self.0,
                null(),
                value.as_ptr(),
                RRF_RT_REG_QWORD,
                null_mut(),
                &mut data as *mut u64 as *mut c_void,
                &mut size,
            )
        };
        (rc == ERROR_SUCCESS).then_some(data)
    }

    fn string(&self, value: &str) -> Option<String> {
        let value = wide(value);
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;
        let mut size = 0u32;
        let rc = unsafe {
            RegGetValueW(self.0, null(), value.as_ptr(), flags, null_mut(), null_mut(), &mut size)
        };
        if rc != ERROR_SUCCESS {
            return None;
        }
        let mut buf = vec![0u16; size as usize / 2 + 1];
        let mut size = (buf.len() * 2) as u32;
        let rc = unsafe {
            RegGetValueW(
                self.0,
                null(),
                value.as_ptr(),
                flags,
                null_mut(),
                buf.as_mut_ptr() as *mut c_void,
                &mut size,
            )
        };
        if rc != ERROR_SUCCESS {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..end]))
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        unsafe { RegCloseKey(self.0) };
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spots_the_electron_login_item() {
        assert!(is_electron_gino(
            r#""C:\Users\me\gino\node_modules\electron\dist\electron.exe" "C:\Users\me\gino""#
        ));
        assert!(is_electron_gino(r#""C:\Users\me\AppData\Local\Programs\gino\Gino.exe""#));
        assert!(is_electron_gino(r#"C:\USERS\ME\APPDATA\LOCAL\PROGRAMS\GINO\GINO.EXE"#));
        assert!(!is_electron_gino(r#""C:\Users\me\AppData\Local\Gino\gino.exe""#));
        assert!(!is_electron_gino(""));
    }

    // Prints what this machine reports right now:
    //   cargo test --lib platform -- --ignored --nocapture
    #[test]
    #[ignore]
    fn probe() {
        let (idle, busy, locked) = (idle_ms(), busy_reason(), screen_locked());
        println!("idle_ms={idle} busy_reason={busy:?} screen_locked={locked}");
    }}
