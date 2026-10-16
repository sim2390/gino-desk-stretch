// Windows: idle time, the "is now a bad moment?" check, a card window that never takes focus,
// the text size the card is drawn at, and "Start with Windows".

use std::ffi::{c_void, OsStr};
use std::mem::size_of;
use std::os::windows::ffi::OsStrExt;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use tauri::{AppHandle, Runtime, WebviewWindow};
use windows_sys::Win32::Foundation::{
    ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, HWND, LPARAM, LRESULT, WIN32_ERROR, WPARAM,
};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegDeleteKeyValueW, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, RegSetKeyValueW,
    HKEY, HKEY_CURRENT_USER, KEY_READ, REG_ROUTINE_FLAGS, REG_SZ, REG_VALUE_TYPE, RRF_NOEXPAND,
    RRF_RT_REG_BINARY, RRF_RT_REG_DWORD, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_QWORD, RRF_RT_REG_SZ,
};
use windows_sys::Win32::System::SystemInformation::GetTickCount;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows_sys::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_APP, QUNS_BUSY, QUNS_NOT_PRESENT, QUNS_PRESENTATION_MODE,
    QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetWindowThreadProcessId, SetWindowPos, SetWindowsHookExW, ShowWindow,
    HCBT_ACTIVATE, HCBT_DESTROYWND, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WH_CBT,
};

// ---------- idle time ----------

