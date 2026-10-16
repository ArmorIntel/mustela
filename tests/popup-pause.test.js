import test from 'node:test';
import assert from 'node:assert/strict';
import { createPauseController } from '../src/popup/state.js';

const ok = (paused) => ({ ok: true, data: { paused } });
test('popup shows only confirmed state, keeps failed OFF retryable and reconciles concurrent changes', async () => {
  let paused = false;
  let fail = true;
  let view;
  const controller = createPauseController(async (type, payload) => {
    if (type === 'SET_PAUSE_STATE') {
      assert.equal(view.paused, false, 'OFF is not optimistic');
      assert.equal(view.pending, true);
      if (fail) return { ok: false, error: 'Storage unavailable. Please retry.' };
      paused = payload.paused;
    }
    return ok(paused);
  }, (value) => { view = value; });
  await controller.refresh();
  assert.equal(view.paused, false);
  await controller.toggle();
  assert.equal(view.paused, false);
  assert.equal(view.pending, false);
  assert.match(view.error, /retry/);
  fail = false;
  await controller.toggle();
  assert.equal(view.paused, true);
  assert.equal(view.error, '');
  paused = false;
  await controller.refresh();
  assert.equal(view.paused, false);
});

test('stale popup reads cannot overwrite newer confirmations; failed reads stay unknown and retryable', async () => {
  let view;
  let finish;
  let calls = 0;
  const controller = createPauseController(() => {
    if (++calls === 1) return new Promise((resolve) => { finish = resolve; });
    return Promise.resolve(ok(true));
  }, (value) => { view = value; });
  const stale = controller.refresh();
  await controller.refresh();
  finish(ok(false));
  await stale;
  assert.equal(view.paused, true);
  const unavailable = createPauseController(async () => { throw new Error('Offline'); }, (value) => { view = value; });
  await unavailable.refresh();
  assert.equal(view.paused, null);
  assert.match(view.error, /Offline/);
  assert.equal(view.pending, false);
});
