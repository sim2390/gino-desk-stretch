// The pop-up card. Driven by the Rust side through window.ginoApi (bridge.ts).
// Bundled with gino.ts into build/card.js, the one script src/card.html loads.
import './bridge'; // first: it sets window.ginoApi, which is read below
import { demo, setMove, svg, type PlateMove } from './gino';
import type { ActionReply, CardAction, CardContent, GinoApi, Move, PoseName, RepPhase, ShowPayload } from './types';

type CardState = 'welcome' | 'prompt' | 'active' | 'done' | 'snoozed' | 'skipped';

// A step of the timer, as buildPlan() lists it: how long it lasts, which rep and
// phase it is, and the move it asks for ('hold' keeps the move before it).
type StepDraft = { seconds: number; rep: number; phase: number; rawMove?: Move | 'ready' | null } & (
  | { kind: 'lead'; cue: string; sub: string }
  | { kind: 'rep'; cue: string; hint: string }
  | { kind: 'side'; side: 1 | 2 }
  | { kind: 'hold' }
);

// ...with its timing worked out: when it starts and ends, and the move Gino is
// in (since moveStart, taking moveSeconds; prevMove is the one before it).
type Step = StepDraft & {
  start: number;
  end: number;
  move: PlateMove | null;
  moveStart: number;
  moveSeconds: number;
  prevMove: PlateMove | null;
};

interface Plan {
  steps: Step[];
  total: number;
  lead: number;
  reps: number;
}

/** Where jumpTo() landed. */
interface JumpedTo {
  rep: number;
  phase: number;
  kind: Step['kind'];
  cue: string | null;
  move: PlateMove | null;
}

/** Hooks for dev/preview.html and dev/screens. Not used by the app. */
export interface CardHooks {
  show(p: ShowPayload): void;
  start(): void;
  finish(): Promise<void>;
  snooze(auto?: boolean): void;
  skip(kind: 'skip' | 'stop'): void;
  toggleHowTo(): void;
  setElapsed(sec: number): void;
  jumpTo(rep: number, phase?: number): JumpedTo;
}

declare global {
  interface Window {
    __card?: CardHooks;
  }
}

const api: GinoApi | undefined = window.ginoApi;
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`card.html has no #${id}`);
  return el;
};
const card = $('card');
const plate = $('plate');
const big = $('big');

const LEAD = 3; // seconds of "Get ready" before the timer, unless the exercise sets `lead`
const READY_MOVE = 0.6; // seconds for Gino to settle into his start pose
const TICK = 100;

// Set by show(). Nothing else runs before the first card, so they're never read unset.
let payload!: ShowPayload;
let ex!: CardContent;
// Timer ids come from window.setTimeout and friends: they're numbers in the page,
// and the bare names type as Node's timers here (tsconfig loads the Node types).
let timerId = 0;
let autoSnoozeId = 0;
let closeId = 0;
let closing = false;
let t0 = 0;
let plan: Plan | null = null; // the running timer, from buildPlan()
let stepIdx = -1; // which step is on screen
let seeking = false; // the timer jumped, so Gino lands mid-move instead of easing in
let stopDemo: () => void = () => {};
let startedAt = 0; // when Start was pressed: Done sits in the same spot, so a double-click can't count it
let finishing = false;
let shown = 0; // counts show() calls, so a late 'done' reply can't touch a newer card

const fmt = (sec: number) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const countLabel = (n: number) => (n === 0 ? 'First one today' : `${n} today`);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const repPhases = (e: CardContent): RepPhase[] =>
  Array.isArray(e.rep) ? e.rep.filter((p) => p && Number(p.seconds) > 0) : [];

function setPose(pose: PoseName) {
  delete plate.dataset.move;
  plate.innerHTML = svg(pose);
}

function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

function setState(state: CardState) {
  card.dataset.state = state;
  const prompt = state === 'prompt' || state === 'welcome';
  $('info').hidden = !prompt;
  $('timer').hidden = state !== 'active';
  $('actPrompt').hidden = !prompt;
  $('actActive').hidden = state !== 'active';
  $('note').hidden = !['done', 'snoozed', 'skipped'].includes(state);
}

// Tell the app how tall the window needs to be (card + shadow room), once per change: each
// call moves the window.
let sentHeight = 0;
function fit() {
  requestAnimationFrame(() => {
    const height = card.offsetHeight + 36;
    if (!api || height === sentHeight) return;
    sentHeight = height;
    api.resize(height);
  });
}

