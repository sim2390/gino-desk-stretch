// settings.json and stats.json, in the same folder and format the Electron version used
// (%APPDATA%\Gino on Windows, ~/Library/Application Support/Gino on macOS), so nobody loses
// their settings or counts when they update.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::PathBuf;

const SETTINGS_FILE: &str = "settings.json";
const STATS_FILE: &str = "stats.json";

/// About three months of daily counts.
const KEEP_DAYS: usize = 90;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Active screen time between stretches.
    pub interval_min: u32,
    pub snooze_min: u32,
    /// Idle this long counts as a break and restarts the timer.
    pub idle_reset_min: u32,
    /// An ignored card snoozes itself after this long.
    pub auto_snooze_min: u32,
    /// Windows: hold reminders during calls and full-screen apps.
    pub wait_when_busy: bool,
    /// Where you last dragged the card. None = the corner of the main screen.
    pub card_pos: Option<SavedCardPos>,
    pub welcomed: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            interval_min: 20,
            snooze_min: 10,
            idle_reset_min: 5,
            auto_snooze_min: 4,
            wait_when_busy: true,
            card_pos: None,
            welcomed: false,
        }
    }
}

/// A saved card position. `unit` is the unit this version placed the card in: "physical"
/// pixels on Windows, "logical" points on macOS. The Electron version saved positions without
/// a unit, in other coordinates, and those are ignored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCardPos {
    pub x: i32,
    pub bottom: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Stats {
    /// Stretches done per day, keyed "YYYY-MM-DD" (local date).
    pub days: BTreeMap<String, u32>,
    /// Reminders shown so far: every third is the walkaround.
    pub reminders: u32,
    /// Position in the rotation of the other stretches.
    pub cycle: u32,
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Store { dir }
    }

    pub fn load_settings(&self) -> Settings {
        let mut s = Settings::default();
        if let Some(f) = self.read(SETTINGS_FILE) {
            f.take("intervalMin", &mut s.interval_min);
            f.take("snoozeMin", &mut s.snooze_min);
            f.take("idleResetMin", &mut s.idle_reset_min);
            f.take("autoSnoozeMin", &mut s.auto_snooze_min);
            f.take("waitWhenBusy", &mut s.wait_when_busy);
            f.take("cardPos", &mut s.card_pos);
            f.take("welcomed", &mut s.welcomed);
        }
        s
    }

    pub fn save_settings(&self, settings: &Settings) {
        self.write(SETTINGS_FILE, settings);
    }

    pub fn load_stats(&self) -> Stats {
        let mut s = Stats::default();
        if let Some(f) = self.read(STATS_FILE) {
            f.take("days", &mut s.days);
            f.take("reminders", &mut s.reminders);
            f.take("cycle", &mut s.cycle);
        }
        s
    }

    pub fn save_stats(&self, stats: &Stats) {
        self.write(STATS_FILE, stats);
    }

    /// The saved fields of one file. A missing file is a first run; one that isn't a JSON
    /// object is reported, and everything in it takes its default.
    fn read<'a>(&self, name: &'a str) -> Option<Fields<'a>> {
        let text = match fs::read_to_string(self.dir.join(name)) {
            Ok(text) => text,
            Err(e) if e.kind() == ErrorKind::NotFound => return None,
            Err(e) => {
                eprintln!("Could not read {name}, using the defaults: {e}");
                return None;
            }
        };
        // Notepad can save a byte-order mark, which JSON parsers reject.
        match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
            Ok(Value::Object(map)) => Some(Fields { file: name, map }),
            Ok(_) => {
                eprintln!("Could not read {name}, using the defaults: not a JSON object");
                None
            }
            Err(e) => {
                eprintln!("Could not read {name}, using the defaults: {e}");
                None
            }
        }
    }

    fn write<T: Serialize>(&self, name: &str, data: &T) {
        if let Err(e) = self.try_write(name, data) {
            eprintln!("Could not save {name}: {e}");
        }
    }

    /// Writes a temporary file next to the real one, then renames it over the real one,
    /// so a crash or power cut leaves either the old file or the new one, never half of one.
    fn try_write<T: Serialize>(&self, name: &str, data: &T) -> std::io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        let json = serde_json::to_string_pretty(data)?;
        let path = self.dir.join(name);
        let tmp = self.dir.join(format!("{name}.tmp"));
        let mut file = fs::File::create(&tmp)?;
        file.write_all(json.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, &path)
    }
}

