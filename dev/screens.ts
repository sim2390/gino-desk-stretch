// Renders every screen of the Gino card into screens/:
//   NN-*.png      a still of every card state, 2x
//   live.html     the real card running in a frame, made from src/card.html, with
//                 copies of card.css, card.js and exercises.js next to it
//   index.html    the report, a full page for opening locally
//   page.html     the same report as a page fragment (no <html>/<head>/<body>), for publishing
//   files.json    every file page.html needs next to it
//
//   npm run screens
//
// This is an Electron main script, built to build/dev/screens.js. For the stills it loads the
// real src/card.html in a hidden window with no preload, so card.js runs without window.ginoApi,
// and drives it through the window.__card hooks. It never starts the app itself and keeps its
// own data folder, so a running Gino and its settings are left alone.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { app, BrowserWindow, type NativeImage } from 'electron';
import { EXERCISES } from '../src/exercises';
import type { CardContent, CardMode, Exercise, RepPhase, Settings, ShowPayload } from '../src/types';

const ROOT = path.join(__dirname, '..', '..'); // this runs from build/dev
const OUT = path.join(ROOT, 'screens');
const SRC = path.join(ROOT, 'src');
const BUILD = path.join(ROOT, 'build');
const CARD_HTML = path.join(SRC, 'card.html');

const ZOOM = 2; // the PNGs are 2x the card's CSS size
const VIEW_W = 440; // WIN_W in main.ts: the real card window is this wide
let viewH = 640; // CSS px. Far taller than any card; grows if a card ever gets clipped.

const TITLE = 'Gino Card Screens';
const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Shantell+Sans:wght@300..800&display=swap';
// The card's own files, copied next to live.html, and where each comes from. card.js is the
// build's bundle of the card and Gino; exercises.js puts the stretches on window.GinoExercises.
const LIVE_FILES: Record<string, string> = {
  'card.css': path.join(SRC, 'card.css'),
  'card.js': path.join(BUILD, 'card.js'),
  'exercises.js': path.join(BUILD, 'exercises.js'),
};

// ---------- facts read from main.ts, so the report follows the app ----------

const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'main.ts'), 'utf8');
// The body of `const NAME = { ... };`, also with a type after NAME or `as const` after the }.
const objectBody = (name: string) =>
  (MAIN_SRC.match(new RegExp(`const ${name}(?::[^=]*)? = \\{([\\s\\S]*?)\\n\\}[^;\\n]*;`)) || [])[1] || '';

type NumberSettings = Pick<Settings, 'intervalMin' | 'snoozeMin' | 'idleResetMin' | 'autoSnoozeMin'>;
const S: NumberSettings & Record<string, number> = { intervalMin: 20, snoozeMin: 10, idleResetMin: 5, autoSnoozeMin: 4 };
for (const [, k, v] of objectBody('DEFAULT_SETTINGS').matchAll(/^\s*(\w+):\s*(\d+)/gm)) S[k] = Number(v);

const BUSY = new Map<string, number[]>(); // reason -> Windows notification states (BUSY_STATES)
for (const [, n, reason] of objectBody('BUSY_STATES').matchAll(/(\d+):\s*'([^']*)'/g)) {
  BUSY.set(reason, [...(BUSY.get(reason) || []), Number(n)]);
}
const CALL_REASON = (MAIN_SRC.match(/r\.mic\)[^\n]*reason:\s*'([^']*)'/) || [])[1] || 'you seem to be on a call';
const INTERVALS = ((MAIN_SRC.match(/label: 'Remind me every',\s*submenu: \[([\d,\s]+)\]/) || [])[1] || '15, 20, 30, 45, 60')
  .split(',')
  .map(Number);
const TOMORROW_AT = Number((MAIN_SRC.match(/setHours\((\d+),/) || [])[1] || 6);
const HAS_RESET_ITEM = MAIN_SRC.includes('Reset card position');

// The welcome card is built by welcomeCard() in main.ts from the running app's settings,
// so it is copied here: the Windows wording, with the default interval.
const WELCOME: CardContent = {
  id: 'welcome',
  name: "Hi, I'm Gino",
  pose: 'wave',
  text: `Every ${S.intervalMin} minutes of screen time I'll pop up with a short stretch. I live in the tray by the clock. If you can't see me, I'm under the ^ arrow: drag me out.`,
  dose: '',
  howTo: [],
};

// What main.ts sends with every card. autoSnoozeMin 0 so no card snoozes itself mid-capture.
const BASE = { todayCount: 2, snoozeMin: S.snoozeMin, intervalMin: S.intervalMin, autoSnoozeMin: 0 };
// A scene's card. The stretches leave mode out: the card shows anything but 'welcome' as a stretch.
type Payload = Omit<ShowPayload, 'mode'> & { mode?: CardMode };

const repPhases = (ex: CardContent): RepPhase[] =>
  Array.isArray(ex.rep) ? ex.rep.filter((p) => p && Number(p.seconds) > 0) : [];
// The timer's length without "Get ready", worked out as buildPlan() in card.ts does.
function workSeconds(ex: CardContent): number {
  const phases = repPhases(ex);
  if (phases.length) return Math.max(1, Math.round(ex.reps || 1)) * phases.reduce((a, p) => a + Number(p.seconds), 0);
  return Math.max(5, ex.seconds || (ex.sides ? 40 : 30));
}
// main.ts shows the stretches in turn, starting with the first that isn't the walkaround.
const FIRST = EXERCISES.find((e) => !e.walk) || EXERCISES[0];

// ---------- Electron setup: own name and data folder, exact 2x pixels ----------

app.setName('Gino screens');
app.setPath('userData', path.join(os.tmpdir(), 'gino-screens'));
app.commandLine.appendSwitch('force-device-scale-factor', '1'); // so zoom 2 is exactly 2x on any display

// ---------- rendering the stills ----------

// Same idea as dev/preview.html?still: no motion, so every still shows the settled layout.
// Gino's rep moves are transitions, so each lands on the end of its move. (The shoulder-roll
// dot is an animation, so in the stills it stays where it starts.)
const FREEZE_CSS = '*, *::before, *::after { animation: none !important; transition: none !important; }';
// Stop the card's clock too, so a timer reads the same however long a capture takes, and
// its timeouts, so the reminder's demo loop (it starts moving Gino 650 ms after the card
// shows) never starts and an ending never closes. MEASURE waits with the real one, sleep.
const FREEZE_JS = `
  const sleep = window.setTimeout.bind(window);
  const t = performance.now();
  Object.defineProperty(performance, 'now', { configurable: true, value: () => t });
  window.setTimeout = () => 0;
`;

// What MEASURE sends back from the page.
interface CardInfo {
  rect: { left: number; top: number; right: number; bottom: number };
  pad: { top: number; right: number; bottom: number; left: number };
  view: { w: number; h: number };
  state: string | undefined;
  big: string;
  sub: string;
  mirrored: boolean;
  motionOk: boolean;
  fontsOk: boolean;
}

const MEASURE = `
  document.body.offsetHeight;
  await document.fonts.ready;
  await new Promise((r) => sleep(r, 150)); // not requestAnimationFrame: a hidden window may never fire it
  document.body.offsetHeight;
  await document.fonts.ready;
  const card = document.getElementById('card');
  const stage = getComputedStyle(document.querySelector('.stage'));
  const r = card.getBoundingClientRect();
  const shown = (id) => {
    const el = document.getElementById(id);
    return el && !el.closest('[hidden]') ? el.textContent.trim() : '';
  };
  return {
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    pad: {
      top: parseFloat(stage.paddingTop),
      right: parseFloat(stage.paddingRight),
      bottom: parseFloat(stage.paddingBottom),
      left: parseFloat(stage.paddingLeft),
    },
    view: { w: innerWidth, h: innerHeight },
    state: card.dataset.state,
    big: shown('big'),
    sub: shown('sub'),
    mirrored: !!document.querySelector('.plate.mirror'),
    motionOk: matchMedia('(prefers-reduced-motion: no-preference)').matches,
    fontsOk: document.fonts.check('600 21px "Shantell Sans Variable"') && document.fonts.check('13px "Atkinson Hyperlegible"'),
  };
`;

let captureRetries = 0;
const warnings: string[] = [];
const warn = (msg: string) => {
  warnings.push(msg);
  console.warn(`  ! ${msg}`);
};

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(id));
}

function makeWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: VIEW_W * ZOOM,
    height: viewH * ZOOM,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      zoomFactor: ZOOM,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') warn(`card console: ${e.message}`);
  });
  return win;
}

// A fresh card per scene: reload, freeze, run the scene, then measure.
async function render(win: BrowserWindow, code: string, data: Payload): Promise<CardInfo> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await withTimeout(win.loadFile(CARD_HTML), 15000, 'loading card.html');
    win.webContents.setZoomFactor(ZOOM);
    await win.webContents.insertCSS(FREEZE_CSS);
    const info = await withTimeout<CardInfo>(
      win.webContents.executeJavaScript(`(async () => {
        ${FREEZE_JS}
        const c = window.__card;
        if (!c) throw new Error('window.__card is missing. Is build/card.js missing, or src/card.ts half-edited? Wait a minute and re-run.');
        const d = ${JSON.stringify(data)};
        ${code}
        ${MEASURE}
      })()`),
      15000,
      'running a scene'
    );
    const top = info.rect.top - info.pad.top;
    if (top >= 0) return info;
    // The card is taller than the window: grow it and go again.
    viewH += Math.ceil(-top) + 120;
    win.setContentSize(VIEW_W * ZOOM, viewH * ZOOM);
  }
  throw new Error('the card is still clipped after growing the window');
}

