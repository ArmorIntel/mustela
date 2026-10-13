import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimationLoop } from '../docs/assets/landing/scene-loop.js';

function fixture() {
  let serial = 0;
  const jobs = new Map(), draws = [];
  const loop = createAnimationLoop({
    request: fn => { jobs.set(++serial, fn); return serial; },
    cancel: id => jobs.delete(id),
    draw: dt => draws.push(dt)
  });
  const frame = now => {
    const queued = [...jobs]; jobs.clear();
    for (const [, fn] of queued) fn(now);
  };
  return { loop, jobs, draws, frame };
}

test('scene loop composes suspensions and preserves explicit pause', () => {
  const { loop, jobs, draws, frame } = fixture();
  loop.conditions({ visible: true }); frame(100); frame(116);
  assert.equal(jobs.size, 1); assert.equal(draws.length, 2);
  loop.conditions({ hidden: true }); loop.conditions({ reduced: true, visible: false });
  assert.equal(jobs.size, 0);
  loop.conditions({ paused: true, hidden: false, reduced: false, visible: true });
  assert.equal(jobs.size, 0);
  loop.conditions({ paused: false }); frame(20000);
  assert.equal(draws.at(-1), 0);
  frame(22000); assert.equal(draws.at(-1), .033);
  loop.dispose(); loop.conditions({ visible: true });
  assert.equal(jobs.size, 0);
});

test('scene loop never schedules duplicate or post-disposal frames', () => {
  const { loop, jobs, frame, draws } = fixture();
  loop.conditions({ visible: true }); loop.conditions({ visible: true });
  assert.equal(jobs.size, 1);
  loop.dispose(); frame(200); assert.equal(draws.length, 0);
});
