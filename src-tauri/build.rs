fn main() {
    // Gino's own commands get permissions (allow-card-ready and so on), so the card page may
    // call only what capabilities/default.json grants it, like any plugin command.
    let commands = tauri_build::AppManifest::new().commands(&[
        "card_ready",
        "card_action",
        "card_resize",
        "card_closed",
    ]);
    let attributes = tauri_build::Attributes::new().app_manifest(commands);
    if let Err(e) = tauri_build::try_build(attributes) {
        panic!("tauri-build failed: {e:#}");
    }
}