// Crop to the card plus the window's transparent margin (the .stage padding), so the
// drop shadow comes along, exactly as the real card window frames it.
async function capture(win: BrowserWindow, info: CardInfo, file: string) {
  const x = Math.floor(info.rect.left - info.pad.left);
  const y = Math.floor(info.rect.top - info.pad.top);
  const w = Math.min(info.view.w, Math.ceil(info.rect.right + info.pad.right)) - x;
  const h = Math.min(info.view.h, Math.ceil(info.rect.bottom + info.pad.bottom)) - y;
  const rect = { x: x * ZOOM, y: y * ZOOM, width: w * ZOOM, height: h * ZOOM };
  let img: NativeImage | null = null;
  // A hidden window can hand back the frame before the last change: take one to throw away.
  await withTimeout(win.webContents.capturePage(rect, { stayHidden: true }), 15000, 'capturePage').catch(() => {});
  // It sometimes has no frame ready yet either (Chromium says "UnknownVizError"): ask again.
  for (let attempt = 1; !img; attempt++) {
    try {
      img = await withTimeout(win.webContents.capturePage(rect, { stayHidden: true }), 15000, 'capturePage');
      if (img.isEmpty()) throw new Error('capturePage returned an empty image');
    } catch (e) {
      img = null;
      if (attempt >= 5) throw e;
      captureRetries++;
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  const size = img.getSize();
  if (size.width !== w * ZOOM || size.height !== h * ZOOM) {
    img = img.resize({ width: w * ZOOM, height: h * ZOOM, quality: 'best' });
  }
  fs.writeFileSync(file, img.toPNG());
  const cornerAlpha = img.toBitmap()[3]; // BGRA, top-left pixel: should be see-through
  return { w, h, cornerAlpha };
}

// ---------- scenes ----------

type Section = 'first' | 'stretch' | 'ending';
interface Scene {
  section: Section;
  group?: Exercise | null; // the stretch it belongs to, if any
  slug: string;
  label: string;
  note?: string | ((info: CardInfo) => string);
  code: string; // run in the page, with the hooks as c and the payload as d
  data: Payload;
}
interface Shot {
  section: Section;
  group: Exercise | null;
  file: string;
  label: string;
  note: string;
  info: CardInfo;
  w: number; // CSS px; the PNG is ZOOM times this
  h: number;
  cornerAlpha: number;
}
// How a stretch's timer was shown: each part of a guided rep, both sides, or one screen.
type TimerKind = 'reps' | 'sides' | 'timer';
// What the card.js in use has (see run()).
interface Probe {
  card: boolean;
  jumpTo: boolean;
}

const shots: Shot[] = [];
let seq = 0;

const slugify = (s: string) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function shoot(win: BrowserWindow, { section, group = null, slug, label, note = '', code, data }: Scene) {
  const info = await render(win, code, data);
  const file = `${String(++seq).padStart(2, '0')}-${slug}.png`;
  const cap = await capture(win, info, path.join(OUT, file));
  const text = typeof note === 'function' ? note(info) : note;
  shots.push({ section, group, file, label, note: text, info, ...cap });
  if (!info.fontsOk) warn(`${file}: the card fonts had not loaded`);
  if (!info.motionOk) warn(`${file}: reduced motion is on, so Gino's moves may be missing`);
  if (cap.cornerAlpha !== 0) warn(`${file}: the margin is not transparent (corner alpha ${cap.cornerAlpha})`);
  console.log(`  ${file.padEnd(36)} ${cap.w}x${cap.h}  ${label}${text ? ` (${text})` : ''}`);
  return info;
}

const timerNote = (info: CardInfo) => [info.big && `${info.big} left`, info.sub].filter(Boolean).join(' · ');

// The running timer, by the kind of stretch.
async function shootTimer(win: BrowserWindow, ex: Exercise, p: Payload, slug: string, hasJumpTo: boolean): Promise<TimerKind> {
  const at = (f: number) => Math.round(workSeconds(ex) * f);
  const phases = repPhases(ex);

  if (hasJumpTo && phases.length) {
    const mark = shots.length;
    try {
      await shoot(win, {
        section: 'stretch',
        group: ex,
        slug: `${slug}-get-ready`,
        label: 'Get ready',
        note: 'the lead-in before rep 1',
        code: 'c.show(d); c.start(); c.jumpTo(0);',
        data: p,
      });
      for (const [k, phase] of phases.entries()) {
        await shoot(win, {
          section: 'stretch',
          group: ex,
          slug: `${slug}-rep2-${k + 1}`,
          label: `Rep 2: ${phase.cue}`,
          note: `part ${k + 1} of ${phases.length}, ${phase.seconds} s`,
          code: `c.show(d); c.start(); c.jumpTo(2, ${k});`,
          data: p,
        });
      }
      return 'reps';
    } catch (e) {
      warn(`${ex.id}: guided rep screens failed (${e instanceof Error ? e.message : e}); showing one timer screen instead`);
      for (const s of shots.splice(mark)) fs.rmSync(path.join(OUT, s.file), { force: true });
    }
  }

  // With jumpTo, rep 1 is the hold (for sides, 1 and 2 are the two sides); without, a time.
  const goTo = (rep: number, f: number) => (hasJumpTo ? `c.jumpTo(${rep});` : `c.setElapsed(${at(f)});`);

  if (ex.sides) {
    await shoot(win, {
      section: 'stretch',
      group: ex,
      slug: `${slug}-timer-first-side`,
      label: 'Timer, first side',
      note: (i) => i.big && `${i.big} left`,
      code: `c.show(d); c.start(); ${goTo(1, 0.25)}`,
      data: p,
    });
    const info = await shoot(win, {
      section: 'stretch',
      group: ex,
      slug: `${slug}-timer-other-side`,
      label: 'Timer, other side',
      note: (i) => [i.big && `${i.big} left`, 'Gino flips halfway'].filter(Boolean).join(' · '),
      code: `c.show(d); c.start(); ${goTo(2, 0.75)}`,
      data: p,
    });
    if (!info.mirrored) warn(`${ex.id}: Gino is not mirrored on the other side`);
    return 'sides';
  }

  await shoot(win, {
    section: 'stretch',
    group: ex,
    slug: `${slug}-timer`,
    label: 'Timer',
    note: timerNote,
    code: `c.show(d); c.start(); ${goTo(1, 0.35)}`,
    data: p,
  });
  return 'timer';
}

// Everything this writes to screens/. gino.js too: older runs copied it next to live.html.
const GENERATED = /^(\d+-[a-z0-9-]+\.png|index\.html|page\.html|live\.html|files\.json|card\.css|card\.js|gino\.js|exercises\.js)$/;

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (GENERATED.test(f)) fs.rmSync(path.join(OUT, f));

  const win = makeWindow();
  await withTimeout(win.loadFile(CARD_HTML), 15000, 'loading card.html');

  // card.css only moves Gino when the system doesn't ask for reduced motion. Say it doesn't,
  // so the stills show his moves whatever this computer is set to. (Needs a loaded page.)
  win.webContents.debugger.attach('1.3');
  await withTimeout(
    win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    }),
    10000,
    'emulating motion'
  );

  // Does this card.js have the guided-rep hook yet?
  const probe: Probe = await win.webContents.executeJavaScript(
    `({ card: !!window.__card, jumpTo: !!(window.__card && typeof window.__card.jumpTo === 'function') })`
  );
  if (!probe.card) throw new Error('window.__card is missing. Is build/card.js missing, or src/card.ts half-edited? Wait a minute and re-run.');
  const withRep = EXERCISES.filter((e) => repPhases(e).length).map((e) => e.id);
  console.log(`Card: jumpTo ${probe.jumpTo ? 'found' : 'not found'}; exercises with rep phases: ${withRep.join(', ') || 'none'}`);

  console.log('First run');
  await shoot(win, {
    section: 'first',
    slug: 'welcome',
    label: 'Welcome',
    note: 'shown once, the first time Gino starts',
    code: 'c.show(d);',
    data: { ...BASE, mode: 'welcome', exercise: WELCOME },
  });

  console.log('Stretches');
  const timerKinds: Record<string, TimerKind> = {};
  for (const [i, ex] of EXERCISES.entries()) {
    const slug = slugify(ex.id || ex.name);
    const p: Payload = { ...BASE, exercise: ex };
    await shoot(win, {
      section: 'stretch',
      group: ex,
      slug: `${slug}-reminder`,
      label: 'Reminder',
      note: i === 0 ? 'first of the day, so it says “First one today”' : '',
      code: 'c.show(d);',
      data: i === 0 ? { ...p, todayCount: 0 } : p,
    });
    if (ex.howTo && ex.howTo.length) {
      await shoot(win, {
        section: 'stretch',
        group: ex,
        slug: `${slug}-howto`,
        label: 'How to, open',
        code: 'c.show(d); c.toggleHowTo();',
        data: p,
      });
    }
    timerKinds[ex.id] = await shootTimer(win, ex, p, slug, probe.jumpTo);
  }

  console.log('Endings');
  const ex = EXERCISES.find((e) => e.id === 'chin-tucks') || FIRST;
  const p: Payload = { ...BASE, exercise: ex };
  const stopAt = Math.round(workSeconds(ex) * 0.4);
  // slug, label, note, the scene, its card
  const endings: [string, string, string, string, Payload][] = [
    ['done-first', 'Done, first of the day', 'the timer ran out, or Done was pressed', 'c.show(d); await c.finish();', { ...p, todayCount: 0 }],
    ['done-later', 'Done, later in the day', 'the count includes this one', 'c.show(d); await c.finish();', p],
    ['snoozed', 'Snoozed', `after Snooze ${S.snoozeMin} min`, 'c.show(d); c.snooze(false);', p],
    ['skipped', 'Skipped', 'after Skip on the reminder', "c.show(d); c.skip('skip');", p],
    ['stopped', 'Stopped', 'after Stop during the timer: not counted', `c.show(d); c.start(); c.setElapsed(${stopAt}); c.skip('stop');`, p],
  ];
  for (const [slug, label, note, code, data] of endings) {
    await shoot(win, { section: 'ending', slug: `end-${slug}`, label, note, code, data });
  }

  win.destroy();
  checkMenuLabels();

  // The live card: the card's files, and live.html made from card.html.
  // The build's source maps aren't published with the page, so drop the line pointing to them.
  for (const [f, from] of Object.entries(LIVE_FILES)) {
    const text = fs.readFileSync(from, 'utf8').replace(/\n\/\/# sourceMappingURL=\S*\s*$/, '\n');
    fs.writeFileSync(path.join(OUT, f), text);
  }
  fs.writeFileSync(path.join(OUT, 'live.html'), liveHtml());

  const { fragment, full } = report({ probe, timerKinds });
  fs.writeFileSync(path.join(OUT, 'page.html'), fragment);
  fs.writeFileSync(path.join(OUT, 'index.html'), full);

  const files = [...shots.map((s) => s.file), 'live.html', ...Object.keys(LIVE_FILES)];
  fs.writeFileSync(path.join(OUT, 'files.json'), `${JSON.stringify(files, null, 2)}\n`);
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);

  const repMode = Object.values(timerKinds).includes('reps');
  console.log(`\n${shots.length} stills, ${EXERCISES.length + 1} live cards, the tray menu`);
  console.log(`  local report:   ${path.join(OUT, 'index.html')}`);
  console.log(`  page fragment:  ${path.join(OUT, 'page.html')} + ${files.length} files in files.json (${(bytes / 1e6).toFixed(1)} MB)`);
  console.log(`Rep stills: ${repMode ? 'guided (jumpTo)' : 'one timer screen per stretch (no jumpTo or no rep phases)'}`);
  if (captureRetries) console.log(`(capturePage needed ${captureRetries} retry/retries; the images are fine)`);
  if (warnings.length) console.log(`${warnings.length} warning(s), see above.`);
}

