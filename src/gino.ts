/*
 * Gino the Gnocchi: an original mascot drawn as SVG.
 * svg(pose) returns an SVG string. Animations live in card.css and
 * key off the class names used here (.figure, .torso, .arms, .arm-l, .arm-r,
 * .leg-l, .leg-r, .body, .shell, .upper, .eyes, .eye, .chin, .prop, .arrow,
 * .roll, .spark).
 *
 * The rep poses (chinTuck, thoracic, shoulderRoll) move in time with the timer.
 * setMove(el, move) puts data-move on the element that holds the SVG and
 * card.css draws each move; demo(el, phases) loops one rep before Start.
 * A pose with `bend` can bend his body: the top of him moves by the bend
 * (transform in --bend-t) and the outline follows (path in --bent).
 *
 * An ES module: card.ts imports it, and build/gino.js puts it on the dev pages
 * as the global Gino (see scripts/build.mjs).
 */
import type { Move, PoseName, RepPhase } from './types';

const C = {
  ink: '#2E3327',
  body: '#F4D27A',
  ridge: '#D7A43C',
  leaf: '#7FA06F',
  vein: '#4F6E46',
  shoe: '#6E8F62',
  chairBack: '#DDE5D7',
  chairSeat: '#C9D4C2',
  sage: '#4F6E46',
  butter: '#E9B84A',
  water: '#CFE3EE',
};

/** A point on the 120 × 140 grid. */
type Point = [x: number, y: number];
/** An arm: its path, and where the hand goes. */
type ArmSpec = [d: string, hand: Point];
type HandShape = 'flat';
/** Where the shoe goes, and its tilt in degrees. */
type Shoe = [x: number, y: number, angle: number];
type LegSpec = [cls: string, d: string, shoe: Shoe];
type LegKind = 'stand' | 'walk';
type FaceKind = 'smile' | 'happy' | 'up' | 'look' | 'tuck';

/**
 * How a pose bends his body (see bendPoint): above y `from` the top of him moves
 * fully, rotating `rot` degrees about cx,cy and then shifting dx,dy; below y `to`
 * he stays put. `arms`: the arms bend with him.
 */
interface Bend {
  dx?: number;
  dy?: number;
  rot?: number;
  cx: number;
  cy: number;
  from: number;
  to: number;
  arms?: boolean;
}

interface Pose {
  arms: { l: ArmSpec; r: ArmSpec };
  legs: LegKind;
  face: FaceKind;
  /** Shifts the face sideways for the three-quarter view. */
  faceShift?: number;
  /** Static torso rotation, in degrees. */
  tilt?: number;
  /** true, or 'side' for a side-on chair. */
  chair?: true | 'side';
  props?: () => string;
  /** The arm drawn in front of the body. */
  armFront?: 'l' | 'r';
  handShape?: { l?: HandShape; r?: HandShape };
  bend?: Bend;
  cup?: boolean;
}

/**
 * What setMove puts on the plate: any Move but 'hold' (which keeps the move before
 * it, so it never reaches the plate), or the card's own 'ready', which eases him
 * back to rest during "Get ready". card.css has no rule for 'ready', so it is his
 * resting pose, and the arrows dim as for any move.
 */
export type PlateMove = Exclude<Move, 'hold'> | 'ready';

const r1 = (n: number) => Math.round(n * 10) / 10;
const rad = (d: number) => (d * Math.PI) / 180;
const stroke = (w: number, color = C.ink) =>
  `fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

function head(x: number, y: number, tx: number, ty: number, size = 5, color = C.ink) {
  // arrowhead at (x, y) pointing along unit vector (tx, ty)
  const rot = (vx: number, vy: number, deg: number): Point => {
    const c = Math.cos(rad(deg));
    const s = Math.sin(rad(deg));
    return [vx * c - vy * s, vx * s + vy * c];
  };
  const [ax, ay] = rot(-tx, -ty, 30);
  const [bx, by] = rot(-tx, -ty, -30);
  return `<path d="M${r1(x + ax * size)} ${r1(y + ay * size)} L${r1(x)} ${r1(y)} L${r1(x + bx * size)} ${r1(y + by * size)}" ${stroke(2.4, color)}/>`;
}

function lineArrow(x0: number, y0: number, x1: number, y1: number, color = C.sage, cls = '') {
  const len = Math.hypot(x1 - x0, y1 - y0);
  return `<g class="prop arrow ${cls}"><path d="M${x0} ${y0} L${x1} ${y1}" ${stroke(2.4, color)}/>${head(x1, y1, (x1 - x0) / len, (y1 - y0) / len, 5, color)}</g>`;
}

function arcArrow(cx: number, cy: number, r: number, a0: number, a1: number, color = C.sage, cls = '') {
  const p = (a: number): Point => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  const dir = a1 > a0 ? 1 : -1;
  const tx = -Math.sin(rad(a1)) * dir;
  const ty = Math.cos(rad(a1)) * dir;
  return `<g class="prop arrow ${cls}"><path d="M${r1(x0)} ${r1(y0)} A${r} ${r} 0 ${large} ${sweep} ${r1(x1)} ${r1(y1)}" ${stroke(2.2, color)}/>${head(x1, y1, tx, ty, 4.5, color)}</g>`;
}

function spark(x: number, y: number, s = 5) {
  return `<path class="spark" d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z" fill="${C.butter}" stroke="${C.ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
}

