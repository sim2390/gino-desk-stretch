// Gino: a desk stretch coach that lives in the tray (Windows) or menu bar (macOS).
// The Rust side runs the tray, the timer and the card window; the card itself is
// the TypeScript in src/ (card.ts, gino.ts), shown in the system's web view.

mod app;
mod card;
mod exercises;
mod placement;
mod platform;
mod scheduler;
mod store;
mod tray;

pub fn run() {
    app::run()
}
