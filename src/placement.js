// Decides where the card window goes. Pure logic with no Electron imports, so it can be
// tested with plain Node. The card starts in the bottom-right corner of the main screen.
// Drag it somewhere and it comes back to that spot, as long as that screen is still connected.

/** @typedef {{x: number, y: number, width: number, height: number}} Rect */

const MIN_HEIGHT = 120;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const fitHeight = (h, area) => clamp(Math.round(h), MIN_HEIGHT, area.height);

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * @param {object} o
 * @param {Rect} o.primary  work area of the main screen
 * @param {{bounds: Rect, workArea: Rect}[]} o.displays  every connected screen
 * @param {{x: number, bottom: number}|null} o.saved  where you last dragged the card
 * @param {number} o.width
 * @param {number} o.height  the height the card wants
 * @param {number} o.edge    gap to the screen edge in the default corner
 * @returns {Rect}
 */
function cardBounds({ primary, displays, saved, width, height, edge }) {
  if (saved) {
    // The bottom edge stays put, so a taller card grows upward, like in the corner.
    const want = { x: saved.x, y: saved.bottom - height, width, height };
    // Match on the whole screen, taskbar included, so a card dropped over the taskbar
    // stays on that screen; then keep it inside the part the taskbar doesn't cover.
    let area = null;
    let best = 0;
    for (const d of displays) {
      const o = overlap(want, d.bounds);
      if (o > best) [area, best] = [d.workArea, o];
    }
    if (area) {
      const h = fitHeight(height, area);
      return {
        x: Math.round(clamp(want.x, area.x, area.x + area.width - width)),
        y: Math.round(clamp(saved.bottom - h, area.y, area.y + area.height - h)),
        width,
        height: h,
      };
    }
    // That screen is gone: fall back to the corner.
  }
  const h = fitHeight(height, primary);
  return {
    x: Math.round(primary.x + primary.width - width - edge),
    y: Math.round(primary.y + primary.height - h - edge),
    width,
    height: h,
  };
}

module.exports = { cardBounds };
