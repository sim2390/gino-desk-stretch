# Gino

A desk stretch coach that lives in your tray (Windows) or menu bar (macOS).
After 20 minutes of screen time, Gino the Gnocchi pops up in the corner with a short stretch.
He demonstrates it, runs a timer, and counts what you've done today.

## Run it

You need [Node.js](https://nodejs.org) (the LTS version). Then, in this folder:

```
npm install
npm start
```

The first `npm install` downloads Electron (about 100 MB), so give it a minute.
Gino says hello on first start and then lives in the tray. On Windows 11 new tray icons
hide under the **^** arrow by the clock: drag him out so he's always visible.

To watch a full cycle quickly, use `npm run fast`: reminder minutes become seconds.

## Using it

Click the tray icon for the menu:

- **Stretch now** if you want one immediately
- **Pause** for 30 minutes, 1 hour, 2 hours or until tomorrow morning
- **Remind me every** 15 to 60 minutes
- **Hold off during calls and full-screen apps** (Windows): reminders wait while an app
  has your microphone open, or during presentations and full-screen apps
- **Start with Windows** / **Open at login**
- **Reset card position** puts the card back in its corner after you've dragged it

On the card: **Start** runs a guided timer, **Snooze** asks again in 10 minutes,
**Skip** waits a full interval. If you ignore a card, it snoozes itself after 4 minutes.
If you step away for 5 minutes, that counts as a break and the timer starts over.

The card pops up in the bottom-right corner of your main screen. Drag it by its body to
anywhere you like, on any screen, and it comes back to that spot next time. If that screen
is unplugged, it goes back to the corner.

## Make it yours

- **Exercises:** `src/exercises.js`. Add, remove or reword; each one picks a pose.
- **Gino himself:** `src/gino.js` draws him; `src/card.css` animates him.
  Open `dev/poses.html` in a browser to see every pose.
- **See every screen:** `npm run screens` renders each state of the card and writes a report
  to `screens/index.html`.
- **Defaults** (interval, snooze, idle reset): top of `main.js`.
  Your saved settings and daily counts live in `settings.json` and `stats.json` in the app's data folder
  (`%APPDATA%\Gino` on Windows, `~/Library/Application Support/Gino` on macOS).

Check the timer and placement logic with `npm test`.

## Using it on the Mac too

Put this folder in a GitHub repo, then either:

- **Run from source:** clone it on the Mac, `npm install`, `npm start`. Same as Windows.
  "Open at login" only works for the built app, so use this for trying things out.
- **Build installers on GitHub:** the workflow in `.github/workflows/build.yml` builds a Windows
  installer and a Mac `.dmg`. Run it from the repo's **Actions** tab, then download the files from the run.

The builds aren't code-signed. Windows SmartScreen will say "unknown publisher": choose
**More info → Run anyway**. On the Mac, right-click the app and choose **Open** the first time.
If macOS says the app is damaged, run `xattr -cr /Applications/Gino.app` once.

## How it's put together

| File | What it does |
| --- | --- |
| `main.js` | Tray menu, timer, the pop-up window, the "is now a bad moment?" check |
| `src/scheduler.js` | Counts active screen time and decides when a stretch is due |
| `src/placement.js` | Decides where the card goes: main screen corner, or where you dragged it |
| `src/card.html`, `card.css`, `card.js` | The pop-up card |
| `src/gino.js` | Gino, drawn as SVG |
| `src/exercises.js` | The stretches |
| `preload.js` | The bridge between the card and the main process |

These are general desk stretches, not medical advice. Skip anything that hurts.
