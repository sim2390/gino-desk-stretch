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

You need [Node.js](https://nodejs.org) 22.12 or newer (Electron 44 requires it), on Windows or macOS.

```
npm install
npm start
```

Gino is written in TypeScript. `npm start` compiles it into `build/` first, which takes about a
second, and then starts Electron. Electron downloads its own binary (about 100 MB) the first time it
starts, not during `npm install`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Builds, then runs Gino from the source. |
| `npm run fast` | The same, with reminder minutes turned into seconds. |
| `npm test` | Builds, then runs the scheduler and placement tests with plain Node. |
| `npm run typecheck` | Checks the types with TypeScript. The build itself doesn't, so run this too. |
| `npm run build` | Compiles the TypeScript into `build/`. The other scripts run it for you. |
| `npm run screens` | Builds, then renders every card state and writes `screens/index.html`. See [below](#the-screens-report). |
| `npm run dist:win` | Builds, then makes the Windows installer and portable exe in `dist/`. |
| `npm run dist:mac` | Builds, then makes the macOS `.dmg` and `.zip` in `dist/`. Only works on a Mac. |

## How it fits together

| File | What it does |
| --- | --- |
| [`main.ts`](../main.ts) | The main process: tray menu, timer ticks, the "is now a bad moment?" check, the card window, settings and stats |
| [`src/scheduler.ts`](../src/scheduler.ts) | Counts active screen time and decides when a stretch is due. Pure logic, no Electron |
| [`src/placement.ts`](../src/placement.ts) | Decides where the card window goes. Pure logic, no Electron |
| [`preload.ts`](../preload.ts) | The only bridge between the card and the main process |
| [`src/card.html`](../src/card.html), [`card.css`](../src/card.css), [`card.ts`](../src/card.ts) | The pop-up card: its states, the guided timer, and Gino's moves |
| [`src/gino.ts`](../src/gino.ts) | Draws Gino as SVG, and moves him in time (`setMove`, `demo`) |
| [`src/exercises.ts`](../src/exercises.ts) | The stretches |
| [`src/types.ts`](../src/types.ts) | The shapes everything shares: an exercise, the card's messages, settings, stats |
| [`src/ipc.ts`](../src/ipc.ts) | The names of the message channels between the main process and the card |
| [`scripts/build.mjs`](../scripts/build.mjs) | The build: compiles each entry point with esbuild |
| [`dev/`](../dev) | Tools that aren't shipped: the screens report, a pose sheet, a preview page |

### The build

[esbuild](https://esbuild.github.io) bundles each entry point into `build/`. It strips the types
without checking them, which is why `npm run typecheck` exists (TypeScript, configured in
[`tsconfig.json`](../tsconfig.json), with strict checking).

| Entry point | Becomes | Runs in |
| --- | --- | --- |
| `main.ts` | `build/main.js` | The main process (`package.json` `main`) |
| `preload.ts` | `build/preload.js` | The card window, before the page |
| `src/card.ts` (with `gino.ts`) | `build/card.js` | The card window, as one classic script loaded by `src/card.html` |
| `src/gino.ts` | `build/gino.js` | The dev pages, as the global `Gino` |
| `src/exercises.ts` | `build/exercises.js` | The dev pages and the screens report, as the global `GinoExercises` |
| `test/*.test.ts` | `build/test/*.test.js` | Plain Node |
| `dev/screens.ts` | `build/dev/screens.js` | Electron |

`build/` is generated and not committed: edit the `.ts` files. The installers contain
`build/main.js`, `build/preload.js`, `build/card.js`, `src/card.html`, `src/card.css` and `assets/`.

### The main process

Every 15 seconds (every second with `--fast`), `main.ts` asks the operating system how long the
keyboard and mouse have been idle and passes that to the `Scheduler`.

- **Due.** When the scheduler says a stretch is due, `maybeShow()` runs the quiet check, then shows
  the card with the next stretch from `pickNext()`.
- **Quiet check.** On Windows, this runs a short PowerShell script. It calls
  `SHQueryUserNotificationState` for full-screen apps, presentations and the locked screen, and it
  looks in the microphone consent store in the registry for an app using the microphone. If the
  moment is bad, it re-checks once a minute. If the check fails, the reminder shows anyway.
- **Breaks.** Lock, sleep, or 5 minutes idle reset the scheduler and put away a visible card.

The card window is frameless, transparent and always on top. It is created once and reused. On
Windows it is `focusable: false`, so it never takes keyboard focus. It's shown with `showInactive()`.

### Where the card goes

`placeCard()` passes the primary display, all displays, and the saved position to `cardBounds()` in
`src/placement.ts`.

- **Saved position:** `settings.cardPos`, stored as `{ x, bottom }`, so a taller card grows upward.
- **Default:** with no saved position, the card goes in the primary display's bottom-right corner.
- **Saved position on a connected screen:** it is clamped into the work area of the display it
  overlaps most. Screens are matched on their full bounds, so a card dropped over the taskbar stays on
  that screen.
- **Moving the card:** the user drags it by its body. `.card` has `-webkit-app-region: drag`, and
  every button has `no-drag`. Windows emits `moved` once, after the drag; macOS emits it throughout.
  The handler waits 300 ms for moves to settle, then saves, ignoring moves that land where
  `placeCard()` itself put the window.

### The card

`card.ts` gets everything it knows from the `show` message. Its states, set as `data-state` on the
card:

| State | Shown when |
| --- | --- |
| `welcome` | The first start |
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
change makes the main process re-place the window.

### Messages between the card and the main process

`preload.ts` puts `window.ginoApi` on the card window, typed as `GinoApi` in `src/types.ts`. The
channel names are in `src/ipc.ts`.

| Direction | Message | Meaning |
| --- | --- | --- |
| main → card | `show` | A `ShowPayload`: `{ mode, exercise, todayCount, snoozeMin, intervalMin, autoSnoozeMin }` |
| main → card | `hide` | Put the card away now (you walked off, or the screen locked) |
| card → main | `card:action` | A `CardAction`: `start`, `done` (replies with `{ todayCount }`), `skip`, `stop`, `snooze`, `trynow`, `dismiss` |
| card → main | `card:resize` | The card's height changed |
| card → main | `card:closed` | The close animation finished |

### Settings and stats

`settings.json` and `stats.json` live in Electron's `userData` folder:
- `%APPDATA%\Gino` on Windows;
- `~/Library/Application Support/Gino` on macOS.

Their shapes are `Settings` and `Stats` in `src/types.ts`. They're read once at startup and merged
over the defaults at the top of `main.ts`. Daily counts are trimmed to the last 90 days.

## Testing

```
npm run typecheck
npm test
```

Both also run on GitHub for every pull request and every push to `main`
([`.github/workflows/check.yml`](../.github/workflows/check.yml)).

The tests are TypeScript, compiled by the build and run with plain Node and `assert`, with no
framework:
- `test/scheduler.test.ts` covers active time, breaks, snooze, pause and interval changes;
- `test/placement.test.ts` covers the corner on the main screen, saved spots on either screen,
  clamping, the taskbar, an unplugged screen, and height limits.

Keep new logic that doesn't need Electron in its own module like these, so it can be tested the same
way.

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
drives it through `window.__card`. It captures every state of every stretch at 2x, with animations
frozen. It writes these to `screens/` (not committed):

| File | What it is |
| --- | --- |
| `index.html` | The report, for opening locally |
| `page.html` + `files.json` | The same report as a page fragment, plus the list of files it needs, for publishing |
| `live.html` | A live card that runs the real, built card code, embedded in the report so the animations can be watched and the timer started |
| `NN-*.png` | The stills |

It builds first, so the report always matches the current source.

## Building the installers

```
npm run dist:win
```

This builds, in `dist/`:
- `Gino-Setup-<version>.exe`, a one-click installer for the current user;
- `Gino-<version>-portable.exe`, which runs without installing.

The file names avoid spaces because GitHub turns spaces in release downloads into dots. The Mac build
makes `Gino-<version>-arm64.dmg` and a `.zip`.

The version comes from `package.json`, and electron-builder's settings are under `build` in the same
file. The builds aren't code-signed, so Windows SmartScreen and macOS Gatekeeper warn on first open.

macOS builds need a Mac. The easiest way to get one is the GitHub Actions workflow
[`.github/workflows/build.yml`](../.github/workflows/build.yml):
1. It builds Windows and macOS after type checking and running the tests.
2. Run it from the repo's **Actions** tab ("Run workflow"), or push a tag like `v0.2.0`.
3. The installers appear as downloadable artifacts on the run's page.

## Releasing

1. Update `version` in `package.json` and add a section to [CHANGELOG.md](../CHANGELOG.md).
2. Commit, tag and push:
   ```
   git tag v0.2.0
   git push origin main --tags
   ```
   The tag starts the build workflow.
3. When the workflow finishes, download its artifacts and create the release with the installers:
   ```
   gh run download <run id> --dir release
   gh release create v0.2.0 release/gino-Windows/Gino-Setup-0.2.0.exe release/gino-Windows/Gino-0.2.0-portable.exe release/gino-macOS/Gino-0.2.0-arm64.dmg --title "Gino Desk Stretch 0.2.0" --notes-file notes.md
   ```
   Write the notes for people downloading Gino: what's new, which file to pick, and the first-open
   warnings.

GitHub's macOS runners are Apple silicon, and electron-builder builds for the machine it runs on, so
the `.dmg` from the workflow is for Apple silicon Macs (M1 and later). For Intel Macs, add `--x64`
(or `--universal`) to `dist:mac`.

## Gotchas

- **Edit the `.ts` files, not `build/`.** `build/` is overwritten by every build.
- **Type errors don't stop `npm start`.** esbuild only strips types; run `npm run typecheck` (CI does).
- **"Cannot read properties of undefined (reading 'requestSingleInstanceLock')".** Electron is running
  as plain Node, because `ELECTRON_RUN_AS_NODE=1` is set in the environment. Processes launched from
  some editor tools inherit it, for example the VS Code extension host. Unset it before starting
  Electron.
- **Only one Gino runs at a time.** Starting a second copy opens the running copy's menu and exits.
  To test the app next to your everyday Gino, give the test copy its own `userData` folder with
  `app.setPath('userData', …)` before `build/main.js` loads.
- **Reduced motion.** Many Windows PCs have animation effects off, which turns on
  `prefers-reduced-motion`. Gino's exercise demonstrations deliberately ignore it; decorative motion
  respects it. See the note at the end of `card.css`.
- **Capturing hidden windows.** In a hidden window, `capturePage()` can return the previous frame,
  and `requestAnimationFrame` may not fire. Take one throwaway capture first, and wait with
  `setTimeout`.