/// One file's saved fields, taken one at a time like the Electron version's
/// `{ ...defaults, ...saved }`: a field that is missing or the wrong shape keeps its default
/// without taking the rest of the file with it, and unknown fields are skipped, so files
/// written by older or newer versions still load.
struct Fields<'a> {
    file: &'a str,
    map: Map<String, Value>,
}

impl Fields<'_> {
    fn take<T: DeserializeOwned>(&self, key: &str, slot: &mut T) {
        let Some(value) = self.map.get(key) else {
            return;
        };
        match T::deserialize(value) {
            Ok(v) => *slot = v,
            Err(e) => eprintln!("{}: ignoring {key}, which isn't valid ({e})", self.file),
        }
    }
}

/// Today's local date as "YYYY-MM-DD".
pub fn today_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

impl Stats {
    pub fn today_count(&self, today: &str) -> u32 {
        self.days.get(today).copied().unwrap_or(0)
    }

    /// Count a finished stretch today, keeping about three months of days.
    pub fn add_done(&mut self, today: &str) {
        let count = self.days.entry(today.to_string()).or_insert(0);
        *count = count.saturating_add(1);
        // The keys sort by date, so the oldest days come first.
        while self.days.len() > KEEP_DAYS {
            self.days.pop_first();
        }
    }

