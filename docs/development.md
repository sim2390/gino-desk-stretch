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

Electron downloads its own binary (about 100 MB) the first time it starts, not during `npm install`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Runs Gino from the source. |
| `npm run fast` | The same, with reminder minutes turned into seconds. |
| `npm test` | Runs the scheduler and placement tests with plain Node. |
| `npm run screens` | Renders every card state and writes `screens/index.html`. See [below](#the-screens-report). |
| `npm run dist:win` | Builds the Windows installer and portable exe into `dist/`. |
| `npm run dist:mac` | Builds the macOS `.dmg` and `.zip` into `dist/`. Only works on a Mac. |

## How it fits together

| File | What it does |
| --- | --- |
| [`main.js`](../main.js) | The main process: tray menu, timer ticks, the "is now a bad moment?" check, the card window, settings and stats |
| [`src/scheduler.js`](../src/scheduler.js) | Counts active screen time and decides when a stretch is due. Pure logic, no Electron |
| [`src/placement.js`](../src/placement.js) | Decides where the card window goes. Pure logic, no Electron |
| [`preload.js`](../preload.js) | The only bridge between the card and the main process |
| [`src/card.html`](../src/card.html), [`card.css`](../src/card.css), [`card.js`](../src/card.js) | The pop-up card: its states, the guided timer, and Gino's moves |
| [`src/gino.js`](../src/gino.js) | Draws Gino as SVG, and moves him in time (`setMove`, `demo`) |
| [`src/exercises.js`](../src/exercises.js) | The stretches |
| [`dev/`](../dev) | Tools that aren't shipped: the screens report, a pose sheet, a preview page |

### The main process

Every 15 seconds (every second with `--fast`), `main.js` asks the operating system how long the
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
`src/placement.js`.

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

`card.js` gets everything it knows from the `show` message. Its states, set as `data-state` on the
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
bar. On a step change it calls `Gino.setMove()`, which sets `data-move` on the plate plus
`--move-dur` and `--move-delay`. CSS transitions in `card.css` then take Gino to that move's pose in
exactly the step's time. Before Start, `Gino.demo()` loops one rep at the same rhythm.

The timer rows have fixed heights, so the card's height doesn't change between steps. Each height
change makes the main process re-place the window.

### Messages between the card and the main process

Defined in `preload.js` as `window.ginoApi`.

| Direction | Message | Meaning |
| --- | --- | --- |
| main → card | `show` | `{ mode, exercise, todayCount, snoozeMin, intervalMin, autoSnoozeMin }` |
| main → card | `hide` | Put the card away now (you walked off, or the screen locked) |
| card → main | `card:action` | `start`, `done` (replies with `{ todayCount }`), `skip`, `stop`, `snooze`, `trynow`, `dismiss` |
| card → main | `card:resize` | The card's height changed |
| card → main | `card:closed` | The close animation finished |

### Settings and stats

`settings.json` and `stats.json` live in Electron's `userData` folder:
- `%APPDATA%\Gino` on Windows;
- `~/Library/Application Support/Gino` on macOS.

They're read once at startup and merged over the defaults at the top of `main.js`. Daily counts are
trimmed to the last 90 days.

## Testing

```
npm test
```

The tests are plain Node scripts with `assert`, with no framework:
- `test/scheduler.test.js` covers active time, breaks, snooze, pause and interval changes;
- `test/placement.test.js` covers the corner on the main screen, saved spots on either screen,
  clamping, the taskbar, an unplugged screen, and height limits.

Keep new logic that doesn't need Electron in its own module like these, so it can be tested the same
way.

For the card, `card.js` exposes dev hooks on `window.__card`:
- the card actions: `show`, `start`, `finish`, `snooze`, `skip`, `toggleHowTo`;
- `setElapsed(seconds)` puts the running timer that many seconds in, counting the lead-in;
- `jumpTo(rep, part)` puts the timer in the middle of that part of that rep. `jumpTo(0)` is the middle
  of "Get ready".

The app doesn't use them.

## The screens report

```
npm run screens
```

[`dev/screens.js`](../dev/screens.js) loads the real `src/card.html` in a hidden Electron window and
drives it through `window.__card`. It captures every state of every stretch at 2x, with animations
frozen. It writes these to `screens/` (not committed):

| File | What it is |
| --- | --- |
| `index.html` | The report, for opening locally |
| `page.html` + `files.json` | The same report as a page fragment, plus the list of files it needs, for publishing |
| `live.html` | A live card that runs the real card code, embedded in the report so the animations can be watched and the timer started |
| `NN-*.png` | The stills |

Re-run it after changing the stretches or the card: the copies of the card files in `screens/` are
snapshots.

## Building the installers

```
npm run dist:win
```

This builds, in `dist/`:
- `Gino Setup <version>.exe`, a one-click installer for the current user;
- `Gino <version>.exe`, which runs without installing.

The version comes from `package.json`, and electron-builder's settings are under `build` in the same
file. The builds aren't code-signed, so Windows SmartScreen and macOS Gatekeeper warn on first open.

macOS builds need a Mac. The easiest way to get one is the GitHub Actions workflow
[`.github/workflows/build.yml`](../.github/workflows/build.yml):
1. It builds Windows and macOS after running the tests.
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
3. Create the release and attach the installers. Take the Windows files from `dist/` or from the
   workflow's artifacts, and the macOS `.dmg` from the workflow's `gino-macOS` artifact:
   ```
   gh release create v0.2.0 "dist/Gino Setup 0.2.0.exe" "dist/Gino 0.2.0.exe" <path to the .dmg> --title "Gino Desk Stretch 0.2.0" --notes-file notes.md
   ```

GitHub's macOS runners are Apple silicon, and electron-builder builds for the machine it runs on, so
the `.dmg` from the workflow is for Apple silicon Macs (M1 and later). For Intel Macs, add `--x64`
(or `--universal`) to `dist:mac`.

## Gotchas

- **"Cannot read properties of undefined (reading 'requestSingleInstanceLock')".** Electron is running
  as plain Node, because `ELECTRON_RUN_AS_NODE=1` is set in the environment. Processes launched from
  some editor tools inherit it, for example the VS Code extension host. Unset it before starting
  Electron.
- **Only one Gino runs at a time.** Starting a second copy opens the running copy's menu and exits.
  To test the app next to your everyday Gino, give the test copy its own `userData` folder with
  `app.setPath('userData', …)` before `main.js` loads.
- **Reduced motion.** Many Windows PCs have animation effects off, which turns on
  `prefers-reduced-motion`. Gino's exercise demonstrations deliberately ignore it; decorative motion
  respects it. See the note at the end of `card.css`.
- **Capturing hidden windows.** In a hidden window, `capturePage()` can return the previous frame,
  and `requestAnimationFrame` may not fire. Take one throwaway capture first, and wait with
  `setTimeout`.
