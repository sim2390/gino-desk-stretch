// Decides where the card window goes. Pure logic with no Electron imports, so it can be
// tested with plain Node. The card starts in the bottom-right corner of the main screen.
// Drag it somewhere and it comes back to that spot, as long as that screen is still connected.

import type { CardPos } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A connected screen: all of it, and the part the taskbar doesn't cover. */
export interface ScreenArea {
  bounds: Rect;
  workArea: Rect;
}

export interface CardBoundsOptions {
  /** work area of the main screen */
  primary: Rect;
  /** every connected screen */
  displays: ScreenArea[];
  /** where you last dragged the card */
  saved: CardPos | null;
  width: number;
  /** the height the card wants */
  height: number;
  /** gap to the screen edge in the default corner */
  edge: number;
}

const MIN_HEIGHT = 120;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));
const fitHeight = (h: number, area: Rect): number => clamp(Math.round(h), MIN_HEIGHT, area.height);

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function cardBounds({ primary, displays, saved, width, height, edge }: CardBoundsOptions): Rect {
  if (saved) {
    // The bottom edge stays put, so a taller card grows upward, like in the corner.
    const want: Rect = { x: saved.x, y: saved.bottom - height, width, height };
    // Match on the whole screen, taskbar included, so a card dropped over the taskbar
    // stays on that screen; then keep it inside the part the taskbar doesn't cover.
    let area: Rect | null = null;
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
