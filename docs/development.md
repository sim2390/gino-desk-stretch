# Development

How Gino Desk Stretch fits together, how to test it, and how to build and release the installers.

- [Setup](#setup)
- [Scripts](#scripts)
- [How it fits together](#how-it-fits-together)
- [Testing](#testing)
- [The screens report](#the-screens-report)
- [Building the installers](#building-the-installers)
- [Releasing](#releasing)
- [Gotchas](#gotchas)

## Setup

You need, on Windows or macOS:
- [Node.js](https://nodejs.org) 22.12 or newer;
- [Rust](https://rustup.rs), installed with rustup;
- on Windows, the Microsoft C++ build tools:
  [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the
  **Desktop development with C++** workload;
- on macOS, the Xcode command line tools: `xcode-select --install`.

```
npm install
npm start
```

`npm start` runs `tauri dev`. It compiles the TypeScript into `build/` first, which takes about a
second, then compiles the Rust side and starts Gino. The first time, Cargo downloads and compiles
Tauri and everything it needs, which takes several minutes; after that a start takes seconds. While it
runs, changes to the Rust code rebuild and restart Gino by themselves. For changes to the TypeScript
or the stretches, stop it and start it again.

### Dev switches

| Switch | What it does |
| --- | --- |
| `GINO_FAST=1` or `--fast` | Reminder minutes become seconds (`npm run fast` passes `--fast`). The idle break, the auto-snooze and pauses stay in real minutes. |
| `GINO_DATA_DIR=<folder>` | Keeps `settings.json` and `stats.json` in that folder instead of the real one. Such a run is a test, and leaves Gino 0.2's login item alone. |
| `GINO_QUIT_AFTER=<seconds>` | Quits by itself after that many seconds, for test runs. |

In PowerShell: `$env:GINO_DATA_DIR = "$env:TEMP\gino-test"; npm start`. In a Mac terminal:
`GINO_DATA_DIR=/tmp/gino-test npm start`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | `tauri dev`: builds, then compiles and runs Gino from the source. |
| `npm run fast` | The same, with reminder minutes turned into seconds. |
| `npm test` | Builds, then runs the Rust unit tests with `cargo test`. |
| `npm run typecheck` | Checks the TypeScript types. The build itself doesn't, so run this too. |
| `npm run build` | Compiles the TypeScript into `build/` and puts the card page together in `build/web/`. The other scripts run it for you. |
| `npm run screens` | Builds, then renders every card state and writes `screens/index.html`. See [below](#the-screens-report). |
| `npm run dist` | `tauri build`: makes the installer for the system you're on, in `src-tauri/target/release/bundle/`. See [below](#building-the-installers). |

## How it fits together

Gino has two halves. The app, written in Rust on [Tauri 2](https://v2.tauri.app), runs the tray
menu, the timer, the quiet check and the card window. The card is a web page written in TypeScript,
shown in the web view the system already has: WebView2 on Windows, WKWebView on macOS.

| File | What it does |
| --- | --- |
| [`src-tauri/src/app.rs`](../src-tauri/src/app.rs) | Start-up, the app's state, the timer thread, and what the tray menu's items do |
| [`card.rs`](../src-tauri/src/card.rs) | The card window: making, placing, showing and hiding it, and the commands the card page calls |
| [`tray.rs`](../src-tauri/src/tray.rs) | The tray icon (menu bar on macOS), its menu and its tooltip |
| [`scheduler.rs`](../src-tauri/src/scheduler.rs) | Counts active screen time and decides when a stretch is due. Pure logic, no Tauri |
| [`placement.rs`](../src-tauri/src/placement.rs) | Decides where the card window goes. Pure logic, no Tauri |
| [`store.rs`](../src-tauri/src/store.rs) | `settings.json` and `stats.json`, the default settings, today's count and the rotation |
| [`exercises.rs`](../src-tauri/src/exercises.rs) | The stretches, compiled in from `build/exercises.json` |
| [`platform/`](../src-tauri/src/platform) | What Gino asks the system: idle time, the quiet check, the lock state, and a card that never takes focus. `windows.rs`, `macos.rs`, and harmless defaults in `other.rs` |
| [`main.rs`](../src-tauri/src/main.rs), [`lib.rs`](../src-tauri/src/lib.rs) | Start the app, and list the modules |
| [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) | Tauri's settings: the page's security policy and the installers |
| [`src-tauri/capabilities/default.json`](../src-tauri/capabilities/default.json) | What the card page may call: Gino's commands, and dragging its window |
| [`src-tauri/windows/hooks.nsh`](../src-tauri/windows/hooks.nsh) | Extra steps in the Windows installer, which replace the Electron version |
| [`src/bridge.ts`](../src/bridge.ts) | The only bridge between the card page and Rust, and dragging the card |
| [`src/card.html`](../src/card.html), [`card.css`](../src/card.css), [`card.ts`](../src/card.ts) | The pop-up card: its states, the guided timer, and Gino's moves |
| [`src/gino.ts`](../src/gino.ts) | Draws Gino as SVG, and moves him in time (`setMove`, `demo`) |
| [`src/exercises.ts`](../src/exercises.ts) | The stretches |
| [`src/types.ts`](../src/types.ts) | The shapes everything shares: an exercise, the card's messages, settings, stats |
| [`src/ipc.ts`](../src/ipc.ts) | The names of the commands and events between the card and Rust |
| [`scripts/build.mjs`](../scripts/build.mjs) | The build: compiles each entry point with esbuild, and writes what the Rust side needs |
| [`dev/`](../dev) | Tools that aren't shipped: the screens report, a pose sheet, a preview page |

### The build

[esbuild](https://esbuild.github.io) bundles each entry point into `build/`. It strips the types
without checking them, which is why `npm run typecheck` exists (TypeScript, configured in
[`tsconfig.json`](../tsconfig.json), with strict checking).

| Entry point | Becomes | Runs in |
| --- | --- | --- |
| `src/card.ts` (with `bridge.ts` and `gino.ts`) | `build/card.js` | The card page, as one classic script |
| `src/gino.ts` | `build/gino.js` | The dev pages, as the global `Gino` |
| `src/exercises.ts` | `build/exercises.js` | The dev pages and the screens report, as the global `GinoExercises` |
| `dev/screens.ts` | `build/dev/screens.js` | Electron |

Then it writes what the app needs:
- `build/exercises.json`: the stretches, taken from `build/exercises.js`. `exercises.rs` compiles it
  in with `include_str!`, so the Rust side always has the same list as the card.
- `build/web/`: the card page, which is Tauri's `frontendDist` and goes into the app. It holds
  `index.html` (`src/card.html`, pointed at the files next to it, without its CSP meta: Tauri sets
  the CSP from `tauri.conf.json`), `card.css`, `card.js`, and `fonts/`, the latin and latin-ext faces
  of the two fonts as woff2.

`tauri dev` and `tauri build` run `npm run build` first (`beforeDevCommand` and `beforeBuildCommand`
in `tauri.conf.json`). `build/` is generated and not committed: edit the `.ts` files.

### Threads

- Tauri's main thread runs the event loop: the tray menu, the card's commands (they aren't `async`,
  so Tauri runs them there), and every window and tray call.
- One timer thread, `gino-timer`, ticks every 15 seconds (every second with `--fast`).

They share `Inner` (settings, stats, the scheduler, the card's state) behind one mutex in `Gino`,
which Tauri manages (`app.state::<Gino>()`). The lock is only held for quick reads and changes, never
across a call into Tauri: from another thread, Tauri's window calls wait for the main thread, which
may itself be waiting for the lock. Code on other threads hands window and tray work to the main
thread with `run_on_main_thread`, so `card::show_stretch()` and `tray::update()` can be called from
anywhere.

### The timer

Every tick, `tick_once()` asks `platform` how long the keyboard and mouse have been idle and whether
the screen is locked, and passes the time since the last tick to the `Scheduler`. That's the larger
of the monotonic clock and the wall clock, so a Mac that slept still comes back as a break.

- **Due.** When the scheduler says a stretch is due, `maybe_show()` runs the quiet check outside the
  lock, then `card::show_stretch()` shows the next stretch from `Stats::pick_next()`.
- **Quiet check.** On Windows, `platform::busy_reason()` calls `SHQueryUserNotificationState` for
  full-screen apps, games, presentations and the locked screen, and looks in the microphone consent
  store in the registry for an app that started using the microphone and hasn't stopped. These are
  direct Windows calls through `windows-sys`, with no PowerShell and no extra process. If the moment
  is bad, it re-checks once a minute. If the check fails, the reminder shows anyway.
- **Breaks.** Lock, sleep, or 5 minutes idle reset the scheduler and put away a visible card.

### The card window

`card::create()` makes the window once, hidden, at start-up; after that it is only shown and hidden.
It's frameless, transparent, always on top, out of the taskbar, and has no system shadow (the card
draws its own). Its label is `card` and its page `index.html`. Requests to close it are refused, so
it can't go away for good.

- **No focus on Windows.** `focusable(false)` makes Tauri keep `WS_EX_NOACTIVATE`, so clicking the
  card doesn't activate it. Tauri's `show()` activates it anyway, so `prepare_card_window()` in
  `platform/windows.rs` installs a `WH_CBT` hook on the card's thread that refuses to activate the
  card, and `show_without_focus()` shows it with `SW_SHOWNOACTIVATE` and puts it on top with
  `SWP_NOACTIVATE`.
- **On macOS**, Gino runs as an accessory app (no Dock icon: the activation policy, and `LSUIElement`
  in [`Info.plist`](../src-tauri/Info.plist)), and showing a window doesn't activate an app that
  isn't active. Clicking the card does. The window is on every desktop, takes the first click, and
  keeps running while hidden.

### Where the card goes

`card::place()` lists the screens (bounds, work area, scale factor, and which is the main one) and
passes them, with the saved position, to `placement::card_bounds()`.

- **Physical pixels.** Positions are in physical pixels. The card's size is in logical (CSS) pixels,
  scaled by the screen it lands on, so it looks the same size on every screen.
- **Saved position:** `settings.cardPos`, stored as `{ x, bottom, unit: "physical" }`, so a taller
  card grows upward. A position the Electron version saved (logical pixels, no `unit`) is ignored,
  and the card starts in its corner.
- **Default:** with no saved position, the card goes in the primary display's bottom-right corner,
  8 logical pixels from the edges.
- **Saved position on a connected screen:** it is clamped into the work area of the display it
  overlaps most. Screens are matched on their full bounds, so a card dropped over the taskbar stays on
  that screen.
- **Placing** sets the position, then the size, then the position again: moving onto a screen with
  another scale can make Windows resize the window.

### Dragging the card

WebView2 ignores `-webkit-app-region`, so `bridge.ts` starts the drag itself: a left mouse-down on
`.card`, anywhere but a button or link, calls `startDragging()` (allowed by
`core:window:allow-start-dragging` in the capabilities). Rust listens for the window's `Moved` event,
which comes in bursts during a drag. `settle_moves()` waits until 300 ms pass without one, then saves
the spot on the main thread, ignoring moves that land where `place()` itself put the window.

### The card

`card.ts` gets everything it knows from the `show` event. Its states, set as `data-state` on the
card:

| State | Shown when |
| --- | --- |
| `welcome` | The first start, or Gino started again while running |
| `prompt` | A reminder |
| `active` | The guided timer is running |
| `done` / `snoozed` / `skipped` | The short message before the card closes |

Pressing Start calls `buildPlan()`, which turns the exercise into a list of timed steps:
1. the "Get ready" lead-in;
2. then one of these:
   - every part of every rep;
   - the two sides;
   - one plain hold.

Every 100 ms, `updateTimer()` finds the current step and updates the cue, the ring and the progress
bar. On a step change it calls `setMove()` from `gino.ts`, which sets `data-move` on the plate plus
`--move-dur` and `--move-delay`. CSS transitions in `card.css` then take Gino to that move's pose in
exactly the step's time. Before Start, `demo()` loops one rep at the same rhythm.

The timer rows have fixed heights, so the card's height doesn't change between steps. Each height
change makes the Rust side re-place the window.

### The card ⇄ Rust contract

`bridge.ts` puts `window.ginoApi` on the card page when it runs inside Tauri, typed as `GinoApi` in
`src/types.ts`; `card.ts` imports it first. Anywhere else (the dev pages, the screens report) it does
nothing, and the card runs without `ginoApi`. The names are in `src/ipc.ts`.

| Direction | Name | Meaning |
| --- | --- | --- |
| Rust → card | event `show` | A `ShowPayload`: `{ mode, exercise, todayCount, snoozeMin, intervalMin, autoSnoozeMin }`, where `mode` is `stretch` or `welcome` |
| Rust → card | event `hide` | Put the card away now (you walked off, or the screen locked) |
| card → Rust | command `card_ready` | The page is listening. Rust holds a card back until then, and sends it now |
| card → Rust | command `card_action` | `{ name, data }`, a `CardAction`: `start`, `done` (replies with `{ todayCount }`), `skip`, `stop`, `snooze`, `trynow`, `dismiss` |
| card → Rust | command `card_resize` | `{ height }`: the window needs to be this tall, in CSS pixels with the shadow room |
| card → Rust | command `card_closed` | The close animation finished, so Rust hides the window |

Rust sends the events with `emit_to("card", …)`. The commands live in `card.rs` and are registered in
`app.rs`.

### Settings and stats

`store.rs` reads and writes `settings.json` and `stats.json` in the same folder and format the
Electron version used, so updating keeps them:
- `%APPDATA%\Gino` on Windows;
- `~/Library/Application Support/Gino` on macOS;
- the folder in `GINO_DATA_DIR`, when it's set.

Their shapes are `Settings` and `Stats` in `store.rs` (and in `src/types.ts`). They're read once at
startup: missing fields take the defaults from `Settings::default()`, and unknown ones are skipped.
Each save writes a temporary file and renames it over the old one. Daily counts are trimmed to the
last 90 days.

### macOS

- **No quiet check.** `busy_reason()` always says no, so Gino doesn't hold off during calls or
  full-screen apps, and the menu leaves that item out. `screen_locked()` is always false; a long lock
  still counts as a break through idle time.
- **No bending outline.** Safari's engine doesn't morph CSS `d: path()`, so during chin tucks and
  thoracic extension Gino's outline keeps its shape on a Mac. The rest of each move plays.

### The Windows installer

Tauri builds an NSIS installer (`bundle` in `tauri.conf.json`). It installs for the current user, so
it needs no admin rights, and if WebView2 is missing it fetches Microsoft's installer and runs it
silently. [`windows/hooks.nsh`](../src-tauri/windows/hooks.nsh) adds a step before any files are
copied (`NSIS_HOOK_PREINSTALL`), for anyone coming from Gino 0.2 (Electron):
1. If the Electron version's uninstall entry is there, it closes the old `Gino.exe` with the Restart
   Manager, runs its uninstaller silently and waits, then removes what that leaves behind and any
   shortcuts that still point at it. `%APPDATA%\Gino` is never touched.
2. It moves **Start with Windows** over: it deletes the old `com.gino.stretch` Run value, if that
   starts the old Gino, and writes a `Gino` value for the new one, the name the autostart plugin
   uses.

At start-up the app also deletes that old Run value (`platform::remove_legacy_login_item()`), unless
`GINO_DATA_DIR` is set.

## Testing

```
npm run typecheck
npm test
```

`npm test` builds first, because the Rust side compiles in `build/exercises.json`, then runs
`cargo test`. Both also run on GitHub, on Windows, for every pull request and every push to `main`
([`.github/workflows/check.yml`](../.github/workflows/check.yml)). The workflow caches the compiled
Rust dependencies, since the first build of Tauri takes several minutes.

The tests are Rust unit tests, next to the code they test:
- `scheduler.rs` covers active time, breaks, sleep, snooze, pause and interval changes;
- `placement.rs` covers the corner on the main screen, saved spots on either screen, clamping, the
  taskbar, an unplugged screen, height limits, and screens at different scales;
- `store.rs` covers reading the Electron version's files, missing, unknown and broken fields,
  saving, the 90 days and the rotation;
- `card.rs` checks the welcome card, the field names the card page expects, and which saved
  positions count;
- `tray.rs` checks the status line: the countdown, fast mode, what wins, and "tomorrow";
- `platform/windows.rs` checks which login item belongs to the Electron version.

Keep new logic that doesn't need Tauri in its own module like `scheduler.rs` and `placement.rs`, so
it can be tested the same way.

To see what the platform layer reports on your computer (idle time, the quiet check, the lock state),
run the probe after a build:

```
cargo run --manifest-path src-tauri/Cargo.toml --example platform_probe -- 10 2
```

It prints 10 lines, 2 seconds apart. Leave the mouse alone and `idle_ms` keeps growing.

For the card, `card.ts` exposes dev hooks on `window.__card`:
- the card actions: `show`, `start`, `finish`, `snooze`, `skip`, `toggleHowTo`;
- `setElapsed(seconds)` puts the running timer that many seconds in, counting the lead-in;
- `jumpTo(rep, part)` puts the timer in the middle of that part of that rep. `jumpTo(0)` is the middle
  of "Get ready".

The app doesn't use them.

## The screens report

```
npm run screens
```

[`dev/screens.ts`](../dev/screens.ts) loads the real `src/card.html` in a hidden Electron window and
drives it through `window.__card`. Electron is only a dev tool here, not part of the app; it
downloads its own binary (about 100 MB) the first time it runs. The report reads the default
settings, the interval choices and the menu labels from `src-tauri/src`, so it follows the app, and
warns when a label it copies has gone.

It captures every state of every stretch at 2x, with animations frozen. Chromium draws the card the
way WebView2 does on Windows; a Mac draws it with WebKit (see [macOS](#macos)). It writes these to
`screens/` (not committed):

| File | What it is |
| --- | --- |
| `index.html` | The report, for opening locally |
| `page.html` + `files.json` | The same report as a page fragment, plus the list of files it needs, for publishing |
| `live.html` | A live card that runs the real, built card code, embedded in the report so the animations can be watched and the timer started |
| `NN-*.png` | The stills |

It builds first, so the report always matches the current source.

## Building the installers

```
npm run dist
```

This runs `tauri build`. It builds, compiles Gino in release mode (`[profile.release]` in
`src-tauri/Cargo.toml` is set up for a small app), and makes the installer for the system you're on,
in `src-tauri/target/release/bundle/`:
- on Windows, `nsis/Gino_<version>_x64-setup.exe`, a per-user installer that also replaces Gino 0.2
  (see [The Windows installer](#the-windows-installer));
- on macOS, `dmg/Gino_<version>_aarch64.dmg`, and the app itself in `macos/Gino.app`.

Releases name them `Gino-Setup-<version>.exe` and `Gino-<version>-arm64.dmg`, as the build workflow
does. The names avoid spaces because GitHub turns spaces in release downloads into dots.

The version comes from `package.json` (`tauri.conf.json` points to it); keep `version` in
`src-tauri/Cargo.toml` the same. The builds aren't code-signed. Windows SmartScreen warns on first
open, and the Mac app only has an ad-hoc signature (`signingIdentity: "-"`), so the first time, macOS
asks for **Open Anyway** in **Privacy & Security**.

macOS builds need a Mac. The easiest way to get one is the GitHub Actions workflow
[`.github/workflows/build.yml`](../.github/workflows/build.yml):
1. It type checks and runs the tests, then builds the Windows installer (`tauri build --bundles nsis`)
   and the Mac `.dmg` (`--bundles dmg`), and copies them to their release names.
2. Run it from the repo's **Actions** tab ("Run workflow"), or push a tag like `v0.3.0`.
3. The installers appear as downloadable artifacts on the run's page, `gino-Windows` and
   `gino-macOS`.

## Releasing

1. Update `version` in `package.json` and `src-tauri/Cargo.toml` (the next build updates
   `src-tauri/Cargo.lock` to match), and add a section to [CHANGELOG.md](../CHANGELOG.md).
2. Commit, tag and push:
   ```
   git tag v0.3.0
   git push origin main --tags
   ```
   The tag starts the build workflow.
3. When the workflow finishes, download its artifacts and create the release with the installers:
   ```
   gh run download <run id> --dir release
   gh release create v0.3.0 release/gino-Windows/Gino-Setup-0.3.0.exe release/gino-macOS/Gino-0.3.0-arm64.dmg --title "Gino Desk Stretch 0.3.0" --notes-file notes.md
   ```
   Write the notes for people downloading Gino: what's new, which file to pick, and the first-open
   warnings.

GitHub's macOS runners are Apple silicon, and `tauri build` builds for the machine it runs on, so the
`.dmg` from the workflow is for Apple silicon Macs (M1 and later). For Intel Macs too, run
`rustup target add x86_64-apple-darwin` and build with `--target universal-apple-darwin`; the
bundle then lands in `src-tauri/target/universal-apple-darwin/release/bundle/`.

## Gotchas

- **Edit the `.ts` files, not `build/`.** `build/` is overwritten by every build.
- **Type errors don't stop `npm start`.** esbuild only strips types; run `npm run typecheck` (CI does).
- **Build before Cargo.** `exercises.rs` compiles in `build/exercises.json`, and Tauri wants
  `build/web`, so on a fresh clone a bare `cargo build` or `cargo test` fails until `npm run build`
  has run. The npm scripts do it for you.
- **Never call into Tauri while holding the lock.** A window or tray call from the timer thread waits
  for the main thread; if the main thread is waiting for the lock, both wait forever. Take what you
  need, let the lock go, then make the call.
- **Only one Gino runs at a time.** The lock is the app's identifier, `com.gino.stretch`, so
  `npm start` while an installed Gino 0.3 runs just shows that one's welcome card and exits. Quit it
  first. Gino 0.2 (Electron) uses another lock, so it runs alongside.
- **A dev run touches your real Gino.** Without `GINO_DATA_DIR`, it uses your real settings and stats,
  and removes Gino 0.2's **Start with Windows** entry. Set `GINO_DATA_DIR` to a scratch folder to
  leave both alone. Ticking **Start with Windows** in a dev run still changes the real one.
- **No console in release builds.** On Windows, a release build has no console window
  (`windows_subsystem` in `main.rs`), so `eprintln!` messages only show with `npm start`.
- **"Cannot read properties of undefined (reading 'setName')" from `npm run screens`.** Electron is
  running as plain Node, because `ELECTRON_RUN_AS_NODE=1` is set in the environment. Processes
  launched from some editor tools inherit it, for example the VS Code extension host. Unset it before
  running the screens report.
- **Reduced motion.** Many Windows PCs have animation effects off, which turns on
  `prefers-reduced-motion`. Gino's exercise demonstrations deliberately ignore it; decorative motion
  respects it. See the note at the end of `card.css`.
