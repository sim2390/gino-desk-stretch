# Changelog

## 0.3.0 (16 October 2026)

- **Much smaller and lighter.** On Windows the download is now about 3 MB instead of about 100 MB,
  and Gino takes about 4 MB once installed instead of about 370 MB. While he waits he uses about
  6 MB of memory, and about 110 MB only while a card is on screen (0.2 used about 136 MB all the
  time). He now uses the web engine your computer already has
  (Microsoft Edge WebView2 on Windows, the system's own on macOS) instead of bringing his own.
- **The old version is replaced for you.** On Windows, just run the new installer: it closes and
  removes Gino 0.2, clears out the old version's browser caches, and keeps your settings, your counts
  and **Start with Windows**. It installs for you alone, so it needs no admin rights. On a Mac, quit
  Gino and drag the new one into Applications.
- **Nothing else changes.** Same stretches, same card, same menu. A few small details differ, below.

### Small differences

- If you had dragged the card somewhere, it starts in its corner once after the update. Drag it back
  and Gino remembers it again.
- Starting Gino while he's already running shows his welcome card, which says where he lives,
  instead of opening his menu.
- On Windows, the check for calls and full-screen apps asks Windows directly, instead of starting
  PowerShell in the background.
- There's no portable Windows version any more, just the installer.
- On a Mac, the first open goes through **System Settings › Privacy & Security › Open Anyway**.
- On a Mac, Gino's body doesn't bend during chin tucks and thoracic extension; the rest of each move
  plays.
- On a Mac, times in the menu, such as *Paused until 15:30*, are always on a 24-hour clock.
- On a Mac, locking the screen counts as a break once it has been locked for 5 minutes, instead of
  straight away.

### For developers

- Gino is now a [Tauri 2](https://v2.tauri.app) app. The tray, the timer, the quiet check and the
  card window are Rust, in `src-tauri/`. The card is the same TypeScript, shown in the system's web
  view, and talks to Rust through `src/bridge.ts`.
- The card window is made for each card and destroyed afterwards, so the web view only runs while a
  card is up. On Windows it runs with background networking off, so Gino still never connects to
  the internet.
- The Windows installer carries Microsoft's signed WebView2 bootstrapper instead of downloading it.
- You now need Rust and your system's C++ build tools (see
  [Development](docs/development.md#setup)). The first `npm start` compiles Tauri, which takes a few
  minutes.
- `npm test` runs the Rust tests with `cargo test`, including new ones for screens at different
  scales and for reading Gino 0.2's files.
- `npm run dist` replaces `dist:win` and `dist:mac`. The installers land in
  `src-tauri/target/release/bundle/`, and the build workflow gives them their release names.
- New switches for test runs: `GINO_DATA_DIR` (a separate settings folder), `GINO_QUIT_AFTER`, and
  `GINO_NO_BREAKS=1` (ignore idle time, a locked screen and sleep, and skip the quiet check, for
  unattended machines).
- The checks on every pull request also run `cargo fmt --check` and `cargo clippy -D warnings`, and
  can be started by hand on any branch.
- The screens report still uses Electron, as a dev tool only.

## 0.2.0 (16 October 2026)

### New

- **Guided reps.** Chin tucks, thoracic extension and shoulder rolls now coach every part of every
  rep: "Tuck back", "Hold", "Relax", with a countdown ring and "Rep 3 of 10". Gino does the move in
  time with you.
- **Get ready.** A 3-second lead-in before the timer, with a line on how to set up.
- **A demonstration on every reminder.** Gino loops one rep at the timer's rhythm so you can see how
  it's done before you press Start.
- **Drag the card anywhere.** It comes back to that spot next time, on any screen. **Reset card
  position** in the tray menu puts it back in the corner.

### Changed

- The card now pops up on your **main** screen, instead of the screen your mouse is on.
- Gino's exercise demonstrations play even when your computer is set to reduce motion. Decorative
  motion still follows that setting.
- Thoracic extension's dose reads "10 slow reps".

### Fixed

- A double-click on **Start** no longer counts the stretch as done.
- A stretch can no longer be counted twice when the timer ends just as you press **Done**.

### For developers

- Gino is now written in TypeScript, with strict type checking. The stretches list is typed, so a
  misspelled field, pose or move is an error before Gino runs. `npm start` compiles first (about a
  second), and `npm run typecheck` checks the types.
- Open source under the MIT license, with a contributing guide, issue forms, and automatic checks on
  every pull request.

## 0.1.0 (16 October 2026)

The first version: a tray app for Windows and macOS that counts active screen time and, every 20
minutes, pops up a card with one of seven stretches, a timer and a daily count. On Windows it holds
off during calls and full-screen apps.
