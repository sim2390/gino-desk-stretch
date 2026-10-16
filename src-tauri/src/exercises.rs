// The stretches. src/exercises.ts is the source; the build (scripts/build.mjs) writes it
// out as build/exercises.json, which is compiled in here.

use serde_json::Value;

const JSON: &str = include_str!("../../build/exercises.json");

/// Every stretch, as the card expects it (the `exercise` in a show payload).
pub fn all() -> Vec<Value> {
    serde_json::from_str(JSON)
        .expect("build/exercises.json is written by the build from src/exercises.ts")
}

/// The walkaround takes every third turn (see store::Stats::pick_next).
pub fn is_walk(exercise: &Value) -> bool {
    exercise
        .get("walk")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}
