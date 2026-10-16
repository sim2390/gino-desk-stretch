// The stretches Gino rotates through. Edit freely: add, remove or reword.
// Each one is an Exercise (src/types.ts), so a misspelt field, pose or move name
// is a type error: `npm run typecheck` reports it.
//   pose     one of the poses in src/gino.ts (PoseName)
//   dose     the short line under the instruction
//   seconds  how long the guided timer runs (not needed with `rep`)
//   reps     how many times to do it: shows "Rep 3 of 10" while the timer runs
//   rep      optional: the phases of ONE rep, done `reps` times. The timer coaches
//            each phase and Gino moves in time; its length is worked out from these.
//              cue      what the card says during the phase, short: "Hold"
//              seconds  how long the phase lasts
//              move     what Gino does: a move his pose knows (see the pose in
//                       src/gino.ts and its rules in src/card.css), or 'hold' to stay put
//              hint     optional: a few words after "Rep 3 of 10", like "breathe out"
//            A pause between reps is just another phase ("Relax").
//   lead     seconds of "Get ready" before the timer starts (default 3, 0 for none)
//   ready    what to do during "Get ready", shown under it
//   sides    optional: halfway through, Gino switches to the other side and mirrors
//            (only for a plain timed hold: it doesn't combine with `rep`)
//   howTo    steps shown when you open "How to"
// The walkaround comes up every third reminder (about once an hour at 20 min).

import type { Exercise } from './types';

export const EXERCISES: Exercise[] = [
  {
    id: 'sit-tall',
    name: 'Sit up straight',
    pose: 'sitTall',
    text: 'Feet flat, hips to the back of the chair, shoulders down.',
    dose: '15 seconds',
    seconds: 15,
    ready: 'Hips to the back of the chair',
    howTo: [
      'Slide your hips all the way back in the chair.',
      'Feet flat on the floor, knees roughly level with your hips.',
      'Let your shoulders drop away from your ears and grow tall through the top of your head.',
    ],
  },
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
    howTo: [
      'Sit tall and look straight ahead.',
      'Glide your chin straight back, not down. Hold for 2 seconds.',
      'Relax and repeat. You should feel it at the base of your skull.',
    ],
  },
  {
    id: 'neck-side',
    name: 'Neck side stretch',
    pose: 'neckSide',
    text: 'Ear toward shoulder. Keep the other shoulder down.',
    dose: '20 seconds each side',
    seconds: 40,
    sides: true,
    ready: 'Sit tall, shoulders down',
    howTo: [
      'Sit tall and tip your ear toward your shoulder.',
      'Rest that hand on your head for a gentle extra pull. No yanking.',
      'Switch sides when Gino does.',
    ],
  },
  {
    id: 'eye-break',
    name: 'Eye break',
    pose: 'eyes',
    text: 'Look at something at least 6 metres away and blink slowly.',
    dose: '20 seconds',
    seconds: 20,
    ready: 'Find something far away',
    howTo: [
      'Find a window or the far end of the room.',
      'Let your eyes rest on it and blink slowly a few times.',
    ],
  },
  {
    id: 'thoracic',
    name: 'Thoracic extension',
    pose: 'thoracic',
    text: 'Hands behind your head, arch back over your chair.',
    dose: '10 slow reps',
    reps: 10,
    rep: [
      { cue: 'Arch back', seconds: 3, move: 'arch', hint: 'breathe out' },
      { cue: 'Hold', seconds: 1, move: 'hold' },
      { cue: 'Come up', seconds: 2, move: 'up', hint: 'breathe in' },
    ],
    ready: 'Lace your fingers behind your head',
    howTo: [
      'Sit back so the top of the backrest meets your mid-back.',
      'Lace your fingers behind your head, elbows wide.',
      'Arch back over the backrest as you breathe out, then come back up.',
    ],
  },
  {
    id: 'shoulder-rolls',
    name: 'Shoulder rolls',
    pose: 'shoulderRoll',
    text: 'Shoulders up to your ears, back, and down.',
    dose: '10 slow circles',
    reps: 10,
    rep: [
      { cue: 'Shrug up', seconds: 1.5, move: 'up' },
      { cue: 'Squeeze back', seconds: 1.5, move: 'back' },
      { cue: 'Drop down', seconds: 1.5, move: 'down' },
    ],
    ready: 'Let your arms hang loose',
    howTo: [
      'Let your arms hang loose.',
      'Lift your shoulders toward your ears, squeeze them back, then let them drop.',
      'Keep it slow. Ten big circles.',
    ],
  },
  {
    id: 'walkaround',
    name: 'Walkaround',
    pose: 'walk',
    text: 'Get up and walk. Refill your water while you are at it.',
    dose: '2 minutes',
    seconds: 120,
    walk: true,
    lead: 0,
    howTo: [
      'Stand up and walk anywhere: the kitchen, the stairs, a lap of the office.',
      'Fill your water glass on the way back.',
    ],
  },
];
