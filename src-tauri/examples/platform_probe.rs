// Prints what the platform layer reports on this machine: idle time, the quiet check and
// the lock state. Leave the mouse alone and idle_ms should keep growing.
//
//   cargo run --manifest-path src-tauri/Cargo.toml --example platform_probe -- [times] [seconds]

// The probe calls only the three read-outs; the card window and login item parts go unused.
#[allow(dead_code)]
#[path = "../src/platform/mod.rs"]
mod platform;

fn main() {
    let mut args = std::env::args().skip(1).map(|a| a.parse::<u64>().ok());
    let times = args.next().flatten().unwrap_or(1).max(1);
    let every = args.next().flatten().unwrap_or(2);
    for i in 0..times {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_secs(every));
        }
        println!(
            "idle_ms={} busy_reason={:?} screen_locked={}",
            platform::idle_ms(),
            platform::busy_reason(),
            platform::screen_locked()
        );
    }
}
