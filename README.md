# Gino Desk Stretch

A desk stretch coach for Windows and macOS. After 20 minutes at your computer, **Gino the Gnocchi**
pops up in the corner of your screen with a short stretch, shows you how it's done, and counts you
through it.

<p>
  <img src="docs/images/reminder.png" width="440" alt="A reminder card: Gino on his plate, 'Chin tucks', with Start, Snooze 10 min and Skip buttons">
  <img src="docs/images/rep-hold.png" width="440" alt="The guided timer during chin tucks: 'Hold', a countdown ring, and 'Rep 2 of 10'">
</p>

## What it does

- **Counts real screen time.** Only the minutes you're actually using the computer count. Step away
  for 5 minutes, lock the screen or let the computer sleep, and that's a break: the count starts over.
  On a Mac, a locked screen counts once it has been locked for 5 minutes.
- **Pops up a small card**, bottom right on your main screen. Drag it anywhere you like and it comes
  back to that spot next time.
- **Seven stretches in rotation:** sit up straight, chin tucks, neck side stretch, eye break, thoracic
  extension and shoulder rolls, plus a two-minute walkaround every third time.
- **Guided reps.** For chin tucks, thoracic extension and shoulder rolls, the card calls out every part
  of every rep ("Tuck back", "Hold", "Relax") with a countdown, and Gino does the move with you.
- **Stays out of your way.** On Windows it waits while you're on a call, in a full-screen app or
  presenting. The card pops up without taking your keyboard focus, and if you ignore it, it snoozes
  itself.
- **Counts what you've done today.**
- **Small and light.** Gino uses the web engine already built into your computer instead of bringing
  his own, so the Windows download is about {{INSTALLER_MB}} MB and he needs about {{RAM_MB}} MB of
  memory.
- **Keeps to itself.** Gino never connects to the internet. Your settings and counts stay on your
  computer.

## Download and install

Gino isn't code-signed yet, so your computer warns you the first time you open it.

### Windows 10 and 11

1. Download **Gino-Setup-0.3.0.exe** from the
   [latest release](https://github.com/sim2390/gino-desk-stretch/releases/latest).
2. Run it. If Windows says it protected your PC, click **More info**, then **Run anyway**. Gino
   installs just for you, so it doesn't need admin rights.
3. Gino lives in the tray by the clock. Windows 11 hides new tray icons under the **^** arrow: drag
   him out onto the taskbar so you can always see him.
4. Click Gino and tick **Start with Windows**.

**Updating from Gino 0.2?** Just run the new installer. It closes and removes the old Gino for you,
and keeps your settings, your counts and **Start with Windows**. There's no portable version any
more: if you used it, quit it and delete it, and the installed Gino carries on with your settings and
counts.

Gino's card is drawn by Microsoft Edge WebView2, which comes with Windows 11 and almost every
Windows 10 PC. If yours doesn't have it, the installer fetches it from Microsoft.

### macOS (Apple silicon: M1 and later)

1. Download **Gino-0.3.0-arm64.dmg** from the
   [latest release](https://github.com/sim2390/gino-desk-stretch/releases/latest) and drag Gino into
   Applications. Updating? Quit the old Gino first, then replace it.
2. The first time, open Gino. macOS says it can't check the app: close that message, open
   **System Settings › Privacy & Security**, scroll down and click **Open Anyway** next to Gino. If
   macOS says the app is damaged instead, run `xattr -cr /Applications/Gino.app` in Terminal once,
   then open it again.
3. Gino lives in the menu bar. Click him and tick **Open at login**.

## Using Gino

When a stretch is due, the card offers three choices:

| Button | What happens |
| --- | --- |
| **Start** | Runs the guided timer: a short "Get ready", then the stretch. The yellow bar fills as you go. |
| **Snooze 10 min** | Asks again in 10 minutes. |
| **Skip** | No stretch this time; the next one comes after a full interval. |

**How to** opens the steps. While the timer runs, **Done** finishes early and counts it, and **Stop**
ends it without counting.

Click Gino's icon for the menu: stretch now, pause (30 minutes, 1 hour, 2 hours or until tomorrow
morning), how often to remind you (every 15 to 60 minutes), holding off during calls, starting at
login, and putting the card back in its corner.

The [user guide](docs/user-guide.md) covers every screen, each stretch and its timings, and what to do
when something doesn't look right.

## Your data

- Gino keeps two small files on your computer: `settings.json` and `stats.json`. They're in
  `%APPDATA%\Gino` on Windows and `~/Library/Application Support/Gino` on macOS. Daily counts are kept
  for the 90 most recent days you stretched.
- No accounts, no analytics, no network access.
- On Windows, **Hold off during calls and full-screen apps** asks Windows whether an app currently has
  the microphone open, and whether Windows itself is holding back notifications (full-screen app,
  presentation, locked screen). Gino never listens to or records anything.

## Make it yours

The stretches are a plain list in [`src/exercises.ts`](src/exercises.ts): add, remove or reword them,
change the timings, or split a stretch into guided reps. A misspelled field, pose or move shows up as
an error in your editor and in `npm run typecheck` (`npm start` doesn't check types).
[Customizing Gino](docs/customizing.md) explains every field and shows how to preview your changes.

## Run it from the source

You need [Node.js](https://nodejs.org) 22.12 or newer and [Rust](https://rustup.rs). On Windows you
also need the Microsoft C++ build tools, and on a Mac the Xcode command line tools:
[Development](docs/development.md#setup) says how to get them.

```
git clone https://github.com/sim2390/gino-desk-stretch.git
cd gino-desk-stretch
npm install
npm start
```

Gino's app is written in Rust with [Tauri](https://tauri.app), and his card in TypeScript. The first
`npm start` compiles Tauri, which takes a few minutes; after that he starts in seconds. `npm run fast`
turns minutes into seconds so you can watch a whole cycle quickly, `npm test` checks the timer,
placement and settings logic, and `npm run typecheck` checks the TypeScript.
[Development](docs/development.md) explains how the app fits together and how to build the
installers.

## Documentation

- [User guide](docs/user-guide.md): every screen, the stretches, the tray menu, troubleshooting
- [Customizing Gino](docs/customizing.md): stretches, timings, poses and defaults
- [Development](docs/development.md): how it works, testing, building and releasing
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md): ideas, bug reports and pull requests

## Contributing

Ideas, bug reports and pull requests are all welcome, and you don't need to write code to help.
Suggest a stretch or a feature in [Discussions](https://github.com/sim2390/gino-desk-stretch/discussions)
or with an [issue](https://github.com/sim2390/gino-desk-stretch/issues/new/choose). If you'd like to
change the code, [CONTRIBUTING.md](CONTRIBUTING.md) explains how.

## Please note

These are general desk stretches, not medical advice. Move gently, and skip anything that hurts.

## License

[MIT](LICENSE). The fonts Gino uses, Shantell Sans and Atkinson Hyperlegible, are under the SIL Open
Font License.