// The card can also change height after fit() measured it, for example when the web fonts
// arrive after the first show; measure again whenever it does, so it's never cut off.
if (api) new ResizeObserver(() => fit()).observe(card);

function clearTimers() {
  window.clearInterval(timerId);
  window.clearTimeout(autoSnoozeId);
  window.clearTimeout(closeId);
  stopDemo();
}

function setActions(buttons: [act: CardAction, label: string, cls: 'primary' | 'secondary' | 'quiet'][]) {
  $('actPrompt').replaceChildren(
    ...buttons.map(([act, label, cls]) => {
      const b = document.createElement('button');
      b.dataset.act = act;
      b.className = cls;
      b.textContent = label;
      return b;
    })
  );
}

function show(p: ShowPayload) {
  clearTimers();
  closing = false;
  finishing = false;
  shown += 1;
  payload = p;
  ex = p.exercise;
  plan = null;
  const welcome = p.mode === 'welcome';

  $('title').textContent = ex.name;
  $('count').textContent = welcome ? '' : countLabel(p.todayCount);
  $('text').textContent = ex.text;
  $('dose').textContent = ex.dose || '';
  const steps = ex.howTo || [];
  $('howto').replaceChildren(
    ...steps.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    })
  );
  $('howto').hidden = true;
  $('howtoBtn').hidden = steps.length === 0;
  $('howtoBtn').setAttribute('aria-expanded', 'false');
  const doseRow = $('dose').parentElement;
  if (doseRow) doseRow.hidden = !ex.dose && steps.length === 0;

  setActions(
    welcome
      ? [
          ['trynow', 'Try one now', 'primary'],
          ['dismiss', 'Got it', 'secondary'],
        ]
      : [
          ['start', 'Start', 'primary'],
          ['snooze', `Snooze ${p.snoozeMin} min`, 'secondary'],
          ['skip', 'Skip', 'quiet'],
        ]
  );

  plate.classList.remove('mirror');
  setPose(ex.pose);
  setState(welcome ? 'welcome' : 'prompt');
  $('bar').style.width = '0';

  card.classList.remove('out', 'in', 'idle');
  void card.offsetWidth; // restart the entrance animation
  card.classList.add('in');
  // The app puts the window back to its default height as it shows a card, so send this
  // card's height even if the page asked for the same one before the show.
  sentHeight = 0;
  fit();

  // Show how it's done: Gino loops one rep at the timer's rhythm until Start.
  stopDemo = demo(plate, repPhases(ex), { delay: 650 });

  if (!welcome && p.autoSnoozeMin) {
    autoSnoozeId = window.setTimeout(() => snooze(true), p.autoSnoozeMin * 60 * 1000);
  }
}

// The timer as a list of steps: "Get ready", then every phase of every rep,
// or the two sides, or one plain hold. Each step knows when it starts and
// which move Gino should be in ('hold' keeps the move before it).
function buildPlan(e: CardContent): Plan {
  const phases = repPhases(e);
  const drafts: StepDraft[] = [];
  const lead = Math.max(0, Number(e.lead ?? (e.walk ? 0 : LEAD)) || 0);
  if (lead > 0) {
    drafts.push({ kind: 'lead', cue: 'Get ready', sub: e.ready || e.dose || '', seconds: lead, rep: 0, phase: 0, rawMove: phases.length ? 'ready' : null });
  }
  if (phases.length) {
    const reps = Math.max(1, Math.round(e.reps || 1));
    for (let r = 1; r <= reps; r++) {
      phases.forEach((p, i) => {
        drafts.push({ kind: 'rep', cue: p.cue || '', hint: p.hint || '', seconds: Number(p.seconds), rep: r, phase: i, rawMove: p.move || 'hold' });
      });
    }
  } else if (e.sides) {
    const half = Math.max(5, e.seconds || 40) / 2;
    drafts.push({ kind: 'side', side: 1, seconds: half, rep: 1, phase: 0 });
    drafts.push({ kind: 'side', side: 2, seconds: half, rep: 2, phase: 0 });
  } else {
    drafts.push({ kind: 'hold', seconds: Math.max(5, e.seconds || 30), rep: 1, phase: 0 });
  }

  const steps: Step[] = [];
  let at = 0;
  let cur: { move: PlateMove | null; start: number; seconds: number; prev: PlateMove | null } = { move: null, start: 0, seconds: 0, prev: null };
  for (const s of drafts) {
    const start = at;
    at = start + s.seconds;
    if (s.rawMove && s.rawMove !== 'hold' && s.rawMove !== cur.move) {
      const seconds = s.rawMove === 'ready' ? Math.min(READY_MOVE, s.seconds) : s.seconds;
      cur = { move: s.rawMove, start, seconds, prev: cur.move };
    }
    steps.push({ ...s, start, end: at, move: cur.move, moveStart: cur.start, moveSeconds: cur.seconds, prevMove: cur.prev });
  }
  return { steps, total: at, lead, reps: phases.length ? Math.max(1, Math.round(e.reps || 1)) : e.reps || 0 };
}

