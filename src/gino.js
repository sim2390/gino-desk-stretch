/*
 * Gino the Gnocchi: an original mascot drawn as SVG.
 * Gino.svg(pose) returns an SVG string. Animations live in card.css and
 * key off the class names used here (.figure, .torso, .arm-l, .arm-r,
 * .leg-l, .leg-r, .eyes, .eye, .chin, .prop, .spark).
 * Works in the browser (window.Gino) and in Node (module.exports).
 */
(function (root) {
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

  const r1 = (n) => Math.round(n * 10) / 10;
  const rad = (d) => (d * Math.PI) / 180;
  const stroke = (w, color = C.ink) =>
    `fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

  function head(x, y, tx, ty, size = 5, color = C.ink) {
    // arrowhead at (x, y) pointing along unit vector (tx, ty)
    const rot = (vx, vy, deg) => {
      const c = Math.cos(rad(deg));
      const s = Math.sin(rad(deg));
      return [vx * c - vy * s, vx * s + vy * c];
    };
    const [ax, ay] = rot(-tx, -ty, 30);
    const [bx, by] = rot(-tx, -ty, -30);
    return `<path d="M${r1(x + ax * size)} ${r1(y + ay * size)} L${r1(x)} ${r1(y)} L${r1(x + bx * size)} ${r1(y + by * size)}" ${stroke(2.4, color)}/>`;
  }

  function lineArrow(x0, y0, x1, y1, color = C.sage) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    return `<g class="prop arrow"><path d="M${x0} ${y0} L${x1} ${y1}" ${stroke(2.4, color)}/>${head(x1, y1, (x1 - x0) / len, (y1 - y0) / len, 5, color)}</g>`;
  }

  function arcArrow(cx, cy, r, a0, a1, color = C.sage) {
    const p = (a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    const dir = a1 > a0 ? 1 : -1;
    const tx = -Math.sin(rad(a1)) * dir;
    const ty = Math.cos(rad(a1)) * dir;
    return `<g class="prop arrow"><path d="M${r1(x0)} ${r1(y0)} A${r} ${r} 0 ${large} ${sweep} ${r1(x1)} ${r1(y1)}" ${stroke(2.2, color)}/>${head(x1, y1, tx, ty, 4.5, color)}</g>`;
  }

  function spark(x, y, s = 5) {
    return `<path class="spark" d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z" fill="${C.butter}" stroke="${C.ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
  }

  function arm(cls, d, hand, handShape) {
    const handSvg =
      handShape === 'flat'
        ? `<ellipse cx="${hand[0]}" cy="${hand[1]}" rx="7.5" ry="3.4" fill="${C.ink}" transform="rotate(-8 ${hand[0]} ${hand[1]})"/>`
        : `<circle cx="${hand[0]}" cy="${hand[1]}" r="4.2" fill="${C.ink}"/>`;
    return `<g class="${cls}"><path d="${d}" ${stroke(5)}/>${handSvg}</g>`;
  }

  function leg(cls, d, shoe) {
    const [x, y, angle] = shoe;
    return `<g class="${cls}"><path d="${d}" ${stroke(5)}/><ellipse cx="${x}" cy="${y}" rx="8.5" ry="4.6" fill="${C.shoe}" stroke="${C.ink}" stroke-width="2" transform="rotate(${angle || 0} ${x} ${y})"/></g>`;
  }

  // Faces. dx shifts features sideways for the three-quarter view.
  function face(kind, dx = 0) {
    const eyeL = 50 + dx;
    const eyeR = 70 + dx;
    const brows = `<path d="M${eyeL - 5} 47 Q${eyeL} 44.4 ${eyeL + 5} 47 M${eyeR - 5} 47 Q${eyeR} 44.4 ${eyeR + 5} 47" ${stroke(2.2)}/>`;
    const eye = (x, y) =>
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
        return `${brows}<g class="eyes">${eye(eyeL, 56)}${eye(eyeR, 56)}</g>${smile}<path class="chin" d="M${63 + dx} 76.5 Q${68 + dx} 79.5 ${73 + dx} 76.5" ${stroke(2)}/>`;
      default:
        return `${brows}<g class="eyes">${eye(eyeL, 56)}${eye(eyeR, 56)}</g>${smile}`;
    }
  }

  function body(faceSvg) {
    // A plump pillow with fork ridges top and bottom, and a sage leaf garnish.
    return `<g class="body">
      <rect x="28" y="24" width="64" height="72" rx="25" fill="${C.body}" stroke="${C.ink}" stroke-width="2.6"/>
      <path d="M41 31 Q60 27 79 31 M37 37 Q60 32.5 83 37" ${stroke(2.4, C.ridge)}/>
      <path d="M36 81 Q60 86 84 81 M38 87 Q60 92 82 87 M43 92.5 Q60 96 77 92.5" ${stroke(2.4, C.ridge)}/>
      <circle cx="35" cy="60" r="1.1" fill="#fff" opacity=".75"/><circle cx="85" cy="68" r="1.2" fill="#fff" opacity=".75"/><circle cx="83" cy="48" r=".9" fill="#fff" opacity=".75"/><circle cx="40" cy="74" r=".8" fill="#fff" opacity=".75"/>
      <g class="leaf" transform="translate(68 25) rotate(14)">
        <path d="M0 0 C-3.5 -9 2.5 -17.5 13 -19.5 C13.5 -10 8.5 -2.5 0 0 Z" fill="${C.leaf}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M1.5 -2 Q5.5 -9.5 10.5 -15.5" ${stroke(1.4, C.vein)}/>
      </g>
      ${faceSvg}
    </g>`;
  }

  const LEGS = {
    stand: [
      ['leg-l', 'M51 90 L49 121', [45, 124, -4]],
      ['leg-r', 'M69 90 L71 121', [75, 124, 4]],
    ],
    walk: [
      ['leg-l', 'M53 90 L42 119', [38, 122, -10]],
      ['leg-r', 'M67 90 L80 119', [84, 122, 10]],
    ],
  };

  const ARMS = {
    down: {
      l: ['M31.5 64 Q22 76 25 88', [25, 89]],
      r: ['M88.5 64 Q98 76 95 88', [95, 89]],
    },
    lap: {
      l: ['M31.5 64 Q24 78 33 88', [34, 89]],
      r: ['M88.5 64 Q96 78 87 88', [86, 89]],
    },
  };

  // Each pose: arms, legs, face, tilt (static torso rotation), chair, props, armFront.
  const POSES = {
    idle: { arms: ARMS.down, legs: 'stand', face: 'smile' },
    wave: {
      arms: { l: ARMS.down.l, r: ['M88.5 62 Q104 52 104 32', [104, 30]] },
      legs: 'stand',
      face: 'smile',
    },
    chinTuck: {
      arms: ARMS.down,
      legs: 'stand',
      face: 'tuck',
      faceShift: 8,
      props: () => lineArrow(113, 58, 100, 58),
    },
    neckSide: {
      arms: { l: ['M31.5 62 C17 34 38 9 72 19', [74, 20]], r: ARMS.down.r },
      legs: 'stand',
      face: 'smile',
      tilt: -14,
    },
    thoracic: {
      arms: {
        l: ['M31.5 64 L15 45 L30 30', [30, 30]],
        r: ['M88.5 64 L105 45 L90 30', [90, 30]],
      },
      legs: 'stand',
      face: 'up',
      chair: true,
      props: () => arcArrow(60, 26, 16, 200, 340),
    },
    shoulderRoll: {
      arms: ARMS.down,
      legs: 'stand',
      face: 'smile',
      props: () => arcArrow(22, 52, 9, 60, 330) + arcArrow(98, 52, 9, 120, -150),
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

  function svg(poseName = 'idle', opts = {}) {
    const p = POSES[poseName] || POSES.idle;
    const title = opts.title || 'Gino the Gnocchi';
    const hand = p.handShape || {};

    const armL = arm('arm-l', p.arms.l[0], p.arms.l[1], hand.l);
    const armR = arm('arm-r', p.arms.r[0], p.arms.r[1], hand.r);
    const cup = p.cup
      ? `<g class="cup"><rect x="99" y="75" width="10" height="12" rx="2" fill="${C.water}" stroke="${C.ink}" stroke-width="1.6"/><path d="M100.5 79 L107.5 79" ${stroke(1.2, '#8DB4C9')}/></g>`
      : '';
    const behind = `${p.armFront === 'l' ? '' : armL}${p.armFront === 'r' ? '' : armR}`;
    const front = `${p.armFront === 'l' ? armL : ''}${p.armFront === 'r' ? armR : ''}`;

    const legs = LEGS[p.legs].map(([cls, d, shoe]) => leg(cls, d, shoe)).join('');
    const tilt = p.tilt ? ` transform="rotate(${p.tilt} 60 92)"` : '';

    const chairBack = p.chair
      ? `<g class="chair"><rect x="24" y="36" width="72" height="62" rx="12" fill="${C.chairBack}" stroke="${C.ink}" stroke-width="2.2"/><path d="M29 104 L26 131 M91 104 L94 131" ${stroke(2.6)}/></g>`
      : '';
    const chairSeat = p.chair
      ? `<rect class="seat" x="19" y="95" width="82" height="9" rx="4" fill="${C.chairSeat}" stroke="${C.ink}" stroke-width="2.2"/>`
      : '';

    return `<svg class="gino pose-${poseName}" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}">
  <ellipse class="floor" cx="60" cy="130" rx="30" ry="4" fill="${C.ink}" opacity=".12"/>
  ${chairBack}
  <g class="figure">
    <g class="legs">${legs}</g>
    <g class="torso"${tilt}>
      ${behind}
      ${body(face(p.face, p.faceShift || 0))}
      ${front}
      ${cup}
    </g>
  </g>
  ${chairSeat}
  ${p.props ? p.props() : ''}
</svg>`;
  }

  const api = { svg, poses: Object.keys(POSES), colors: C };
  root.Gino = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
