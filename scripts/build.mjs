// Compiles the TypeScript into build/ with esbuild, one bundle per entry point.
// No type checking here: that's `npm run typecheck`. npm start, npm test, npm run screens
// and the dist scripts all run this first.
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

const common = { bundle: true, sourcemap: true, target: 'es2022', logLevel: 'warning' };
const node = { ...common, platform: 'node', format: 'cjs', external: ['electron'] };
const browser = { ...common, platform: 'browser', format: 'iife' };

const entries = [
  // the main process, and the bridge between it and the card window
  { ...node, entryPoints: ['main.ts'], outfile: 'build/main.js' },
  { ...node, entryPoints: ['preload.ts'], outfile: 'build/preload.js' },
  // the card window: one classic script, loaded by src/card.html
  { ...browser, entryPoints: ['src/card.ts'], outfile: 'build/card.js' },
  // Gino and the stretches as page globals (window.Gino, window.GinoExercises),
  // for the dev pages and the screens report's live cards
  { ...browser, entryPoints: ['src/gino.ts'], outfile: 'build/gino.js', globalName: 'Gino' },
  { ...browser, entryPoints: ['src/exercises.ts'], outfile: 'build/exercises.js', globalName: 'GinoExercises' },
  // the tests (plain Node) and the screens report (an Electron script)
  { ...node, entryPoints: ['test/scheduler.test.ts'], outfile: 'build/test/scheduler.test.js' },
  { ...node, entryPoints: ['test/placement.test.ts'], outfile: 'build/test/placement.test.js' },
  { ...node, entryPoints: ['dev/screens.ts'], outfile: 'build/dev/screens.js' },
];

const missing = entries.filter((e) => !existsSync(e.entryPoints[0]));
for (const e of missing) console.warn(`build: skipping ${e.entryPoints[0]} (not found)`);
await Promise.all(entries.filter((e) => !missing.includes(e)).map((e) => build(e)));