function start() {
  clearTimers();
  plan = buildPlan(ex);
  t0 = performance.now();
  startedAt = t0;
  delete plate.dataset.move; // start from rest, whatever the demo was showing
  stepIdx = -1;
  seeking = false;
  setState('active');
  updateTimer();
  timerId = window.setInterval(updateTimer, TICK);
  fit();
  if (api) api.action('start', { id: ex.id });
}

// The big line: a cue ("Hold"), or the time left for a plain hold.
// A new cue slides in, unless the timer jumped there.
function setBig(text: string, clock: boolean, animate = false) {
  if (big.textContent === text && big.classList.contains('clock') === clock) return;
  big.textContent = text;
  big.classList.toggle('clock', clock);
  big.classList.remove('fresh');
  big.style.fontSize = '';
  if (clock) return;
  // a long cue shrinks to stay on one line
  for (let size = 28; big.scrollWidth > big.clientWidth && size >= 18; size -= 2) {
    big.style.fontSize = `${size}px`;
  }
  if (animate) {
    void big.offsetWidth;
    big.classList.add('fresh');
  }
}

function subFor(s: Step, elapsed: number, reps: number) {
  switch (s.kind) {
    case 'lead':
      return s.sub;
    case 'rep':
      return `Rep ${s.rep} of ${reps}${s.hint ? ` · ${s.hint}` : ''}`;
    case 'side':
      return s.side === 1 ? 'First side' : 'Other side';
    default:
      if (reps) {
        // reps without phases: split the time evenly
        const rep = Math.floor((elapsed - s.start) / (s.seconds / reps)) + 1;
        return `Rep ${Math.min(reps, rep)} of ${reps}`;
      }
      return ex.walk ? 'Off you go' : '';
  }
}

function enterStep(s: Step, i: number, elapsed: number) {
  stepIdx = i;
  const phased = s.kind === 'lead' || s.kind === 'rep';
  if (phased) setBig(s.cue, false, !seeking);
  $('dial').classList.toggle('off', !phased);
  if (ex.sides) plate.classList.toggle('mirror', s.kind === 'side' && s.side === 2);
  if (s.move && (seeking || plate.dataset.move !== s.move)) {
    setMove(plate, s.move, {
      seconds: s.moveSeconds,
      into: elapsed - s.moveStart,
      from: seeking ? s.prevMove : null,
    });
  }
}

function updateTimer() {
  if (!plan) return; // only runs while the timer does
  const steps = plan.steps;
  const elapsed = Math.max(0, (performance.now() - t0) / 1000);
  let i = steps.findIndex((s) => elapsed < s.end);
  if (i < 0) i = steps.length - 1;
  const s = steps[i];
  const jumped = seeking;
  if (i !== stepIdx || jumped) enterStep(s, i, elapsed);
  seeking = false;

  if (s.kind === 'lead' || s.kind === 'rep') {
    const left = Math.max(0, s.end - elapsed);
    const fill = $('dialFill');
    setText($('dialNum'), String(Math.max(1, Math.ceil(left - 0.05))));
    fill.style.transition = jumped ? 'none' : '';
    fill.style.strokeDashoffset = String(Math.round(100 - 100 * clamp01(left / s.seconds)));
  } else {
    setBig(fmt(plan.total - elapsed), true);
  }
  setText($('sub'), subFor(s, elapsed, plan.reps));
  // the butter bar shows the stretch itself, not the lead-in
  const work = plan.total - plan.lead;
  $('bar').style.width = `${clamp01((elapsed - plan.lead) / work) * 100}%`;

  if (elapsed >= plan.total) finish();
}