function arm(cls: string, d: string, hand: Point, handShape?: HandShape) {
  const handSvg =
    handShape === 'flat'
      ? `<ellipse cx="${hand[0]}" cy="${hand[1]}" rx="7.5" ry="3.4" fill="${C.ink}" transform="rotate(-8 ${hand[0]} ${hand[1]})"/>`
      : `<circle cx="${hand[0]}" cy="${hand[1]}" r="4.2" fill="${C.ink}"/>`;
  return `<g class="${cls} mv"><path d="${d}" ${stroke(5)}/>${handSvg}</g>`;
}

function leg(cls: string, d: string, shoe: Shoe) {
  const [x, y, angle] = shoe;
  return `<g class="${cls}"><path d="${d}" ${stroke(5)}/><ellipse cx="${x}" cy="${y}" rx="8.5" ry="4.6" fill="${C.shoe}" stroke="${C.ink}" stroke-width="2" transform="rotate(${angle || 0} ${x} ${y})"/></g>`;
}

// Faces. dx shifts features sideways for the three-quarter view.
function face(kind: FaceKind, dx = 0) {
  const eyeL = 50 + dx;
  const eyeR = 70 + dx;
  const brows = `<path d="M${eyeL - 5} 47 Q${eyeL} 44.4 ${eyeL + 5} 47 M${eyeR - 5} 47 Q${eyeR} 44.4 ${eyeR + 5} 47" ${stroke(2.2)}/>`;
  const eye = (x: number, y: number) =>
    `<g class="eye"><ellipse cx="${x}" cy="${y}" rx="3.6" ry="4.8" fill="${C.ink}"/><circle cx="${x + 1.2}" cy="${y - 1.8}" r="1.2" fill="#fff"/></g>`;
  const smile = `<path d="M${52 + dx} 66 Q${60 + dx} 73 ${68 + dx} 66" ${stroke(2.6)}/>`;

  switch (kind) {
    case 'happy':
      return `${brows}<g class="eyes"><path d="M${eyeL - 4} 57 Q${eyeL} 51.5 ${eyeL + 4} 57 M${eyeR - 4} 57 Q${eyeR} 51.5 ${eyeR + 4} 57" ${stroke(2.6)}/></g><path d="M${51 + dx} 64.5 Q${60 + dx} 76 ${69 + dx} 64.5 Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
    case 'up':
      return `${brows}<g class="eyes">${eye(eyeL, 54)}${eye(eyeR, 54)}</g><ellipse cx="${60 + dx}" cy="68" rx="3.4" ry="4.2" fill="${C.ink}"/>`;
    case 'look':
      return `${brows}<g class="eyes">${eye(eyeL + 2.5, 57)}${eye(eyeR + 2.5, 57)}</g><path d="M${55 + dx} 67 Q${60 + dx} 70 ${65 + dx} 67" ${stroke(2.4)}/>`;
    case 'tuck':
      return `${brows}<g class="eyes">${eye(eyeL, 56)}${eye(eyeR, 56)}</g>${smile}<path class="chin mv" d="M${61 + dx} 77 Q${66 + dx} 80.5 ${71 + dx} 77" ${stroke(2)}/>`;
    default:
      return `${brows}<g class="eyes">${eye(eyeL, 56)}${eye(eyeR, 56)}</g>${smile}`;
  }
}

// The body outline: a rounded rect (x 28-92, y 24-96, corners 25) drawn as
// cubic curves, with extra points down the sides so it can bend smoothly.
const K = 13.8; // 25 * 0.552: handle length for a quarter circle
const SHELL: Point[] = [
  [53, 24],
  [57.7, 24], [62.3, 24], [67, 24],
  [67 + K, 24], [92, 49 - K], [92, 49],
  [92, 52.7], [92, 56.3], [92, 60],
  [92, 63.7], [92, 67.3], [92, 71],
  [92, 71 + K], [67 + K, 96], [67, 96],
  [62.3, 96], [57.7, 96], [53, 96],
  [53 - K, 96], [28, 71 + K], [28, 71],
  [28, 67.3], [28, 63.7], [28, 60],
  [28, 56.3], [28, 52.7], [28, 49],
  [28, 49 - K], [53 - K, 24], [53, 24],
];

function shellPath(pts: Point[]) {
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i += 3) {
    d += ` C${pts.slice(i, i + 3).map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' ')}`;
  }
  return `${d} Z`;
}

// Bend a point: above y `from` it moves fully (rotate `rot` degrees about
// cx,cy, then shift dx,dy), below y `to` it stays put, smooth in between.
function bendPoint([x, y]: Point, b: Bend): Point {
  const t = Math.min(1, Math.max(0, (b.to - y) / (b.to - b.from)));
  const w = t * t * (3 - 2 * t);
  const a = rad((b.rot || 0) * w);
  const px = x - b.cx;
  const py = y - b.cy;
  return [
    b.cx + px * Math.cos(a) - py * Math.sin(a) + (b.dx || 0) * w,
    b.cy + px * Math.sin(a) + py * Math.cos(a) + (b.dy || 0) * w,
  ];
}

function body(faceSvg: string) {
  // A plump pillow with fork ridges top and bottom, and a sage leaf garnish.
  // .upper (top ridges, face, leaf) moves when a pose bends; .lower stays.
  return `<g class="body mv">
    <path class="shell mv" d="${shellPath(SHELL)}" fill="${C.body}" stroke="${C.ink}" stroke-width="2.6" stroke-linejoin="round"/>
    <g class="lower">
      <path d="M36 81 Q60 86 84 81 M38 87 Q60 92 82 87 M43 92.5 Q60 96 77 92.5" ${stroke(2.4, C.ridge)}/>
      <circle cx="85" cy="68" r="1.2" fill="#fff" opacity=".75"/><circle cx="40" cy="74" r=".8" fill="#fff" opacity=".75"/>
    </g>
    <g class="upper bend mv">
      <path d="M41 31 Q60 27 79 31 M37 37 Q60 32.5 83 37" ${stroke(2.4, C.ridge)}/>
      <circle cx="35" cy="60" r="1.1" fill="#fff" opacity=".75"/><circle cx="83" cy="48" r=".9" fill="#fff" opacity=".75"/>
      <g class="leaf" transform="translate(68 25) rotate(14)">
        <path d="M0 0 C-3.5 -9 2.5 -17.5 13 -19.5 C13.5 -10 8.5 -2.5 0 0 Z" fill="${C.leaf}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M1.5 -2 Q5.5 -9.5 10.5 -15.5" ${stroke(1.4, C.vein)}/>
      </g>
      ${faceSvg}
    </g>
  </g>`;
}

// Shoulder rolls: a circling arrow by each shoulder, and a butter dot that
// travels round it in time with the rep (keyframes in card.css). The right
// one is the left one mirrored.
function rollers() {
  const one =
    arcArrow(18, 50, 9, 50, 320, C.sage, 'roll-arrow') +
    `<g class="roll" style="transform-origin: 18px 50px"><circle cx="18" cy="59" r="3" fill="${C.butter}" stroke="${C.ink}" stroke-width="1.5"/></g>`;
  return `<g class="rollers">${one}<g transform="matrix(-1 0 0 1 120 0)">${one}</g></g>`;
}

const LEGS: Record<LegKind, LegSpec[]> = {
  stand: [
    ['leg-l', 'M51 90 L49 121', [45, 124, -4]],
    ['leg-r', 'M69 90 L71 121', [75, 124, 4]],
  ],
  walk: [
    ['leg-l', 'M53 90 L42 119', [38, 122, -10]],
    ['leg-r', 'M67 90 L80 119', [84, 122, 10]],
  ],
};

const ARMS: Record<'down' | 'lap', Pose['arms']> = {
  down: {
    l: ['M31.5 64 Q22 76 25 88', [25, 89]],
    r: ['M88.5 64 Q98 76 95 88', [95, 89]],
  },
  lap: {
    l: ['M31.5 64 Q24 78 33 88', [34, 89]],
    r: ['M88.5 64 Q96 78 87 88', [86, 89]],
  },
};

// Each pose: arms, legs, face, faceShift, tilt (static torso rotation),
// chair (true, or 'side' for a side-on chair), props, armFront, bend.
// One entry per PoseName, in the order the pose sheet shows them.
const POSES: Record<PoseName, Pose> = {
  idle: { arms: ARMS.down, legs: 'stand', face: 'smile' },
  wave: {
    arms: { l: ARMS.down.l, r: ['M88.5 62 Q104 52 104 32', [104, 30]] },
    legs: 'stand',
    face: 'smile',
  },
  // Three-quarter view, facing right. Moves: in (head glides straight back), out.
  chinTuck: {
    arms: ARMS.down,
    legs: 'stand',
    face: 'tuck',
    faceShift: 8,
    bend: { dx: -7, cx: 60, cy: 60, from: 60, to: 92 },
    props: () => lineArrow(114, 57, 101, 57, C.sage, 'mv'),
  },
  neckSide: {
    arms: { l: ['M31.5 62 C17 34 38 9 72 19', [74, 20]], r: ARMS.down.r },
    legs: 'stand',
    face: 'smile',
    tilt: -14,
  },
  // Three-quarter view on a side-on chair whose back meets his mid-back.
  // Moves: arch (upper body arches back over the backrest), up.
  thoracic: {
    arms: {
      l: ['M31.5 64 L15 45 L30 30', [30, 30]],
      r: ['M88.5 64 L105 45 L90 30', [90, 30]],
    },
    legs: 'stand',
    face: 'up',
    faceShift: 6,
    chair: 'side',
    bend: { rot: -17, cx: 29, cy: 64, from: 54, to: 88, arms: true },
  },
  // Front view. Moves: up (shrug), back (squeeze), down.
  shoulderRoll: {
    arms: ARMS.down,
    legs: 'stand',
    face: 'smile',
    props: rollers,
  },
  eyes: {
    arms: { l: ARMS.down.l, r: ['M88.5 64 L101 52 L81 45', [76, 44.5]] },
    armFront: 'r',
    handShape: { r: 'flat' },
    legs: 'stand',
    face: 'look',
    props: () =>
      `<g class="prop"><path d="M95 55 L111 51" ${stroke(2, C.sage)} stroke-dasharray="2 4"/><circle cx="114.5" cy="50" r="3" fill="${C.leaf}" stroke="${C.ink}" stroke-width="1.4"/></g>`,
  },
  walk: {
    arms: {
      l: ['M31.5 64 Q22 72 27 84', [28, 85]],
      r: ['M88.5 64 Q100 70 103 80', [103, 81]],
    },
    legs: 'walk',
    face: 'smile',
    props: () =>
      `<g class="prop"><path d="M8 58 L19 58 M4 68 L17 68 M8 78 L19 78" ${stroke(2.4, C.chairSeat)}/></g>`,
    cup: true,
  },
  sitTall: {
    arms: ARMS.lap,
    legs: 'stand',
    face: 'smile',
    chair: true,
    props: () => lineArrow(110, 92, 110, 38),
  },
  celebrate: {
    arms: {
      l: ['M31.5 62 Q16 46 18 27', [18, 25]],
      r: ['M88.5 62 Q104 46 102 27', [102, 25]],
    },
    legs: 'stand',
    face: 'happy',
    props: () => spark(9, 22, 5) + spark(111, 18, 6) + spark(104, 44, 3.5),
  },
};

function chair(kind: Pose['chair']) {
  if (kind === 'side') {
    // seen side-on: a short backrest behind him, top at mid-back
    return {
      back: `<g class="chair"><rect x="15" y="62" width="14" height="40" rx="5" fill="${C.chairBack}" stroke="${C.ink}" stroke-width="2.2"/><path d="M22 104 L19 131 M93 104 L96 131" ${stroke(2.6)}/></g>`,
      seat: `<rect class="seat" x="13" y="95" width="89" height="9" rx="4" fill="${C.chairSeat}" stroke="${C.ink}" stroke-width="2.2"/>`,
    };
  }
  if (kind) {
    return {
      back: `<g class="chair"><rect x="24" y="36" width="72" height="62" rx="12" fill="${C.chairBack}" stroke="${C.ink}" stroke-width="2.2"/><path d="M29 104 L26 131 M91 104 L94 131" ${stroke(2.6)}/></g>`,
      seat: `<rect class="seat" x="19" y="95" width="82" height="9" rx="4" fill="${C.chairSeat}" stroke="${C.ink}" stroke-width="2.2"/>`,
    };
  }
  return { back: '', seat: '' };
}

function svg(poseName: PoseName = 'idle', opts: { title?: string } = {}) {
  // the fallback is for a pose name from outside the type checker (a dev page)
  const p = POSES[poseName] || POSES.idle;
  const title = opts.title || 'Gino the Gnocchi';
  const hand = p.handShape || {};

  const armL = arm('arm-l', p.arms.l[0], p.arms.l[1], hand.l);
  const armR = arm('arm-r', p.arms.r[0], p.arms.r[1], hand.r);
  const cup = p.cup
    ? `<g class="cup"><rect x="99" y="75" width="10" height="12" rx="2" fill="${C.water}" stroke="${C.ink}" stroke-width="1.6"/><path d="M100.5 79 L107.5 79" ${stroke(1.2, '#8DB4C9')}/></g>`
    : '';
  const armsCls = `arms${p.bend && p.bend.arms ? ' bend mv' : ''}`;
  const behind = `<g class="${armsCls}">${p.armFront === 'l' ? '' : armL}${p.armFront === 'r' ? '' : armR}</g>`;
  const front = p.armFront
    ? `<g class="${armsCls}">${p.armFront === 'l' ? armL : ''}${p.armFront === 'r' ? armR : ''}</g>`
    : '';

  const legs = LEGS[p.legs].map(([cls, d, shoe]) => leg(cls, d, shoe)).join('');
  const tilt = p.tilt ? ` transform="rotate(${p.tilt} 60 92)"` : '';
  const ch = chair(p.chair);

  // a bending pose carries its bend as CSS variables for card.css
  let vars = '';
  if (p.bend) {
    const b = p.bend;
    const bent = shellPath(SHELL.map((pt) => bendPoint(pt, b)));
    vars = ` style="--bend-o: ${b.cx}px ${b.cy}px; --bend-t: translate(${b.dx || 0}px, ${b.dy || 0}px) rotate(${b.rot || 0}deg); --bent: path('${bent}')"`;
  }

  return `<svg class="gino pose-${poseName}" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}"${vars}>
  <ellipse class="floor" cx="60" cy="130" rx="30" ry="4" fill="${C.ink}" opacity=".12"/>
  ${ch.back}
  <g class="figure">
    <g class="legs">${legs}</g>
    <g class="torso"${tilt}>
      ${behind}
      ${body(face(p.face, p.faceShift || 0))}
      ${front}
      ${cup}
    </g>
  </g>
  ${ch.seat}
  ${p.props ? p.props() : ''}
