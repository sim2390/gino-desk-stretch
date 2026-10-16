// Run with: npm test
const assert = require('assert');
const { cardBounds } = require('../src/placement');

// A laptop as the main screen, with a second monitor to its left (listed first, as Windows can).
// Each has a 48 px taskbar along the bottom, outside its work area.
const main = { x: 0, y: 0, width: 1920, height: 1032 };
const left = { x: -2560, y: 0, width: 2560, height: 1392 };
const mainScreen = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: main };
const leftScreen = { bounds: { x: -2560, y: 0, width: 2560, height: 1440 }, workArea: left };
const displays = [leftScreen, mainScreen];
const place = (saved, height = 214) =>
  cardBounds({ primary: main, displays, saved, width: 440, height, edge: 8 });

const tests = {
  'starts in the bottom-right corner of the main screen, not the other one'() {
    assert.deepStrictEqual(place(null), { x: 1472, y: 810, width: 440, height: 214 });
  },
  'comes back to where you dragged it, on either screen'() {
    assert.deepStrictEqual(place({ x: 300, bottom: 600 }), { x: 300, y: 386, width: 440, height: 214 });
    assert.deepStrictEqual(place({ x: -2000, bottom: 900 }), { x: -2000, y: 686, width: 440, height: 214 });
  },
  'a taller card grows upward from where you left it'() {
    assert.deepStrictEqual(place({ x: 300, bottom: 600 }, 300), { x: 300, y: 300, width: 440, height: 300 });
  },
  'stays fully on screen when dragged half off an edge'() {
    assert.deepStrictEqual(place({ x: 1700, bottom: 1100 }), { x: 1480, y: 818, width: 440, height: 214 });
  },
  'near the top, growing pushes it down instead of off the screen'() {
    assert.deepStrictEqual(place({ x: 300, bottom: 250 }, 300), { x: 300, y: 0, width: 440, height: 300 });
  },
  'dropped over the taskbar, it stays on that screen just above it'() {
    assert.deepStrictEqual(place({ x: -1500, bottom: 1610 }), { x: -1500, y: 1178, width: 440, height: 214 });
  },
  'goes back to the corner when that screen is unplugged'() {
    const laptopOnly = cardBounds({ primary: main, displays: [mainScreen], saved: { x: -2000, bottom: 900 }, width: 440, height: 214, edge: 8 });
    assert.deepStrictEqual(laptopOnly, { x: 1472, y: 810, width: 440, height: 214 });
  },
  'never taller than the screen, never shorter than 120'() {
    assert.strictEqual(place(null, 5000).height, 1032);
    assert.strictEqual(place(null, 50).height, 120);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