// Move the running timer to `sec` seconds in.
function seek(sec: number) {
  if (!plan || card.dataset.state !== 'active') start();
  t0 = performance.now() - Math.max(0, sec) * 1000;
  seeking = true;
  updateTimer();
}

async function finish() {
  if (finishing) return; // the timer running out and a Done click can both get here
  finishing = true;
  const card0 = shown;
  clearTimers();
  let res: ActionReply = {};
  try {
    res = (api && (await api.action('done', { id: ex.id }))) || {};
  } catch {
    res = {};
  }
  if (card0 !== shown) return; // a new card came up while we waited
  const n = typeof res.todayCount === 'number' ? res.todayCount : payload.todayCount + 1;
  $('title').textContent = 'Nice.';
  $('count').textContent = '';
  $('note').textContent = n === 1 ? 'That was your first one today.' : `That's ${n} today.`;
  plate.classList.remove('mirror');
  setPose('celebrate');
  setState('done');
  fit();
  closeId = window.setTimeout(close, 2400);
}

function snooze(auto?: boolean) {
  clearTimers();
  if (api) api.action('snooze', { auto: !!auto });
  if (auto) return close();
  $('note').textContent = `Snoozed. See you in ${payload.snoozeMin} minutes.`;
  setPose('wave');
  setState('snoozed');
  fit();
  closeId = window.setTimeout(close, 1800);
}

function skip(kind: 'skip' | 'stop') {
  clearTimers();
  if (api) api.action(kind, { id: ex.id });
  const word = kind === 'stop' ? 'Stopped' : 'Skipped';
  $('note').textContent = `${word}. Next one in ${payload.intervalMin} minutes.`;
  plate.classList.remove('mirror');
  setPose('idle');
  setState('skipped');
  fit();
  closeId = window.setTimeout(close, 1800);
}

function toggleHowTo() {
  window.clearTimeout(autoSnoozeId); // you're reading it, so don't auto-snooze
  const list = $('howto');
  list.hidden = !list.hidden;
  $('howtoBtn').setAttribute('aria-expanded', String(!list.hidden));
  fit();
}

function close() {
  if (closing) return;
  closing = true;
  clearTimers();
  card.classList.remove('in');
  card.classList.add('out');
  window.setTimeout(() => {
    if (api) api.closed();
  }, 210);
}

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest<HTMLElement>('button[data-act]') : null;
  if (!b || closing) return;
  switch (b.dataset.act) {
    case 'start': return start();
    case 'done':
      if (performance.now() - startedAt < 600) return; // the second click of a double-click on Start
      return finish();
    case 'stop': return skip('stop');
    case 'skip': return skip('skip');
    case 'snooze': return snooze(false);
    case 'howto': return toggleHowTo();
    case 'trynow':
      if (api) api.action('trynow');
      return close();
    case 'dismiss':
      if (api) api.action('dismiss');
      return close();
  }
});

if (api) api.onShow(show);

// Hooks for dev/preview.html and dev/screens. Not used by the app.
window.__card = {
  show,
  start,
  finish,
  snooze,
  skip,
  toggleHowTo,
  // put the running timer `sec` seconds in (starts it if needed)
  setElapsed(sec) {
    seek(sec);
  },
  // Put the running timer in the middle of phase `phase` (0-based, into ex.rep)
  // of rep `rep` (1-based); jumpTo(0) is the middle of "Get ready". Without
  // phases, rep 1 is the hold (for sides: 1 and 2 are the two sides).
  // Starts the timer if needed. Returns where it landed.
  jumpTo(rep, phase = 0) {
    if (!plan || card.dataset.state !== 'active') start();
    const p = plan!; // start() just made it
    const steps = p.steps;
    const main = steps.filter((s) => s.kind !== 'lead');
    let s: Step | undefined;
    if (!rep) {
      s = steps.find((x) => x.kind === 'lead');
    } else if (main[0].kind === 'rep') {
      const r = Math.min(Math.max(1, rep), p.reps);
      const n = main.filter((x) => x.rep === r);
      s = n[Math.min(Math.max(0, phase), n.length - 1)];
    } else {
      s = main[Math.min(Math.max(1, rep), main.length) - 1];
    }
    seek(s ? s.start + s.seconds / 2 : 0);
    const at = steps[stepIdx];
    return { rep: at.rep, phase: at.phase, kind: at.kind, cue: ('cue' in at && at.cue) || big.textContent, move: at.move || null };
  },
};
