# Changelog

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