/// How long the keyboard and mouse have been idle, in milliseconds.
pub fn idle_ms() -> u64 {
    let mut info = LASTINPUTINFO {
        cbSize: size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
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
    Key::open(HKEY_CURRENT_USER, MIC_KEY).is_some_and(|k| any_app_on_mic(&k, 3))
}

fn any_app_on_mic(key: &Key, depth: u32) -> bool {
    key.subkeys().any(|sub| {
        let started = sub.qword("LastUsedTimeStart").unwrap_or(0) != 0;
        (started && sub.qword("LastUsedTimeStop") == Some(0))
            || (depth > 1 && any_app_on_mic(&sub, depth - 1))
    })
}

// ---------- the card window ----------

// The card's window handle, for the activation hook below; 0 when there's no card window.
static CARD: AtomicUsize = AtomicUsize::new(0);
static HOOKED: AtomicBool = AtomicBool::new(false);

/// Make the card window never take keyboard focus (clicks still work). The card is built
/// with `focusable(false)`, so it has WS_EX_NOACTIVATE from the start and keeps it each time
/// Tauri rewrites the style; this adds the guard against being shown active.
pub fn prepare_card_window<R: Runtime>(window: &WebviewWindow<R>) {
    if let Some(hwnd) = hwnd_of(window) {
        guard_card(hwnd);
    }
}

/// WS_EX_NOACTIVATE only stops clicks from activating the card. Tauri's show() uses
/// ShowWindow(SW_SHOW), which activates it anyway (and can take the foreground once the
/// user has been still for a few minutes), so refuse that in a hook on the card's thread.
/// Each new card window takes over from the last; the hook is set up only once.
fn guard_card(hwnd: HWND) {
    CARD.store(hwnd as usize, Ordering::Relaxed);
    let thread = unsafe { GetWindowThreadProcessId(hwnd, null_mut()) };
    // Thread 0 would mean a system-wide hook: never ask for that. Every card window is
    // made on the main thread, so the first one's thread is the one to watch.
    if thread != 0 && !HOOKED.swap(true, Ordering::Relaxed) {
        let hook = unsafe { SetWindowsHookExW(WH_CBT, Some(card_hook), null_mut(), thread) };
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

/// Windows' text size (Settings > Accessibility > Text size) as a factor, 1.0 to 2.25.
/// WebView2 draws pages that much bigger on top of the screen's scale, so the card window
/// has to be that much bigger too. Read each time: it can change while Gino runs.
pub fn text_scale() -> f64 {
    text_scale_from(hkcu_dword(ACCESSIBILITY_KEY, "TextScaleFactor"))
}

const ACCESSIBILITY_KEY: &str = r"Software\Microsoft\Accessibility";

/// The registry's percentage as a factor. No value means 100%; Settings only offers 100 to 225.
fn text_scale_from(percent: Option<u32>) -> f64 {
    f64::from(percent.unwrap_or(100).clamp(100, 225)) / 100.0
}

fn hwnd_of<R: Runtime>(window: &WebviewWindow<R>) -> Option<HWND> {
    window.hwnd().ok().map(|h| h.0)
}

// Windows calls this before activating or destroying any window on the card's thread.
// Refusing (non-zero) an activation of the card keeps it inactive; only the card, since
// the tray menu needs to activate its own window. When the card window is destroyed its
// handle is forgotten: Windows can reuse the number for an unrelated window later.
unsafe extern "system" fn card_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let card = CARD.load(Ordering::Relaxed);
    if card != 0 && wparam == card {
        match code as u32 {
            HCBT_ACTIVATE => return 1,
            HCBT_DESTROYWND => {
                let _ = CARD.compare_exchange(card, 0, Ordering::Relaxed, Ordering::Relaxed);
            }
            _ => {}
        }
    }
    CallNextHookEx(null_mut(), code, wparam, lparam)
}

// ---------- start with Windows ----------

// Gino writes its own Run value. The autostart plugin writes the exe path without quotes
// (broken, and risky, when the user name has a space) and leaves Task Manager's switch
// behind when turned off. The installer (windows/hooks.nsh) writes the same value when it
// carries the setting over: the quoted path to gino.exe and nothing after it.
//
// The tray's "Start with Windows" item is the only thing that writes it. From `cargo run`
// that's the dev build's path, which is fine for trying it out; test runs (GINO_DATA_DIR)
// must not click it, or they change the real entry.
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const LOGIN_VALUE: &str = "Gino";
// Task Manager's on/off switch (Startup apps) for each Run value.
const STARTUP_APPROVED_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const STRING: REG_ROUTINE_FLAGS = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;

/// "Start with Windows" is on: the Run value is there and not switched off in Task Manager.
pub fn login_item_enabled<R: Runtime>(_app: &AppHandle<R>) -> bool {
    login_enabled(LOGIN_VALUE)
}

/// Switch "Start with Windows" on (for this gino.exe) or off.
pub fn set_login_item<R: Runtime>(_app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("can't find gino.exe: {e}"))?;
    set_login(LOGIN_VALUE, exe.as_os_str(), enabled)
}

fn login_enabled(name: &str) -> bool {
    hkcu_value(RUN_KEY, name, STRING).is_some() && !switched_off(name)
}

fn switched_off(name: &str) -> bool {
    hkcu_value(STARTUP_APPROVED_KEY, name, RRF_RT_REG_BINARY).is_some_and(|d| approved_off(&d))
}

/// Task Manager keeps 12 bytes per entry: the first is 2 when on, 3 when off (then the time
/// it was switched off). Odd means off; no value, or an empty one, means on.
fn approved_off(data: &[u8]) -> bool {
    data.first().is_some_and(|b| b & 1 == 1)
}

fn set_login(name: &str, exe: &OsStr, enabled: bool) -> Result<(), String> {
    if enabled {
        let data: Vec<u8> = run_command(exe)
            .iter()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        set_hkcu_value(RUN_KEY, name, REG_SZ, &data)?;
        // Switched off in Task Manager, it still wouldn't start: clear that so the tick counts.
        if switched_off(name) {
            delete_hkcu_value(STARTUP_APPROVED_KEY, name)?;
        }
        Ok(())
    } else {
        delete_hkcu_value(RUN_KEY, name)?;
        delete_hkcu_value(STARTUP_APPROVED_KEY, name)
    }
}

/// The Run value's text: the exe's path in quotes, so a space in it can't split the command.
/// UTF-16 with the closing NUL, as the registry stores it.
fn run_command(exe: &OsStr) -> Vec<u16> {
    let quote = u16::from(b'"');
    std::iter::once(quote)
        .chain(exe.encode_wide())
        .chain([quote, 0])
        .collect()
}

// ---------- the Electron version's login item ----------

const LEGACY_RUN_VALUE: &str = "com.gino.stretch";

/// Remove the HKCU Run entry the Electron version may have left behind.
pub fn remove_legacy_login_item() {
    // Only an entry that starts Electron Gino: leave anything else under that name alone.
    let command = hkcu_value(RUN_KEY, LEGACY_RUN_VALUE, STRING).map(|d| utf16_text(&d));
    if command.is_some_and(|c| is_electron_gino(&c)) {
        let _ = delete_hkcu_value(RUN_KEY, LEGACY_RUN_VALUE);
    }
}

fn is_electron_gino(command: &str) -> bool {
    let c = command.to_lowercase();
    c.contains("electron.exe") || c.contains(r"\programs\gino\")
}

// ---------- registry helpers ----------

/// A value under HKEY_CURRENT_USER\`path`, as raw bytes; None if it isn't there or isn't
/// one of the types `flags` allows.
fn hkcu_value(path: &str, value: &str, flags: REG_ROUTINE_FLAGS) -> Option<Vec<u8>> {
    let (path, value) = (wide(path), wide(value));
    let get = |data: *mut c_void, size: &mut u32| unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            path.as_ptr(),
            value.as_ptr(),
            flags,
            null_mut(),
            data,
            size,
        )
    };
    let mut size = 0u32;
    if get(null_mut(), &mut size) != ERROR_SUCCESS {
        return None;
    }
    let mut data = vec![0u8; size as usize];
    if get(data.as_mut_ptr().cast(), &mut size) != ERROR_SUCCESS {
        return None;
    }
    data.truncate(size as usize);
    Some(data)
}