// The menu mock copies labels from buildMenu() in main.ts. Say so if they drift apart.
function checkMenuLabels() {
  const labels = [
    'Stretch now', 'Pause', 'Resume', 'For 30 minutes', 'For 1 hour', 'For 2 hours', 'Until tomorrow',
    'Remind me every', 'Hold off during calls and full-screen apps', 'Start with Windows', 'Quit Gino',
    'No stretches yet today', 'Done today: ', 'Stretch on screen', 'Holding off: ', 'Paused until ', 'Next stretch in ',
  ];
  for (const l of labels) if (!MAIN_SRC.includes(l)) warn(`menu mock label "${l}" is not in main.ts any more`);
  if (!HAS_RESET_ITEM) console.log('  (note) "Reset card position" is not in main.ts yet; the mock shows it as new');
}

// ---------- live.html: the real card in a frame ----------

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

// Made from src/card.html so it stays in step with the app. Stands in for preload.ts and
// main.ts: the card shows the card named in the hash (live.html#chin-tucks), and when it
// closes, it comes back, so each frame loops forever.
function liveHtml(): string {
  let html = fs.readFileSync(CARD_HTML, 'utf8');
  const swap = (from: string | RegExp, to: string, what: string) => {
    const next = html.replace(from, to);
    if (next === html) throw new Error(`src/card.html changed shape: can't find ${what}`);
    html = next;
  };
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, '');
  html = html.replace(/<link[^>]*href="\.\.\/node_modules\/[^"]*"[^>]*>\s*/g, '');
  swap(/<!doctype html>\s*/i, '<!doctype html>\n<!-- Made by dev/screens.ts from src/card.html. Edit those, not this. -->\n', 'the doctype');
  swap(/<meta charset="utf-8">/i, '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">', 'the charset meta');
  html = html.replace(/<title>[^<]*<\/title>/i, '<title>Gino live card</title>');
  swap('<link rel="stylesheet" href="card.css">', `<link rel="stylesheet" href="${esc(GOOGLE_FONTS)}">\n<link rel="stylesheet" href="card.css">`, 'the card.css link');

  const shim = `<script src="exercises.js"></script>
<script>
// Stands in for preload.ts: exercises.js has put the stretches on window.GinoExercises.
(() => {
  const EXERCISES = window.GinoExercises.EXERCISES;
  const WELCOME = ${scriptJson(WELCOME)};
  const FIRST = ${scriptJson(FIRST.id)};
  const home = decodeURIComponent(location.hash.slice(1)) || 'welcome';
  let count = 2;
  let next = null;
  let onShow = null;
  const payload = (key) => {
    const welcome = key === 'welcome';
    const exercise = welcome ? WELCOME : EXERCISES.find((e) => e.id === key) || EXERCISES[0];
    return { mode: welcome ? 'welcome' : 'stretch', exercise, todayCount: count, snoozeMin: ${S.snoozeMin}, intervalMin: ${S.intervalMin}, autoSnoozeMin: 0 };
  };
  window.ginoLive = { show: (key) => onShow && onShow(payload(key || home)) };
  window.ginoApi = {
    onShow: (cb) => { onShow = cb; },
    onHide: () => {},
    action: (name) => {
      if (name === 'done') return Promise.resolve({ todayCount: ++count });
      if (name === 'trynow') next = FIRST;
      return Promise.resolve({});
    },
    // the page around the frame sets its height: the card's height changes between states
    resize: (h) => { if (parent !== window) parent.postMessage({ gino: 'resize', id: home, h }, '*'); },
    // the card closed: bring it back (after "Try one now", the first stretch)
    closed: () => {
      const key = next || home;
      next = null;
      setTimeout(() => window.ginoLive.show(key), 1500);
    },
  };
})();
</script>
<script src="card.js"></script>
<script>
(() => {
  window.ginoLive.show();
  // Keep the frame as tall as the card, also when the web fonts arrive late.
  const card = document.getElementById('card');
  const stage = getComputedStyle(document.querySelector('.stage'));
  const room = parseFloat(stage.paddingTop) + parseFloat(stage.paddingBottom);
  if (window.ResizeObserver) new ResizeObserver(() => window.ginoApi.resize(card.offsetHeight + room)).observe(card);
})();
</script>`;
  swap('<script src="../build/card.js"></script>', shim, 'the card.js script tag');
  return html;
}

// ---------- the report ----------

const fmtDur = (sec: number) => {
  const t = Math.round(sec);
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
};

function figure(s: Shot) {
  const alt = `${s.group ? `${s.group.name}: ` : ''}${s.label}${s.note ? `, ${s.note}` : ''}`;
  return `<figure class="shot" style="width:${s.w + 8}px">
  <div class="desk"><img src="${esc(s.file)}" width="${s.w}" height="${s.h}" alt="${esc(alt)}"></div>
  <figcaption><b>${esc(s.label)}</b>${s.note ? ` · ${esc(s.note)}` : ''}</figcaption>
</figure>`;
}

// Shown only when the viewer's system asks for reduced motion. What the card does then
// depends on card.css: if Gino's moves sit behind "prefers-reduced-motion: no-preference",
// he stands still.
function motionNote() {
  const css = fs.readFileSync(path.join(SRC, 'card.css'), 'utf8');
  let movesNeedMotion = false;
  for (const m of css.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    if (/data-move/.test(css.slice(m.index, i))) movesNeedMotion = true;
  }
  const text = movesNeedMotion
    ? `<b>Your system is set to reduce motion,</b> so Gino stands still here, as he does in the app. The timer and its cues still run. To see him move, turn on Animation effects (Windows: Settings › Accessibility › Visual effects) or turn off Reduce motion (Mac: Accessibility › Display), then reload.`
    : `<b>Your system is set to reduce motion,</b> so the card leaves out its decorative motion here, as it does in the app.`;
  return `<p class="note motion-note">${text}</p>`;
}