    /// The index of the next stretch: every third reminder is the walkaround (the first
    /// stretch whose flag is true), the rest rotate through the others.
    pub fn pick_next(&mut self, walk_flags: &[bool]) -> usize {
        let walk = walk_flags.iter().position(|&w| w);
        let others: Vec<usize> = (0..walk_flags.len()).filter(|&i| !walk_flags[i]).collect();
        let n = self.reminders;
        self.reminders = n.wrapping_add(1);
        if let Some(w) = walk {
            // A list with only the walkaround has nothing else to rotate through.
            if n % 3 == 2 || others.is_empty() {
                return w;
            }
        }
        if others.is_empty() {
            return 0; // no stretches at all: nothing sensible to pick, but no panic
        }
        let i = others[self.cycle as usize % others.len()];
        self.cycle = self.cycle.wrapping_add(1);
        i
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// A fresh, empty folder for one test, removed again when the test ends.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("gino-store-test-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            TempDir(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn write(&self, name: &str, text: &str) {
            fs::create_dir_all(&self.0).unwrap();
            fs::write(self.0.join(name), text).unwrap();
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn rotation_makes_every_third_reminder_the_walkaround() {
        // Five stretches, the third of them the walkaround.
        let flags = [false, false, true, false, false];
        let mut stats = Stats::default();
        let picks: Vec<usize> = (0..9).map(|_| stats.pick_next(&flags)).collect();
        assert_eq!(picks, [0, 1, 2, 3, 4, 2, 0, 1, 2]);
        assert_eq!(stats.reminders, 9);
        assert_eq!(stats.cycle, 6);
    }

    #[test]
    fn rotation_carries_on_from_saved_counters() {
        let flags = [false, false, true, false, false];
        let mut stats = Stats {
            reminders: 5,
            cycle: 3,
            ..Stats::default()
        };
        assert_eq!(stats.pick_next(&flags), 2);
        assert_eq!(stats.pick_next(&flags), 4);
        assert_eq!(stats.pick_next(&flags), 0);
    }

    #[test]
    fn rotation_without_a_walkaround_just_rotates() {
        let mut stats = Stats::default();
        let picks: Vec<usize> = (0..5).map(|_| stats.pick_next(&[false, false])).collect();
        assert_eq!(picks, [0, 1, 0, 1, 0]);
    }

    #[test]
    fn rotation_with_odd_lists_does_not_panic() {
        let mut stats = Stats::default();
        assert_eq!(stats.pick_next(&[]), 0);
        assert_eq!(stats.pick_next(&[true]), 0);
    }

    #[test]
    fn add_done_counts_today_and_keeps_the_last_90_days() {
        let mut stats = Stats::default();
        for month in 1..=4 {
            for day in 1..=25 {
                stats.days.insert(format!("2026-{month:02}-{day:02}"), 1);
            }
        }
        stats.add_done("2026-10-16");
        stats.add_done("2026-10-16");
        assert_eq!(stats.days.len(), 90);
        assert_eq!(stats.today_count("2026-10-16"), 2);
        // The 100 old days plus today: the 11 oldest went.
        assert_eq!(stats.days.keys().next().unwrap(), "2026-01-12");
        assert_eq!(stats.days.keys().last().unwrap(), "2026-10-16");
        assert_eq!(stats.today_count("2026-01-11"), 0);
    }

    #[test]
    fn today_key_is_a_local_date() {
        let key = today_key();
        assert_eq!(key.len(), 10, "{key}");
        for (i, c) in key.chars().enumerate() {
            if i == 4 || i == 7 {
                assert_eq!(c, '-', "{key}");
            } else {
                assert!(c.is_ascii_digit(), "{key}");
            }
        }
    }

    #[test]
    fn loads_the_electron_versions_files() {
        let dir = TempDir::new("electron");
        dir.write(
            SETTINGS_FILE,
            r#"{"intervalMin":20,"snoozeMin":10,"idleResetMin":5,"autoSnoozeMin":4,"waitWhenBusy":true,"cardPos":{"x":300,"bottom":600},"welcomed":true}"#,
        );
        dir.write(STATS_FILE, "{\n  \"days\": {\n    \"2026-10-15\": 4,\n    \"2026-10-16\": 3\n  },\n  \"reminders\": 17,\n  \"cycle\": 11\n}");
        let store = Store::new(dir.path().to_path_buf());

        let settings = store.load_settings();
        assert_eq!(
            settings,
            Settings {
                card_pos: Some(SavedCardPos {
                    x: 300,
                    bottom: 600,
                    unit: None
                }),
                welcomed: true,
                ..Settings::default()
            }
        );
        let stats = store.load_stats();
        assert_eq!(stats.today_count("2026-10-16"), 3);
        assert_eq!(stats.today_count("2026-10-15"), 4);
        assert_eq!((stats.reminders, stats.cycle), (17, 11));
    }

    #[test]
    fn missing_fields_take_defaults_and_unknown_ones_are_skipped() {
        let dir = TempDir::new("partial");
        dir.write(
            SETTINGS_FILE,
            r#"{"intervalMin":45,"cardPos":null,"someLaterSetting":[1,2]}"#,
        );
        dir.write(STATS_FILE, r#"{"reminders":2}"#);
        let store = Store::new(dir.path().to_path_buf());
        assert_eq!(
            store.load_settings(),
            Settings {
                interval_min: 45,
                ..Settings::default()
            }
        );
        assert_eq!(
            store.load_stats(),
            Stats {
                reminders: 2,
                ..Stats::default()
            }
        );
    }

    #[test]
    fn one_bad_field_keeps_its_default_and_the_rest_still_load() {
        let dir = TempDir::new("badfield");
        dir.write(
            SETTINGS_FILE,
            r#"{"intervalMin":"twenty","snoozeMin":-5,"waitWhenBusy":false,"welcomed":true,"cardPos":{"x":40,"bottom":900,"unit":"physical"}}"#,
        );
        dir.write(
            STATS_FILE,
            r#"{"days":{"2026-10-16":2},"reminders":"lots","cycle":7}"#,
        );
        let store = Store::new(dir.path().to_path_buf());
        assert_eq!(
            store.load_settings(),
            Settings {
                wait_when_busy: false,
                welcomed: true,
                card_pos: Some(SavedCardPos {
                    x: 40,
                    bottom: 900,
                    unit: Some("physical".into())
                }),
                ..Settings::default()
            }
        );
        let stats = store.load_stats();
        assert_eq!(
            (
                stats.today_count("2026-10-16"),
                stats.reminders,
                stats.cycle
            ),
            (2, 0, 7)
        );

        // A bad card position on its own just goes back to the corner.
        dir.write(SETTINGS_FILE, r#"{"welcomed":true,"cardPos":{"x":"left"}}"#);
        assert_eq!(
            store.load_settings(),
            Settings {
                welcomed: true,
                ..Settings::default()
            }
        );
    }

    #[test]
    fn a_file_that_isnt_an_object_gives_the_defaults() {
        let dir = TempDir::new("notobject");
        dir.write(SETTINGS_FILE, "[1, 2, 3]");
        dir.write(STATS_FILE, "\"stats\"");
        let store = Store::new(dir.path().to_path_buf());
        assert_eq!(store.load_settings(), Settings::default());
        assert_eq!(store.load_stats(), Stats::default());
    }

    #[test]
    fn every_field_saved_is_read_back() {
        let dir = TempDir::new("everyfield");
        let store = Store::new(dir.path().to_path_buf());
        let settings = Settings {
            interval_min: 45,
            snooze_min: 7,
            idle_reset_min: 3,
            auto_snooze_min: 2,
            wait_when_busy: false,
            card_pos: Some(SavedCardPos {
                x: 12,
                bottom: 34,
                unit: Some("logical".into()),
            }),
            welcomed: true,
        };
        let stats = Stats {
            days: BTreeMap::from([("2026-10-15".to_string(), 5)]),
            reminders: 9,
            cycle: 4,
        };
        store.save_settings(&settings);
        store.save_stats(&stats);
        assert_eq!(store.load_settings(), settings);
        assert_eq!(store.load_stats(), stats);
    }

    #[test]
    fn missing_files_give_the_defaults() {
        let dir = TempDir::new("missing");
        let store = Store::new(dir.path().to_path_buf());
        assert_eq!(store.load_settings(), Settings::default());
        assert_eq!(store.load_stats(), Stats::default());
    }

    #[test]
    fn broken_files_give_the_defaults() {
        let dir = TempDir::new("garbage");
        dir.write(SETTINGS_FILE, "{\"intervalMin\": 30, oops");
        dir.write(STATS_FILE, "\u{0}\u{1}not json at all");
        let store = Store::new(dir.path().to_path_buf());
        assert_eq!(store.load_settings(), Settings::default());
        assert_eq!(store.load_stats(), Stats::default());
    }

    #[test]
    fn a_byte_order_mark_is_fine() {
        let dir = TempDir::new("bom");
        dir.write(SETTINGS_FILE, "\u{feff}{\"snoozeMin\":5}");
        let store = Store::new(dir.path().to_path_buf());
        assert_eq!(store.load_settings().snooze_min, 5);
    }

    #[test]
    fn saves_and_loads_back_creating_the_folder() {
        let dir = TempDir::new("roundtrip");
        // A folder that doesn't exist yet, two levels down.
        let store = Store::new(dir.path().join("nested").join("Gino"));
        let settings = Settings {
            interval_min: 30,
            wait_when_busy: false,
            card_pos: Some(SavedCardPos {
                x: -2400,
                bottom: 1500,
                unit: Some("physical".into()),
            }),
            welcomed: true,
            ..Settings::default()
        };
        let mut stats = Stats::default();
        stats.add_done("2026-10-16");
        stats.pick_next(&[false, true]);
        store.save_settings(&settings);
        store.save_stats(&stats);

        assert_eq!(store.load_settings(), settings);
        assert_eq!(store.load_stats(), stats);

        // Same field names and layout as the Electron version, and no temp files left behind.
        let text = fs::read_to_string(store.dir.join(SETTINGS_FILE)).unwrap();
        assert!(
            text.starts_with("{\n  \"intervalMin\": 30,\n  \"snoozeMin\": 10,"),
            "{text}"
        );
        assert!(text.contains("\n  \"cardPos\": {\n    \"x\": -2400,\n    \"bottom\": 1500,\n    \"unit\": \"physical\"\n  },"), "{text}");
        let stats_text = fs::read_to_string(store.dir.join(STATS_FILE)).unwrap();
        assert_eq!(
            stats_text,
            "{\n  \"days\": {\n    \"2026-10-16\": 1\n  },\n  \"reminders\": 1,\n  \"cycle\": 1\n}"
        );
        let names: Vec<_> = fs::read_dir(&store.dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 2, "{names:?}");
    }

    #[test]
    fn saving_over_an_existing_file_replaces_it() {
        let dir = TempDir::new("overwrite");
        let store = Store::new(dir.path().to_path_buf());
        store.save_settings(&Settings {
            interval_min: 15,
            ..Settings::default()
        });
        store.save_settings(&Settings {
            interval_min: 60,
            ..Settings::default()
        });
        assert_eq!(store.load_settings().interval_min, 60);
        let text = fs::read_to_string(dir.path().join(SETTINGS_FILE)).unwrap();
        assert!(text.contains("\"cardPos\": null"), "{text}");
    }
}