/// A DWORD value under HKEY_CURRENT_USER\`path`.
fn hkcu_dword(path: &str, value: &str) -> Option<u32> {
    let data = hkcu_value(path, value, RRF_RT_REG_DWORD)?;
    Some(u32::from_le_bytes(data.get(..4)?.try_into().ok()?))
}

/// Write a value under HKEY_CURRENT_USER\`path`.
fn set_hkcu_value(
    path: &str,
    value: &str,
    kind: REG_VALUE_TYPE,
    data: &[u8],
) -> Result<(), String> {
    let (wpath, wvalue) = (wide(path), wide(value));
    let rc = unsafe {
        RegSetKeyValueW(
            HKEY_CURRENT_USER,
            wpath.as_ptr(),
            wvalue.as_ptr(),
            kind,
            data.as_ptr().cast(),
            data.len() as u32,
        )
    };
    reg_result(rc, "write", path, value)
}

/// Delete a value under HKEY_CURRENT_USER\`path`. Already gone counts as done.
fn delete_hkcu_value(path: &str, value: &str) -> Result<(), String> {
    let (wpath, wvalue) = (wide(path), wide(value));
    let rc = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, wpath.as_ptr(), wvalue.as_ptr()) };
    if rc == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    reg_result(rc, "delete", path, value)
}

fn reg_result(rc: WIN32_ERROR, what: &str, path: &str, value: &str) -> Result<(), String> {
    if rc == ERROR_SUCCESS {
        return Ok(());
    }
    let why = std::io::Error::from_raw_os_error(rc as i32);
    Err(format!("can't {what} {path}\\{value}: {why}"))
}

/// Registry text (UTF-16 bytes) up to its first NUL.
fn utf16_text(data: &[u8]) -> String {
    let units: Vec<u16> = data
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&c| u16::from_le_bytes(c))
        .take_while(|&c| c != 0)
        .collect();
    String::from_utf16_lossy(&units)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// An open registry key (read only), closed when dropped.
struct Key(HKEY);

impl Key {
    fn open(parent: HKEY, path: &str) -> Option<Key> {
        Self::open_wide(parent, &wide(path))
    }

    fn open_wide(parent: HKEY, path: &[u16]) -> Option<Key> {
        let mut key: HKEY = null_mut();
        let rc = unsafe { RegOpenKeyExW(parent, path.as_ptr(), 0, KEY_READ, &mut key) };
        (rc == ERROR_SUCCESS).then_some(Key(key))
    }

