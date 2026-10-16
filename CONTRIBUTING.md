# Contributing to Gino Desk Stretch

Thanks for helping Gino get people moving. Ideas, bug reports and code are all welcome, and you don't
need to write code to help.

## Ideas, questions and bugs

- **An idea you'd like to talk through, or a question:** start a
  [discussion](https://github.com/sim2390/gino-desk-stretch/discussions).
- **A specific idea** (a new stretch, a feature, an improvement): open an
  [issue](https://github.com/sim2390/gino-desk-stretch/issues/new/choose) with the **Idea** form.
- **Something that doesn't work:** open an issue with the **Bug report** form. Say which computer you
  use and what you saw; a screenshot helps a lot.

## Sending a change (pull requests)

For anything bigger than a small fix, please open an issue first, so we can agree on the approach
before you spend time on it.

1. Fork the repository and create a branch for your change.
2. Set it up. You need [Node.js](https://nodejs.org) 22.12 or newer, [Rust](https://rustup.rs), and
   your system's C++ build tools ([Development](docs/development.md#setup) lists them):
   ```
   npm install
   npm start          # or: npm run fast, where minutes become seconds
   ```
   The first start compiles Tauri, which takes a few minutes.
3. Make your change, then check it:
   ```
   npm run typecheck
   npm test
   cargo fmt --check --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
   npm run screens    # for changes to the card or Gino: look at screens/index.html
   ```
   `cargo fmt --manifest-path src-tauri/Cargo.toml` fixes the formatting for you. To run the same
   checks on GitHub before you open a pull request, start the **Check** workflow on your branch from
   your fork's **Actions** tab ("Run workflow").
4. Open a pull request. The template has a short checklist, and the same checks run automatically.

Keep each pull request to one change. Small pull requests get reviewed and merged much faster.

## Where things are

- [Development](docs/development.md): how the app fits together, the build, the tests.
- [Customizing Gino](docs/customizing.md): the stretches, guided reps, poses and moves.

## Guidelines

- **Rust for the app, strict TypeScript for the card.** The app is in [`src-tauri/src`](src-tauri/src).
  The card's shared shapes are in [`src/types.ts`](src/types.ts). Avoid `any`.
- **Logic that doesn't need Tauri goes in its own module, with tests,** like
  [`scheduler.rs`](src-tauri/src/scheduler.rs) and [`placement.rs`](src-tauri/src/placement.rs).
- **Match the code around you.** Comments explain *why*, not what.
- **The card keeps one height while the timer runs.** Every height change moves the window.
- **Gino stays private.** No network access, no accounts, no tracking. Everything stays on the
  person's computer.
- **Motion:** Gino's exercise demonstrations always play; decorative motion respects reduced-motion
  settings.

## New stretches

- Gentle, well-known desk stretches that are safe for most people, done seated or next to the desk,
  with no equipment.
- Plain, friendly steps. No medical claims.
- Make sure `dose` and the `howTo` steps match the timings.
- Add screenshots from `npm run screens` to your pull request.

## Code of conduct

Please be kind. See the [code of conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
