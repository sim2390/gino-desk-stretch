// The shapes shared by the main process, the card and the stretches list.

/** Gino's poses, drawn in src/gino.ts. */
export type PoseName =
  | 'idle'
  | 'wave'
  | 'chinTuck'
  | 'neckSide'
  | 'thoracic'
  | 'shoulderRoll'
  | 'eyes'
  | 'walk'
  | 'sitTall'
  | 'celebrate';

/**
 * A move a rep pose can make in time with the timer (drawn in src/card.css):
 * chinTuck: in, out · thoracic: arch, up · shoulderRoll: up, back, down.
 * 'hold' stays where he is.
 */
export type Move = 'in' | 'out' | 'arch' | 'up' | 'back' | 'down' | 'hold';

/** One part of one rep: "Tuck back" for 2 seconds. */
export interface RepPhase {
  /** What the card says, large. Keep it short. */
  cue: string;
  seconds: number;
  move: Move;
  /** A few words after "Rep 3 of 10", like "breathe out". */
  hint?: string;
}

/** A stretch. See docs/customizing.md for what each field does. */
export interface Exercise {
  id: string;
  name: string;
  pose: PoseName;
  text: string;
  dose: string;
  /** How long the timer runs. Not needed with `rep`. */
  seconds?: number;
  reps?: number;
  /** The parts of one rep, done `reps` times. */
  rep?: RepPhase[];
  /** Seconds of "Get ready" before the timer. Default 3; 0 for none. */
  lead?: number;
  /** What to do during "Get ready". */
  ready?: string;
  /** Switch sides halfway (a plain timed stretch only, not with `rep`). */
  sides?: boolean;
  /** The walkaround: takes every third turn. */
  walk?: boolean;
  howTo: string[];
}

/** The welcome card is shown like a stretch, without the timer fields. */
export type CardContent = Pick<Exercise, 'id' | 'name' | 'pose' | 'text' | 'dose' | 'howTo'> & Partial<Exercise>;

export type CardMode = 'stretch' | 'welcome';

/** Main process → card: what to show. */
export interface ShowPayload {
  mode: CardMode;
  exercise: CardContent;
  todayCount: number;
  snoozeMin: number;
  intervalMin: number;
  autoSnoozeMin: number;
}

/** Card → main process: what the person did. */
export type CardAction = 'start' | 'done' | 'skip' | 'stop' | 'snooze' | 'trynow' | 'dismiss';

/** The main process's answer to an action ('done' sends back today's count). */
export interface ActionReply {
  todayCount?: number;
}

/** The bridge preload.ts puts on the card window as window.ginoApi. */
export interface GinoApi {
  onShow(cb: (payload: ShowPayload) => void): void;
  onHide(cb: () => void): void;
  action(name: CardAction, data?: Record<string, unknown>): Promise<ActionReply>;
  resize(height: number): void;
  closed(): void;
}

/** Where you last dragged the card: its left edge and its bottom edge. */
export interface CardPos {
  x: number;
  bottom: number;
}

/** settings.json */
export interface Settings {
  /** Active screen time between stretches. */
  intervalMin: number;
  snoozeMin: number;
  /** Idle this long counts as a break and restarts the timer. */
  idleResetMin: number;
  /** An ignored card snoozes itself after this long. */
  autoSnoozeMin: number;
  /** Windows: hold reminders during calls and full-screen apps. */
  waitWhenBusy: boolean;
  /** null = the corner of the main screen. */
  cardPos: CardPos | null;
  welcomed: boolean;
}

/** stats.json */
export interface Stats {
  /** Stretches done per day, keyed "YYYY-MM-DD". */
  days: Record<string, number>;
  /** Reminders shown so far: every third is the walkaround. */
  reminders: number;
  /** Position in the rotation of the other stretches. */
  cycle: number;
}

declare global {
  interface Window {
    ginoApi?: GinoApi;
  }
}