function liveHint(ex: CardContent) {
  if (ex === WELCOME) return 'Press Try one now to get the first stretch';
  if (repPhases(ex).length) return 'Press Start to run it: Gino moves with each rep';
  if (ex.sides) return 'Press Start to run it: Gino switches sides halfway';
  return 'Press Start to run the timer';
}

function liveFigure(ex: CardContent, h: number) {
  const id = ex === WELCOME ? 'welcome' : ex.id;
  if (!/^[A-Za-z0-9-]+$/.test(id)) warn(`exercise id "${id}" isn't letters, digits and dashes: its live frame may not find it`);
  return `<figure class="shot live-fig" style="width:${VIEW_W + 8}px">
  <div class="desk"><div class="live-box" style="height:${h}px"><iframe src="live.html#${esc(id)}" title="Live card: ${esc(ex.name)}" width="${VIEW_W}" height="${h}"></iframe></div></div>
  <figcaption><b>${esc(ex.name)}</b><br>${esc(liveHint(ex))}</figcaption>
</figure>`;
}

// Windows 11 style context menu, drawn in HTML.
const ROW = 28;
const SEP = 9;
const PAD = 4;
const CHECK = '<svg class="mark" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.6l3.1 3L13 4.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOT = '<i class="mark dot" aria-hidden="true"></i>';
const CHEV = '<svg class="chev" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CARET = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 10L8 5.5L12.5 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// A menu row ('sep' for a separator): dis greyed out, hot under the pointer, sub has a submenu.
type MenuItem = 'sep' | { label: string; dis?: boolean; hot?: boolean; check?: boolean; radio?: boolean; sub?: boolean };

const menuHeight = (items: MenuItem[]) => items.reduce((h, it) => h + (it === 'sep' ? SEP : ROW), PAD * 2);
function rowTop(items: MenuItem[], label: string) {
  let y = PAD;
  for (const it of items) {
    if (it !== 'sep' && it.label === label) return y;
    y += it === 'sep' ? SEP : ROW;
  }
  return PAD;
}

function menuHtml(items: MenuItem[], cls = '', style = '') {
  const rows = items.map((it) => {
    if (it === 'sep') return '<div class="sep"></div>';
    const c = ['mi', it.dis && 'dis', it.hot && 'hot'].filter(Boolean).join(' ');
    return `<div class="${c}">${it.check ? CHECK : ''}${it.radio ? DOT : ''}<span>${esc(it.label)}</span>${it.sub ? CHEV : ''}</div>`;
  });
  return `<div class="w11 ${cls}" role="presentation"${style ? ` style="${style}"` : ''}>${rows.join('')}</div>`;
}

function trayItems({ paused, hot, resetOn }: { paused: boolean; hot?: string; resetOn?: boolean }): MenuItem[] {
  return [
    { label: paused ? 'Paused until 15:30' : 'Next stretch in 14 min', dis: true },
    { label: 'Done today: 2', dis: true },
    'sep',
    { label: 'Stretch now' },
    paused ? { label: 'Resume' } : { label: 'Pause', sub: true, hot: hot === 'Pause' },
    'sep',
    { label: 'Remind me every', sub: true, hot: hot === 'Remind me every' },
    { label: 'Hold off during calls and full-screen apps', check: true },
    { label: 'Start with Windows' },
    { label: 'Reset card position', dis: !resetOn },
    'sep',
    { label: 'Quit Gino' },
  ];
}

let TRAY_ICON = '';
try {
  TRAY_ICON = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'assets', 'tray@2x.png')).toString('base64')}`;
} catch {
  TRAY_ICON = '';
}

function trayMock(items: MenuItem[], sub: { parent: string; items: MenuItem[] } | null, clock: string) {
  let subHtml = '';
  if (sub) {
    // Line the submenu up with its item, but keep it above the taskbar like Windows does.
    const top = Math.max(0, Math.min(rowTop(items, sub.parent) - PAD, menuHeight(items) - menuHeight(sub.items)));
    subHtml = menuHtml(sub.items, 'sub', `margin-top:${top}px`);
  }
  const icon = TRAY_ICON ? `<img src="${TRAY_ICON}" width="16" height="16" alt="">` : 'G';
  return `<div class="desk tray">
  <div class="menus">${subHtml}${menuHtml(items)}</div>
  <div class="taskbar" aria-hidden="true"><span class="ico">${CARET}</span><span class="ico on">${icon}</span><span class="clock">${clock}</span></div>
</div>`;
}

const BUSY_WHEN: Record<string, string> = {
  'screen locked': 'Windows says the screen is locked',
  'full-screen app': 'an app is full screen',
  'full-screen game': 'a full-screen game is running',
  'presentation mode': 'Windows is in presentation mode, as during a slideshow',
};

// Theme: every color is a token. Light on :root, dark for a dark system unless the page
// is set to light, and dark again when the page is set to dark.
const LIGHT: Record<string, string> = {
  bg: '#F4F6F1',
  panel: '#FBFCF9',
  fg: '#2E3327', // ink
  muted: '#5C6656',
  rule: '#D8DFD2',
  accent: '#4F6E46', // sage
  butter: '#E9B84A',
  chip: '#E7EDE3', // sage mist
  desk: 'radial-gradient(120% 100% at 90% 100%, rgba(255, 255, 255, .32), rgba(255, 255, 255, 0) 60%), linear-gradient(155deg, #B4C2CE, #8FA1B2)',
  'w11-bg': '#F9F9F9',
  'w11-fg': '#1B1B1B',
  'w11-dis': '#9B9B9B',
  'w11-line': 'rgba(0, 0, 0, .085)',
  'w11-hot': 'rgba(0, 0, 0, .055)',
  'w11-shadow': '0 8px 16px rgba(0, 0, 0, .16), 0 0 2px rgba(0, 0, 0, .1)',
  'w11-bar': 'rgba(240, 242, 245, .92)',
};
const DARK: Record<string, string> = {
  bg: '#141713',
  panel: '#1B1F1A',
  fg: '#E4E8DF',
  muted: '#A3AC9B',
  rule: '#2E342B',
  accent: '#A9C99B',
  butter: '#E9B84A',
  chip: '#252B23',
  desk: 'radial-gradient(120% 100% at 90% 100%, rgba(255, 255, 255, .10), rgba(255, 255, 255, 0) 60%), linear-gradient(155deg, #566677, #3B4755)',
  'w11-bg': '#2C2C2C',
  'w11-fg': '#F3F3F3',
  'w11-dis': '#7C7C7C',
  'w11-line': 'rgba(255, 255, 255, .085)',
  'w11-hot': 'rgba(255, 255, 255, .075)',
  'w11-shadow': '0 8px 18px rgba(0, 0, 0, .4), 0 0 0 1px rgba(0, 0, 0, .3)',
  'w11-bar': 'rgba(30, 30, 30, .92)',
};
const tokens = (t: Record<string, string>, indent: string) => Object.entries(t).map(([k, v]) => `${indent}--${k}: ${v};`).join('\n');

const CSS = `
:root {
${tokens(LIGHT, '  ')}
  color-scheme: light;
  --text: "Atkinson Hyperlegible", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  --display: "Shantell Sans", "Shantell Sans Variable", "Segoe Print", "Chalkboard SE", "Comic Sans MS", cursive;
  --mono: ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace;
  --menu: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${tokens(DARK, '    ')}
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
${tokens(DARK, '  ')}
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.5 var(--text);
  -webkit-text-size-adjust: 100%;
}
a { color: var(--accent); }
code { font: 13px/1.4 var(--mono); background: var(--chip); padding: 1px 5px; border-radius: 5px; }
.page {
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  padding-block: 0 32px;
}
.wrap { max-width: 1920px; margin: 0 auto; }
@media (min-width: 720px) { .wrap { padding: 0 12px; } }

