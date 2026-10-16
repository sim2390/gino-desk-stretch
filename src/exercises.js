// The stretches Gino rotates through. Edit freely: add, remove or reword.
//   pose     one of the poses in src/gino.js
//   dose     the short line under the instruction
//   seconds  how long the guided timer runs
//   reps     optional: shows "Rep 3 of 10" while the timer runs
//   sides    optional: halfway through, Gino says "Switch sides" and mirrors
//   howTo    steps shown when you open "How to"
// The walkaround comes up every third reminder (about once an hour at 20 min).

module.exports = [
  {
    id: 'sit-tall',
    name: 'Sit up straight',
    pose: 'sitTall',
    text: 'Feet flat, hips to the back of the chair, shoulders down.',
    dose: '15 seconds',
    seconds: 15,
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
    seconds: 45,
    reps: 10,
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
    dose: '10 reps',
    seconds: 40,
    reps: 10,
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
    seconds: 30,
    reps: 10,
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
    howTo: [
      'Stand up and walk anywhere: the kitchen, the stairs, a lap of the office.',
      'Fill your water glass on the way back.',
    ],
  },
];