</svg>`;
}

// ---------- moving in time (browser only) ----------

interface MoveTiming {
  seconds?: number;
  into?: number;
  from?: PlateMove | null;
}

// Put the Gino inside `el` into `move`, taking `seconds` to get there.
// card.css draws each move from el's data-move and the timing variables.
// `into`: seconds already spent in this move, to join it part-way through.
// `from`: snap to this move first without animating, so a jump (a seek in the
// timer) lands mid-move instead of easing in from wherever Gino was.
function setMove(el: HTMLElement, move: PlateMove, { seconds = 1, into = 0, from = null }: MoveTiming = {}) {
  if (from && from !== move) {
    el.classList.add('snap');
    el.dataset.move = from;
    void el.offsetWidth; // commit the start pose
    el.classList.remove('snap');
  }
  el.style.setProperty('--move-dur', `${Math.max(0, seconds)}s`);
  el.style.setProperty('--move-delay', `${-Math.max(0, into)}s`);
  el.dataset.move = move;
}

interface DemoOptions {
  /** Milliseconds before the first phase. */
  delay?: number;
  onPhase?: ((phase: RepPhase, i: number) => void) | null;
}

// Loop one rep on `el`: phases are [{ move, seconds }], as in exercises.ts.
// 'hold' (or no move) keeps the last move. onPhase(phase, i) is told each
// phase as it starts. Returns a stop function. It runs with reduced motion
// too: the demo is the instructions (see the note at the end of card.css).
function demo(el: HTMLElement, phases: readonly RepPhase[], { delay = 0, onPhase = null }: DemoOptions = {}): () => void {
  let id = 0;
  let i = 0;
  let current: PlateMove | null = null;
  if (!phases || !phases.length) return () => {};
  const step = () => {
    const ph = phases[i % phases.length];
    const sec = Math.max(0.2, Number(ph.seconds) || 1);
    if (ph.move && ph.move !== 'hold' && ph.move !== current) {
      setMove(el, ph.move, { seconds: sec });
      current = ph.move;
    }
    if (onPhase) onPhase(ph, i % phases.length);
    i += 1;
    id = window.setTimeout(step, sec * 1000);
  };
  // window's timers return the page's numeric ids (the bare names type as Node's)
  id = window.setTimeout(step, delay);
  return () => window.clearTimeout(id);
}

// Object.keys only promises strings; POSES has exactly one key per PoseName.
const poses = Object.keys(POSES) as PoseName[];

export { svg, poses, C as colors, setMove, demo };