    /// The subkeys that could be opened.
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
            .filter_map(move |name| Key::open_wide(self.0, &name))
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
                (&mut data as *mut u64).cast(),
                &mut size,
            )
        };
        (rc == ERROR_SUCCESS).then_some(data)
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        unsafe { RegCloseKey(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::System::Registry::REG_BINARY;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetActiveWindow;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, SW_SHOW, WS_POPUP,
    };

    #[test]
    fn spots_the_electron_login_item() {
        assert!(is_electron_gino(
            r#""C:\Users\me\gino\node_modules\electron\dist\electron.exe" "C:\Users\me\gino""#
        ));
        assert!(is_electron_gino(
            r#""C:\Users\me\AppData\Local\Programs\gino\Gino.exe""#
        ));
        assert!(is_electron_gino(
            r#"C:\USERS\ME\APPDATA\LOCAL\PROGRAMS\GINO\GINO.EXE"#
        ));
        assert!(!is_electron_gino(
            r#""C:\Users\me\AppData\Local\Gino\gino.exe""#
        ));
        assert!(!is_electron_gino(""));
    }

    #[test]
    fn reads_task_managers_switch() {
        let off_since = [3, 0, 0, 0, 0x10, 0x2f, 0x5c, 0x41, 0x7e, 0x3e, 0xdb, 0x01];
        assert!(approved_off(&off_since));
        assert!(!approved_off(&[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        // Some Windows versions use 6 / 7: still even on, odd off.
        assert!(!approved_off(&[6, 0, 0, 0]));
        assert!(approved_off(&[7, 0, 0, 0]));
        assert!(!approved_off(&[]));
    }

    #[test]
    fn quotes_the_path_so_a_space_cannot_split_it() {
        let exe = OsStr::new(r"C:\Users\John Smith\AppData\Local\Gino\gino.exe");
        let expected = wide(r#""C:\Users\John Smith\AppData\Local\Gino\gino.exe""#);
        assert_eq!(run_command(exe), expected);
        // The same bytes the installer writes, read back as text.
        let bytes: Vec<u8> = run_command(exe)
            .iter()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        assert_eq!(
            utf16_text(&bytes),
            r#""C:\Users\John Smith\AppData\Local\Gino\gino.exe""#
        );
    }

    #[test]
    fn text_size_is_a_factor_from_100_to_225_percent() {
        assert_eq!(text_scale_from(None), 1.0);
        assert_eq!(text_scale_from(Some(100)), 1.0);
        assert_eq!(text_scale_from(Some(114)), 1.14);
        assert_eq!(text_scale_from(Some(225)), 2.25);
        // Values Settings never writes stay in its range.
        assert_eq!(text_scale_from(Some(0)), 1.0);
        assert_eq!(text_scale_from(Some(1000)), 2.25);
        // This user's real setting (read only) is somewhere in that range.
        assert!((1.0..=2.25).contains(&text_scale()));
    }

    /// Removes the test's values even if an assertion fails half way.
    struct Cleanup(&'static str);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = delete_hkcu_value(RUN_KEY, self.0);
            let _ = delete_hkcu_value(STARTUP_APPROVED_KEY, self.0);
        }
    }

    // Writes to this user's real Run key, under a test name (never "Gino" or
    // "com.gino.stretch"), pointing at a program that doesn't exist. Run it on purpose:
    //   cargo test --lib login -- --ignored
    #[test]
    #[ignore]
    fn login_item_round_trip_in_the_real_registry() {
        const NAME: &str = "GinoLoginItemTest";
        let real = |v: &str| {
            (
                hkcu_value(RUN_KEY, v, STRING),
                hkcu_value(STARTUP_APPROVED_KEY, v, RRF_RT_REG_BINARY),
            )
        };
        let before = (real(LOGIN_VALUE), real(LEGACY_RUN_VALUE));
        let exe = OsStr::new(r"C:\Gino Login Test\does-not-exist.exe");
        let _cleanup = Cleanup(NAME);
        delete_hkcu_value(RUN_KEY, NAME).unwrap();
        delete_hkcu_value(STARTUP_APPROVED_KEY, NAME).unwrap();
        assert!(!login_enabled(NAME));

        set_login(NAME, exe, true).unwrap();
        let text = hkcu_value(RUN_KEY, NAME, STRING).map(|d| utf16_text(&d));
        assert_eq!(
            text.as_deref(),
            Some(r#""C:\Gino Login Test\does-not-exist.exe""#)
        );
        assert!(login_enabled(NAME));

        // Switched off in Task Manager.
        let off = [3, 0, 0, 0, 0x10, 0x2f, 0x5c, 0x41, 0x7e, 0x3e, 0xdb, 0x01];
        set_hkcu_value(STARTUP_APPROVED_KEY, NAME, REG_BINARY, &off).unwrap();
        assert!(!login_enabled(NAME));

        // Ticking it again really turns it on.
        set_login(NAME, exe, true).unwrap();
        assert!(hkcu_value(STARTUP_APPROVED_KEY, NAME, RRF_RT_REG_BINARY).is_none());
        assert!(login_enabled(NAME));

        // Switched on in Task Manager is fine as it is.
        let on = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        set_hkcu_value(STARTUP_APPROVED_KEY, NAME, REG_BINARY, &on).unwrap();
        assert!(login_enabled(NAME));

        // Off leaves nothing behind, and twice is fine.
        set_login(NAME, exe, false).unwrap();
        set_login(NAME, exe, false).unwrap();
        assert!(!login_enabled(NAME));
        assert_eq!(real(NAME), (None, None));

        assert_eq!((real(LOGIN_VALUE), real(LEGACY_RUN_VALUE)), before);
    }

    #[test]
    fn the_hook_keeps_the_card_inactive_and_forgets_it_once_destroyed() {
        let class = wide("STATIC");
        // A 1x1 popup off screen, on this thread.
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                null(),
                WS_POPUP,
                -100,
                -100,
                1,
                1,
                null_mut(),
                null_mut(),
                null_mut(),
                null(),
            )
        };
        assert!(!hwnd.is_null());
        guard_card(hwnd);
        assert_eq!(CARD.load(Ordering::Relaxed), hwnd as usize);
        unsafe { ShowWindow(hwnd, SW_SHOW) };
        assert_ne!(unsafe { GetActiveWindow() }, hwnd);
        unsafe { DestroyWindow(hwnd) };
        assert_eq!(CARD.load(Ordering::Relaxed), 0);
    }
}