header.top { padding: 28px 0 14px; }
h1 { font: 600 32px/1.15 var(--display); margin: 0 0 8px; }
h1 span { box-shadow: inset 0 -.28em 0 var(--butter); }
.meta { margin: 0; color: var(--muted); }

nav.toc { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--rule); }
nav.toc .wrap { display: flex; flex-wrap: wrap; gap: 4px 20px; padding-top: 9px; padding-bottom: 9px; }
nav.toc a { color: var(--fg); font-weight: 700; font-size: 14px; text-decoration: none; }
nav.toc a:hover { color: var(--accent); text-decoration: underline; }

section.part { padding: 28px 0 24px; border-bottom: 1px solid var(--rule); scroll-margin-top: 44px; }
h2 { font: 600 25px/1.2 var(--display); margin: 0 0 6px; }
.lead { max-width: 74ch; margin: 0 0 14px; }
.fine { max-width: 74ch; margin: 8px 0 0; color: var(--muted); font-size: 13.5px; }

dl.keys { display: grid; grid-template-columns: fit-content(15em) 1fr; gap: 3px 16px; margin: 0 0 18px; max-width: 820px; font-size: 14.5px; }
dl.keys dt { font-weight: 700; }
dl.keys dd { margin: 0; }

.jump { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0 0 6px; font-size: 14px; }

.ex { padding: 20px 0 6px; border-top: 1px dashed var(--rule); scroll-margin-top: 44px; }
.ex header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.ex h3 { font: 600 20px/1.2 var(--display); margin: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
.chips li { font-size: 12.5px; color: var(--muted); background: var(--chip); border-radius: 999px; padding: 1px 9px; }
.cycle { margin: 6px 0 0; font-size: 14px; }
.cycle span { color: var(--muted); font-size: 12.5px; }

.shots { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 18px 16px; margin-top: 12px; }
figure.shot { margin: 0; max-width: 100%; }
.desk { background: var(--desk); border-radius: 10px; padding: 4px; }
.desk img { display: block; max-width: 100%; height: auto; }
figcaption { width: 0; min-width: 100%; margin-top: 6px; font-size: 13.5px; line-height: 1.4; color: var(--muted); }
figcaption b { color: var(--fg); }

/* live cards: the frame keeps the real window's 440px and scales down to fit */
.live-box { position: relative; overflow: hidden; }
.live-box iframe {
  position: absolute; top: 0; left: 0;
  display: block; border: 0;
  transform-origin: 0 0;
  /* match the card page, or the browser paints an opaque backdrop behind it */
  color-scheme: normal;
}

.note { max-width: 820px; margin: 20px 0 0; padding: 12px 16px; background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; }
.note h3 { font-size: 15px; margin: 0 0 4px; }
.note p { margin: 0; }
.note ul { margin: 0; padding-left: 20px; }
.note li + li { margin-top: 3px; }

.motion-note { display: none; }
@media (prefers-reduced-motion: reduce) { .motion-note { display: block; } }

.mock-label { display: inline-block; margin: 0 0 14px; padding: 6px 12px; font-size: 13.5px; background: var(--chip); border-left: 3px solid var(--accent); border-radius: 4px; }

/* Windows 11 tray menu, drawn to match buildMenu() in main.ts */
figure.tray-fig { width: max-content; }
.desk.tray { position: relative; padding: 18px 16px 58px; overflow: hidden; }
.menus { display: flex; align-items: flex-start; justify-content: flex-end; margin-right: 86px; }
.w11 {
  padding: ${PAD}px 0;
  font: 12px/1 var(--menu);
  color: var(--w11-fg);
  background: var(--w11-bg);
  border: 1px solid var(--w11-line);
  border-radius: 8px;
  box-shadow: var(--w11-shadow);
  white-space: nowrap;
}
.w11.sub { margin-right: -3px; position: relative; z-index: 1; }
.w11 .mi { position: relative; display: flex; align-items: center; height: ${ROW}px; margin: 0 4px; padding: 0 40px 0 34px; border-radius: 4px; }
.w11 .mi.hot { background: var(--w11-hot); }
.w11 .mi.dis { color: var(--w11-dis); }
.w11 .mark { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); }
.w11 .dot { width: 6px; height: 6px; left: 15px; border-radius: 50%; background: currentColor; }
.w11 .chev { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); }
.w11 .sep { height: 1px; margin: ${(SEP - 1) / 2}px 0; background: var(--w11-line); }
.taskbar {
  position: absolute; left: 0; right: 0; bottom: 0; height: 40px;
  display: flex; align-items: center; justify-content: flex-end; gap: 4px; padding: 0 10px;
  background: var(--w11-bar); color: var(--w11-fg);
  font: 11.5px/1.3 var(--menu);
}
.taskbar .ico { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 4px; }
.taskbar .ico.on { background: var(--w11-hot); }
.taskbar .clock { padding: 0 6px 0 8px; text-align: right; }

