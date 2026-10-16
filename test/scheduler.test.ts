// Run with: npm test
import assert from 'node:assert';
import { Scheduler, type TickStatus } from '../src/scheduler';

const MIN = 60 * 1000;
let clock = 0;
const make = () => new Scheduler({ intervalMs: 20 * MIN, idleResetMs: 5 * MIN, now: () => clock });
const run = (s: Scheduler, minutes: number, idleMs = 0, step = 15 * 1000): TickStatus | undefined => {
  let last: TickStatus | undefined;
  for (let t = 0; t < minutes * MIN; t += step) {
    clock += step;
    last = s.tick(step, idleMs);
  }
  return last;
};

const tests = {
  'due after 20 active minutes, not before'() {
    const s = make();
    assert.strictEqual(run(s, 19.75), 'counting');
    assert.strictEqual(run(s, 0.25), 'due');
  },
  'idle for 5 minutes counts as a break and restarts the timer'() {
    const s = make();
    run(s, 15);
    assert.strictEqual(s.tick(15000, 5 * MIN), 'away');
    assert.strictEqual(s.msLeft(), 20 * MIN);
  },
  'short idle does not reset'() {
    const s = make();
    run(s, 10, 2 * MIN);
    assert.strictEqual(s.msLeft(), 10 * MIN);
  },
  'a sleep-sized gap between ticks counts as a break'() {
    const s = make();
    run(s, 15);
    assert.strictEqual(s.tick(30 * MIN, 0), 'away');
    assert.strictEqual(s.msLeft(), 20 * MIN);
  },
  'snooze shortens the next wait, then intervals go back to normal'() {
    const s = make();
    run(s, 20);
    s.snooze(10 * MIN);
    assert.strictEqual(run(s, 10), 'due');
    s.complete();
    assert.strictEqual(s.msLeft(), 20 * MIN);
  },
  'pause holds everything and resumes with a fresh interval'() {
    const s = make();
    run(s, 12);
    s.pause(30 * MIN);
    assert.strictEqual(run(s, 29), 'paused');
    assert.strictEqual(run(s, 1.5), 'counting');
    assert.ok(s.msLeft() > 19 * MIN, 'fresh interval after the pause');
  },
  'changing the interval applies right away to a normal wait'() {
    const s = make();
    run(s, 10);
    s.setInterval(30 * MIN);
    assert.strictEqual(s.msLeft(), 20 * MIN);
  },
  'changing the interval keeps a snooze in place'() {
    const s = make();
    s.snooze(10 * MIN);
    s.setInterval(45 * MIN);
    assert.strictEqual(s.msLeft(), 10 * MIN);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  clock = 0;
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}
process.exitCode = failed ? 1 : 0;
