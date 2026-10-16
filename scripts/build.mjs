// Compiles the TypeScript into build/ with esbuild, one bundle per entry point, and puts the
// card page together in build/web for the app. No type checking here: that's `npm run typecheck`.
// npm start, npm run fast and npm run dist run this first (beforeDevCommand / beforeBuildCommand
// in src-tauri/tauri.conf.json), as do npm test and npm run screens.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const common = { bundle: true, sourcemap: true, target: 'es2022', logLevel: 'warning' };
const node = { ...common, platform: 'node', format: 'cjs', external: ['electron'] };
const browser = { ...common, platform: 'browser', format: 'iife' };

const entries = [
  // the card window: one classic script, loaded by src/card.html
  { ...browser, entryPoints: ['src/card.ts'], outfile: 'build/card.js' },
  // Gino and the stretches as page globals (window.Gino, window.GinoExercises),
  // for the dev pages and the screens report's live cards
  { ...browser, entryPoints: ['src/gino.ts'], outfile: 'build/gino.js', globalName: 'Gino' },
  { ...browser, entryPoints: ['src/exercises.ts'], outfile: 'build/exercises.js', globalName: 'GinoExercises' },
  // the screens report (an Electron script; the tests are Rust now: cargo test)
  { ...node, entryPoints: ['dev/screens.ts'], outfile: 'build/dev/screens.js' },
];

const missing = entries.filter((e) => !existsSync(e.entryPoints[0]));
for (const e of missing) console.warn(`build: skipping ${e.entryPoints[0]} (not found)`);
await Promise.all(entries.filter((e) => !missing.includes(e)).map((e) => build(e)));

// The stretches as JSON, for the Rust side (src-tauri/src/exercises.rs compiles it in).
const sandbox = {};
runInNewContext(readFileSync('build/exercises.js', 'utf8'), sandbox);
writeFileSync('build/exercises.json', JSON.stringify(sandbox.GinoExercises.EXERCISES, null, 2));

// The card window's files in one folder, which Tauri packages into the app
// (frontendDist in src-tauri/tauri.conf.json). Emptied first, so nothing stale ships.
const WEB = 'build/web';
mkdirSync(WEB, { recursive: true });
for (const f of readdirSync(WEB)) rmSync(`${WEB}/${f}`, { recursive: true, force: true });
mkdirSync(`${WEB}/fonts`);

// The card's fonts: the stylesheets it links, cut down to their latin and latin-ext faces
// (woff2 only, which every web view the app runs in reads), and those font files.
const FONTS = [
  ['@fontsource-variable/shantell-sans/wght.css', 'shantell-sans-wght.css'],
  ['@fontsource/atkinson-hyperlegible/400.css', 'atkinson-hyperlegible-400.css'],
  ['@fontsource/atkinson-hyperlegible/700.css', 'atkinson-hyperlegible-700.css'],
];
for (const [from, to] of FONTS) {
  const dir = `node_modules/${from.slice(0, from.lastIndexOf('/'))}`;
  const faces = readFileSync(`node_modules/${from}`, 'utf8')
    .split(/(?=\/\*[^*]*\*\/\s*@font-face)/)
    .filter((face) => /-latin(-ext)?-[\w-]+\.woff2\)/.test(face))
    .map((face) =>
      face
        .trim()
        .replace(/,\s*url\([^)]*\.woff\) format\('woff'\)/g, '')
        .replace(/url\(\.\/files\/([\w-]+\.woff2)\)/g, (_, file) => {
          copyFileSync(`${dir}/files/${file}`, `${WEB}/fonts/${file}`);
          return `url(./${file})`;
        })
    );
  if (faces.length !== 2) throw new Error(`build: expected latin and latin-ext faces in ${from}, found ${faces.length}`);
  writeFileSync(`${WEB}/fonts/${to}`, `${faces.join('\n\n')}\n`);
}

// index.html is src/card.html, pointed at the files next to it. Its CSP meta comes out:
// Tauri sets the CSP from tauri.conf.json and adds its own IPC sources, which a meta in the
// page would block. (src/card.html keeps it for the dev tools, which load it in Electron.)
let page = readFileSync('src/card.html', 'utf8');
const swap = (from, to, what) => {
  const next = page.replace(from, to);
  if (next === page) throw new Error(`build: src/card.html changed shape, can't find ${what}`);
  page = next;
};
swap(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, '', 'the CSP meta');
for (const [from, to] of FONTS) swap(`href="../node_modules/${from}"`, `href="fonts/${to}"`, `the ${from} link`);
swap('<script src="../build/card.js"></script>', '<script src="card.js"></script>', 'the card.js script tag');
writeFileSync(`${WEB}/index.html`, page);
copyFileSync('src/card.css', `${WEB}/card.css`);
// The source map stays in build/, so drop the line pointing to it.
writeFileSync(`${WEB}/card.js`, readFileSync('build/card.js', 'utf8').replace(/\n\/\/# sourceMappingURL=\S*\s*$/, '\n'));