table.tips { width: 100%; max-width: 900px; border-collapse: collapse; font-size: 14px; }
.tips th, .tips td { padding: 7px 10px 7px 0; text-align: left; vertical-align: top; border-bottom: 1px solid var(--rule); }
.tips th { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.tips td:first-child { white-space: nowrap; padding-right: 18px; }
h3.sub-h { font: 600 19px/1.2 var(--display); margin: 26px 0 8px; }

footer { padding: 18px 0 8px; color: var(--muted); font-size: 13px; }

@media (max-width: 640px) {
  h1 { font-size: 26px; }
  dl.keys { grid-template-columns: 1fr; gap: 0; }
  dl.keys dd { margin-bottom: 6px; }
  figure.tray-fig { width: 100%; }
  .desk.tray { padding: 14px 10px 54px; }
  .menus { flex-direction: column-reverse; align-items: flex-end; margin-right: 0; }
  .w11.sub { margin: 8px 18px 0 0 !important; }
  .tips td:first-child { white-space: normal; }
  .tips code { word-break: break-word; }
}
`;

// Sizes each live frame: it reports the card's height, and scales down on a narrow screen.
const SCRIPT = `
(() => {
  const W = ${VIEW_W};
  const boxes = [...document.querySelectorAll('.live-box')];
  const fit = (box) => {
    const f = box.querySelector('iframe');
    const h = Number(f.getAttribute('height')) || 200;
    const s = Math.min(1, box.clientWidth / W) || 1;
    f.style.transform = s < 1 ? 'scale(' + s + ')' : '';
    box.style.height = Math.ceil(h * s) + 'px';
  };
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.gino !== 'resize' || !(d.h > 0)) return;
    for (const box of boxes) {
      const f = box.querySelector('iframe');
      if (f.contentWindow !== e.source) continue;
      f.setAttribute('height', String(Math.ceil(d.h)));
      fit(box);
    }
  });
  if (window.ResizeObserver) {
    const ro = new ResizeObserver((entries) => entries.forEach((x) => fit(x.target)));
    boxes.forEach((b) => ro.observe(b));
  }
  boxes.forEach(fit);
})();
`;

function report({ probe, timerKinds }: { probe: Probe; timerKinds: Record<string, TimerKind> }) {
  const now = new Date();
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const clock = `15:12<br>${now.toLocaleDateString('en-GB')}`;
  const bySection = (sec: Section) => shots.filter((s) => s.section === sec);

  // Live frames start at the reminder still's height, then follow the card.
  const startHeight = (ex: CardContent) => {
    const s = shots.find((x) => (ex === WELCOME ? x.section === 'first' : x.group === ex));
    return s ? s.h : 200;
  };
  const live = [WELCOME, ...EXERCISES].map((ex) => liveFigure(ex, startHeight(ex))).join('\n');

  const welcome = bySection('first').map(figure).join('\n');

  const exRows = EXERCISES.map((ex) => {
    const slug = slugify(ex.id || ex.name);
    const phases = repPhases(ex);
    const chips = [ex.dose, `${fmtDur(workSeconds(ex))} timer`];
    if (phases.length) chips.push(`guided reps, ${phases.length} parts each`);
    else if (ex.reps) chips.push(`counts ${ex.reps} reps`);
    if (ex.sides) chips.push('both sides');
    if (ex.walk) chips.push('every third reminder');
    const cycle = phases.length
      ? `<p class="cycle">Each rep: ${phases.map((r) => `${esc(r.cue)} <span>${esc(r.seconds)} s</span>`).join(' → ')}</p>`
      : '';
    const figs = shots.filter((s) => s.group === ex).map(figure).join('\n');
    return `<article class="ex" id="ex-${slug}">
  <header><h3>${esc(ex.name)}</h3><ul class="chips">${chips.filter(Boolean).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></header>
  ${cycle}
  <div class="shots">
${figs}
  </div>
</article>`;
  }).join('\n');

  const anyRep = EXERCISES.some((e) => repPhases(e).length);
  const repGuided = Object.values(timerKinds).includes('reps');
  let repNote = '';
  if (repGuided) {
    repNote = `<p class="fine">Stretches with guided reps start with a short <b>Get ready</b>, then the card calls out each part of every rep while Gino does it. Shown here: the lead-in, then each part of rep 2, with Gino at the end of that move. The live cards above show it moving.</p>`;
  } else if (anyRep && !probe.jumpTo) {
    repNote = `<p class="fine">These stretches have rep parts, but this card.js has no <code>jumpTo</code> hook yet, so each shows one timer screen.</p>`;
  }

  const endings = bySection('ending').map(figure).join('\n');

  const normal = trayItems({ paused: false });
  const paused = trayItems({ paused: true, resetOn: true });
  const pauseOpen = trayItems({ paused: false, hot: 'Pause' });
  const remindOpen = trayItems({ paused: false, hot: 'Remind me every' });
  const pauseSub = ['For 30 minutes', 'For 1 hour', 'For 2 hours', 'Until tomorrow'].map((label) => ({ label }));
  const remindSub = INTERVALS.map((m) => ({ label: `${m} minutes`, radio: m === S.intervalMin }));
  const resetNew = HAS_RESET_ITEM ? '' : ' New: being added.';
  const trayFigs = [
    [trayMock(normal, null, clock), 'Normal', `“Reset card position” is greyed out: the card hasn't been dragged.`],
    [trayMock(paused, null, clock), 'Paused', 'Resume replaces Pause. Here the card has been dragged, so Reset card position is on.'],
    [trayMock(pauseOpen, { parent: 'Pause', items: pauseSub }, clock), 'Pause submenu', `Until tomorrow means ${TOMORROW_AT}:00 the next morning.`],
    [trayMock(remindOpen, { parent: 'Remind me every', items: remindSub }, clock), 'Remind me every', `The dot marks the current setting (${S.intervalMin} minutes by default).`],
  ]
    .map(([html, label, note]) => `<figure class="shot tray-fig">${html}<figcaption><b>${esc(label)}</b> · ${esc(note)}</figcaption></figure>`)
    .join('\n');

  const tips = [
    ['Next stretch in 14 min', 'Counting down: minutes of active screen time left, rounded up.'],
    ['Stretch on screen', 'A card is up.'],
    ['Paused until 15:30', `Paused from the menu. “Until tomorrow” shows <i>Paused until tomorrow ${String(TOMORROW_AT).padStart(2, '0')}:00</i>.`],
    [`Holding off: ${CALL_REASON}`, 'A stretch is due, but an app has the microphone open.'],
    ...[...BUSY].map(([reason, states]) => [
      `Holding off: ${reason}`,
      `A stretch is due, but ${esc(BUSY_WHEN[reason] || `Windows reports state ${states.join(' or ')}`)}.`,
    ]),
  ]
    .map(([text, when]) => `<tr><td><code>Gino: ${esc(text)}</code></td><td>${when}</td></tr>`)
    .join('\n');

  const nStretch = bySection('stretch').length;

  const body = `<div class="page">
<header class="top"><div class="wrap">
  <h1><span>Gino: every screen</span></h1>
  <p class="meta">Generated ${esc(date)}, ${esc(time)} · ${shots.length} stills, ${EXERCISES.length + 1} live cards and the tray menu · Regenerate with <code>npm run screens</code></p>
  <p class="meta">Everything here is the real card (<code>src/card.html</code>) with the stretches from <code>src/exercises.ts</code>. The stills are rendered at 2x with Gino's animations paused.</p>
</div></header>

<nav class="toc" aria-label="Sections"><div class="wrap">
  <a href="#live">Live</a>
  <a href="#first-run">First run</a>
  <a href="#stretches">The stretches</a>
  <a href="#endings">Endings</a>
  <a href="#tray">Tray menu</a>
</div></nav>

<main class="wrap">

<section class="part" id="live">
  <h2>Live cards</h2>
  <p class="lead">These run the real card code, with a stand-in for the app around it. On a reminder, Gino shows the move. Press <b>Start</b> for the guided timer, or try How to, Snooze and Skip: when a card closes, it comes back after a moment.</p>
  <div class="shots">
${live}
  </div>
  ${motionNote()}
</section>

<section class="part" id="first-run">
  <h2>First run</h2>
  <p class="lead">Gino says hello once, the first time he starts.</p>
  <dl class="keys">
    <dt>Try one now</dt><dd>closes this card and pops up the first stretch straight away.</dd>
    <dt>Got it</dt><dd>closes it. The first stretch comes after ${S.intervalMin} minutes of screen time.</dd>
  </dl>
  <div class="shots">
${welcome}
  </div>
  <div class="note">
    <h3>Where the card appears</h3>
    <p>It pops up in the bottom-right corner of the main screen. You can drag it anywhere by its body, and it comes back to that spot next time. <b>Reset card position</b> in the tray menu puts it back in the corner.</p>
  </div>
</section>

<section class="part" id="stretches">
  <h2>The stretches</h2>
  <p class="lead">One row per stretch, in the order Gino rotates through them; the walkaround takes every third turn. A stretch pops up after ${S.intervalMin} minutes of active screen time. The count in the corner is how many you've done today.</p>
  <dl class="keys">
    <dt>Start</dt><dd>runs the guided timer, after a short Get ready. The yellow bar along the bottom fills as it goes.</dd>
    <dt>Snooze ${S.snoozeMin} min</dt><dd>hides the card and asks again in ${S.snoozeMin} minutes.</dd>
    <dt>Skip</dt><dd>no stretch this time. The next one comes after a full ${S.intervalMin} minutes.</dd>
    <dt>How to</dt><dd>opens the steps. While they're open, the card won't snooze itself.</dd>
    <dt>Done</dt><dd>on the timer: finish now. It counts.</dd>
    <dt>Stop</dt><dd>on the timer: stop without counting it.</dd>
  </dl>
  <p class="jump">${EXERCISES.map((e) => `<a href="#ex-${slugify(e.id || e.name)}">${esc(e.name)}</a>`).join('')}</p>
  ${repNote}
${exRows}
</section>

<section class="part" id="endings">
  <h2>Endings</h2>
  <p class="lead">What the card says after each choice. Each one closes by itself after about two seconds.</p>
  <div class="shots">
${endings}
  </div>
  <div class="note">
    <h3>Endings with no screen</h3>
    <ul>
      <li><b>Ignored card:</b> if nobody touches it, it snoozes itself after ${S.autoSnoozeMin} minutes and slides away without a message.</li>
      <li><b>Walked away:</b> ${S.idleResetMin} minutes without the keyboard or mouse while a card is up puts it away and starts the ${S.intervalMin}-minute count over.</li>
      <li><b>Screen locked</b> (or the PC goes to sleep): the card is put away and the count starts over.</li>
    </ul>
  </div>
</section>

<section class="part" id="tray">
  <h2>Tray menu</h2>
  <p class="mock-label">Drawn in HTML to match <code>buildMenu()</code> in main.ts. Not a screenshot: Windows draws the real menu, in its own light or dark style.</p>
  <p class="lead">Click or right-click Gino's icon by the clock. Windows 11 may hide new tray icons under the <b>^</b> arrow.</p>
  <div class="shots">
${trayFigs}
  </div>
  <dl class="keys" style="margin-top:20px">
    <dt>First two lines</dt><dd>greyed out, for reading only: the status, and today's count (“No stretches yet today” before the first).</dd>
    <dt>Stretch now</dt><dd>shows the next stretch right away. Greyed out while a card is up.</dd>
    <dt>Pause</dt><dd>for 30 minutes, 1 hour, 2 hours, or until tomorrow morning. The menu then shows <b>Resume</b> instead.</dd>
    <dt>Remind me every</dt><dd>minutes of active screen time between stretches.</dd>
    <dt>Hold off during calls and full-screen apps</dt><dd>a due stretch waits while an app has the microphone open, or during full-screen apps and presentations. Checked again once a minute.</dd>
    <dt>Start with Windows</dt><dd>starts Gino when you sign in.</dd>
    <dt>Reset card position</dt><dd>puts the card back in the bottom-right corner. Greyed out until you've dragged the card somewhere.${resetNew}</dd>
    <dt>Quit Gino</dt><dd>closes him until you start him again.</dd>
  </dl>

  <h3 class="sub-h">Tray tooltip</h3>
  <p class="lead">Hovering the icon shows “Gino: ” and the status line, which is also the first line of the menu.</p>
  <table class="tips">
    <thead><tr><th>Tooltip</th><th>When</th></tr></thead>
    <tbody>
${tips}
    </tbody>
  </table>
  <p class="fine">Checked in this order: paused, card on screen, holding off, countdown. Times follow your clock's format. With <code>npm run fast</code> it says sec instead of min. Source: <code>statusLine()</code> and <code>BUSY_STATES</code> in main.ts.</p>
</section>

</main>
<footer><div class="wrap">${nStretch} stretch stills, ${bySection('ending').length} endings, 1 welcome. Every card sits on a stand-in desktop so its shadow and see-through corners show.</div></footer>
</div>
<script>${SCRIPT}</script>
`;

  // Published: a fragment, wrapped in a page at publish time. Fonts from Google Fonts.
  const fragment = `<title>${TITLE}</title>
<link rel="stylesheet" href="${esc(GOOGLE_FONTS)}">
<style>${CSS}</style>
${body}`;

  // Local: a full page, with the fonts the app itself bundles (works offline).
  const localFonts = [
    '../node_modules/@fontsource-variable/shantell-sans/wght.css',
    '../node_modules/@fontsource/atkinson-hyperlegible/400.css',
    '../node_modules/@fontsource/atkinson-hyperlegible/700.css',
  ]
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join('\n');
  const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
${localFonts}
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
  return { fragment, full };
}

app.on('window-all-closed', () => {}); // quit when the report is written, not before
app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((e: unknown) => {
    console.error(`\nScreens failed: ${e instanceof Error && e.stack ? e.stack : e}`);
    app.exit(1);
  });
