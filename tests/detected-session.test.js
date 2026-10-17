import test from 'node:test';
import assert from 'node:assert/strict';

let session;
let local;
let writes;
let beforeSet;
let failSet;
const area = (store, track = false) => ({
  async get(key) { return { [key]: structuredClone(store[key]) }; },
  async set(values) {
    if (track) {
      await beforeSet();
      if (failSet) throw new Error('Session unavailable');
      writes.push(structuredClone(values));
    }
    Object.assign(store, structuredClone(values));
  },
  async remove(key) { delete store[key]; }
});
function setup() {
  session = {};
  local = { mustela_last_detected: { 7: ['legacy'] }, mustela_history: ['keep'] };
  writes = [];
  beforeSet = async () => {};
  failSet = false;
  globalThis.chrome = { storage: { session: area(session, true), local: area(local) } };
}
const storage = await import('../src/storage/storage.js');
const context = { pageUrl: 'https://report.test/', pageTitle: 'Report' };
const iocs = ['8.8.8.8', '1.1.1.1'].map((normalized) => ({ type: 'ip', normalized, raw: normalized, sourceContext: context }));

test('detected IOC use independent session keys, store context once and restore the popup shape', async () => {
  setup();
  await Promise.all([storage.saveDetectedForTab(7, iocs), storage.saveDetectedForTab(8, iocs.slice(1))]);
  assert.equal(Object.keys(session).length, 2);
  assert.deepEqual(await storage.getDetectedForTab(7), iocs);
  const record = Object.values(session).find((value) => value.iocs.length === 2);
  assert.deepEqual(record.sourceContext, context);
  assert.ok(record.iocs.every((ioc) => !Object.hasOwn(ioc, 'sourceContext')));
  assert.deepEqual(local.mustela_last_detected, { 7: ['legacy'] });
  await storage.clearDetectedForTab(7);
  assert.deepEqual(await storage.getDetectedForTab(7), []);
  assert.deepEqual(await storage.getDetectedForTab(8), iocs.slice(1));
  assert.equal(Object.keys(session).length, 1);
});

test('repeated lists do not write, even concurrently or after a worker module reload', async () => {
  setup();
  await Promise.all(Array.from({ length: 5 }, () => storage.saveDetectedForTab(7, iocs)));
  assert.equal(writes.length, 1);
  const restarted = await import('../src/storage/storage.js?restarted');
  assert.deepEqual(await restarted.getDetectedForTab(7), iocs);
  await restarted.saveDetectedForTab(7, structuredClone(iocs));
  assert.equal(writes.length, 1);
  await restarted.saveDetectedForTab(7, iocs.slice(1));
  assert.equal(writes.length, 2);
  await restarted.saveDetectedForTab(7, []);
  assert.deepEqual(await restarted.getDetectedForTab(7), []);
  const count = writes.length;
  await restarted.saveDetectedForTab(7, []);
  await restarted.saveDetectedForTab(9, []);
  assert.equal(writes.length, count);
});

test('cleanup waits for pending writes and a storage error does not poison the tab queue', async () => {
  setup();
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  beforeSet = async () => { entered(); await gate; };
  const saving = storage.saveDetectedForTab(7, iocs);
  await started;
  const clearing = storage.clearDetectedForTab(7);
  release();
  await Promise.all([saving, clearing]);
  assert.deepEqual(session, {});
  failSet = true;
  await assert.rejects(storage.saveDetectedForTab(7, iocs), /Session unavailable/);
  failSet = false;
  await storage.saveDetectedForTab(7, iocs);
  assert.deepEqual(await storage.getDetectedForTab(7), iocs);
});

test('legacy cleanup removes only the disk-backed detected blob', async () => {
  setup();
  await storage.removeLegacyDetected();
  assert.deepEqual(local, { mustela_history: ['keep'] });
});
