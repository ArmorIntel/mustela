import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderScheduler } from '../src/background/provider-scheduling.js';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const guard = (operation = () => {}) => operation();
const quota = (retryAfter) => Object.assign(new Error('HTTP 429'), { status: 429, retryAfter });

test('provider starts respect configurable spacing and remain independent', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const scheduler = createProviderScheduler();
  const calls = [];
  const run = (id, config = {}) => scheduler.run(id, config, guard, () => { calls.push([id, Date.now()]); });
  await run('virustotal');
  const second = run('virustotal');
  await run('shodan');
  await flush();
  assert.equal(calls.length, 2);
  t.mock.timers.tick(14999);
  await flush();
  assert.equal(calls.length, 2);
  t.mock.timers.tick(1);
  await second;
  assert.equal(calls[2][1], 115000);
  await run('virustotal', { minIntervalMs: 0 });
  assert.equal(calls.length, 4);
});

for (const [header, delay] of [['60', 60000], [new Date(160000).toUTCString(), 60000], [undefined, 60000], ['nonsense', 60000], ['-1', 60000], ['+1', 60000]]) {
  test(`429 respects Retry-After ${header} without queuing a retry`, async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
    const scheduler = createProviderScheduler();
    let calls = 0;
    const run = () => scheduler.run('virustotal', {}, guard, () => { calls++; throw quota(header); });
    await assert.rejects(run(), (error) => error.retryAfterSeconds === delay / 1000);
    t.mock.timers.tick(1000);
    await assert.rejects(run(), (error) => error.retryAfterSeconds === 59 && /quota reached.*59 s/i.test(error.message));
    assert.equal(calls, 1);
    await scheduler.run('abuseipdb', {}, guard, () => { calls++; });
    t.mock.timers.tick(delay - 1000);
    await assert.rejects(run());
    assert.equal(calls, 3);
  });
}

test('large configured intervals cannot overflow a platform timer', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const scheduler = createProviderScheduler();
  let calls = 0;
  const run = () => scheduler.run('shodan', { minIntervalMs: 2147483648 }, guard, () => { calls++; });
  await run();
  const second = run();
  await flush();
  t.mock.timers.tick(2147483647);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await second;
  assert.equal(calls, 2);
});

test('a queued request rechecks cooldown set by its predecessor', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const scheduler = createProviderScheduler();
  let release;
  const first = scheduler.run('virustotal', {}, guard, () => new Promise((resolve) => { release = resolve; }));
  await flush();
  let sent = false;
  const second = scheduler.run('virustotal', {}, guard, () => { sent = true; });
  const refusal = assert.rejects(second, /quota reached/i);
  release(Promise.reject(quota('60')));
  await assert.rejects(first);
  await refusal;
  assert.equal(sent, false);
});

test('pause clears waiting work immediately and resume never replays it', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const scheduler = createProviderScheduler();
  let allowed = true;
  const run = (operation = () => {}) => {
    if (!allowed) throw Object.assign(new Error('paused'), { code: 'MUSTELA_PAUSED' });
    return operation();
  };
  let calls = 0;
  await scheduler.run('shodan', {}, run, () => { calls++; });
  const waiting = scheduler.run('shodan', {}, run, () => { calls++; });
  const refusal = assert.rejects(waiting, { code: 'MUSTELA_PAUSED' });
  await flush();
  allowed = false;
  scheduler.clearPending();
  await refusal;
  allowed = true;
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(calls, 1);
});
