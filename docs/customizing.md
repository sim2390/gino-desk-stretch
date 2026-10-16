# Customizing Gino

How to change the stretches, their timings and Gino's defaults, and how to check your changes before
you build. You'll need the source code: see [Run it from the source](../README.md#run-it-from-the-source).

- [Change the stretches](#change-the-stretches)
- [Guided reps](#guided-reps)
- [Gino's poses and moves](#ginos-poses-and-moves)
- [Change the defaults](#change-the-defaults)
- [Check your changes](#check-your-changes)

## Change the stretches

The stretches are a list in [`src/exercises.ts`](../src/exercises.ts). Gino goes through them in
order, and the one marked `walk: true` takes every third turn. Add, remove, reorder or reword them
freely.

The list is typed (the `Exercise` shape in [`src/types.ts`](../src/types.ts)), so a misspelled field,
pose or move is an error: your editor underlines it, and `npm run typecheck` reports it.

A simple timed stretch:

```js
{
  id: 'eye-break',             // unique, letters and dashes
  name: 'Eye break',           // the card's title
  pose: 'eyes',                // how Gino demonstrates it: see the poses below
  text: 'Look at something at least 6 metres away and blink slowly.',
  dose: '20 seconds',          // the short line under the instruction
  seconds: 20,                 // how long the timer runs
  ready: 'Find something far away', // shown during "Get ready"
  howTo: [                     // the steps behind "How to"
    'Find a window or the far end of the room.',
    'Let your eyes rest on it and blink slowly a few times.',
  ],
},
```

Every field:

| Field | Meaning |
| --- | --- |
| `id` | A unique name for the stretch. |
| `name` | The title on the card. |
| `pose` | Which of Gino's poses demonstrates it. |
| `text` | The one-line instruction. |
| `dose` | The short line under the instruction, such as "10 slow reps". |
| `seconds` | How long the timer runs. Not needed with `rep`. |
| `reps` | How many reps. Shows "Rep 3 of 10" while the timer runs. |
| `rep` | The parts of one rep, for [guided reps](#guided-reps). |
| `lead` | Seconds of "Get ready" before the timer. Default 3; `0` for none. |
| `ready` | What to do during "Get ready". |
| `sides` | `true` to switch sides halfway: Gino mirrors and the card says "Other side". Only for a plain timed stretch, not with `rep`. |
| `walk` | `true` for the walkaround, which takes every third turn. Only the first stretch marked `walk` is used. |
| `howTo` | The steps behind "How to". |

## Guided reps

Give a stretch a `rep` list and the timer coaches every part of every rep. Each part has a cue, a
length in seconds, and a move for Gino. A pause between reps is just another part.

```js
{
  id: 'chin-tucks',
  name: 'Chin tucks',
  pose: 'chinTuck',
  text: 'Slide your head straight back, like making a double chin.',
  dose: '10 slow reps',
  reps: 10,
  rep: [
    { cue: 'Tuck back', seconds: 2, move: 'in', hint: 'chin level' },
    { cue: 'Hold', seconds: 2, move: 'hold' },
    { cue: 'Relax', seconds: 1.5, move: 'out' },
  ],
  ready: 'Sit tall and look straight ahead',
  howTo: [ /* ... */ ],
},
```

| Part field | Meaning |
| --- | --- |
| `cue` | What the card says, large. Keep it short: long cues shrink to fit. |
| `seconds` | How long this part lasts. The ring counts it down. |
| `move` | What Gino does: one of his pose's moves (below), or `'hold'` to stay where he is. |
| `hint` | Optional. A few words after the rep count, such as "breathe out". |

The timer length is worked out from the parts: chin tucks are 10 × 5.5 s = 55 s, after the 3-second
"Get ready". Keep the `howTo` steps and `dose` consistent with the timings you choose.

## Gino's poses and moves

| Pose | Used for | Moves for guided reps |
| --- | --- | --- |
| `sitTall` | Sit up straight | |
| `chinTuck` | Chin tucks | `in` (head glides back), `out` |
| `neckSide` | Neck side stretch | |
| `eyes` | Eye break | |
| `thoracic` | Thoracic extension | `arch` (arches back over the chair), `up` |
| `shoulderRoll` | Shoulder rolls | `up` (shrug), `back` (squeeze), `down` |
| `walk` | Walkaround | |
| `idle`, `wave`, `celebrate` | Skipped card, welcome and snooze, finished | |

Poses without moves loop their own demonstration. To add a pose or a move:

1. Add its name to `PoseName` (and any new move to `Move`) in [`src/types.ts`](../src/types.ts).
2. Draw the pose in `POSES` in [`src/gino.ts`](../src/gino.ts). Each pose is built from arms, legs, a
   face and optional props on a 120 × 140 grid.
3. Add its moves in the "Rep poses move in time with the timer" section of
   [`src/card.css`](../src/card.css). Each move is a rule like
   `[data-move="in"] .pose-chinTuck .bend { transform: ...; }`. Gino transitions to it over the
   part's `seconds`.
4. Parts that should animate need the `mv` class in `gino.ts`.

## Change the defaults

The defaults are at the top of [`main.ts`](../main.ts):

```ts
const DEFAULT_SETTINGS: Settings = {
  intervalMin: 20,     // active screen time between stretches
  snoozeMin: 10,
  idleResetMin: 5,     // idle this long counts as a break and restarts the timer
  autoSnoozeMin: 4,    // an ignored card snoozes itself
  waitWhenBusy: true,  // Windows: hold reminders during calls and full-screen apps
  ...
};
```

The choices in **Remind me every** are in `buildMenu()` in the same file.

Your own saved settings win over these defaults. If you change a default and don't see it, edit or
delete `settings.json` (in `%APPDATA%\Gino` on Windows, `~/Library/Application Support/Gino` on
macOS).

## Check your changes

- **`npm run fast`** runs Gino with minutes turned into seconds, so a stretch comes up after 20
  seconds. The 5-minute idle break and the 4-minute auto-snooze stay in real minutes.
- **`npm run screens`** renders every state of every stretch and writes a report to
  `screens/index.html`, including live cards you can start. Run it after any change to the stretches
  or the card.
- **`dev/poses.html`**: run `npm run build`, then open it in a browser to see all of Gino's poses,
  with the guided-rep poses looping one rep.
- **`npm run typecheck`** catches misspelled fields, poses and moves.
- **`npm test`** checks the timer and placement logic.

When you're happy, build new installers: see [Development](development.md#building-the-installers).
