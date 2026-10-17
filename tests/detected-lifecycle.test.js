import test from 'node:test';
import assert from 'node:assert/strict';

let message;
let updated;
let removed;
let installed;
const local = { mustela_last_detected: { 7: ['legacy'] }, mustela_history: ['keep'] };
const session = {};
const area = (store) => ({
  async get(key) { return { [key]: structuredClone(store[key]) }; },
  async set(values) { Object.assign(store, structuredClone(values)); },
  async remove(key) { delete store[key]; }
});
globalThis.chrome = {
  storage: { local: area(local), session: area(session) },
  runtime: {
    onMessage: { addListener(fn) { message = fn; } },
    onInstalled: { addListener(fn) { installed = fn; } }
  },
  tabs: {
    onUpdated: { addListener(fn) { updated = fn; } },
    onRemoved: { addListener(fn) { removed = fn; } }
  },
  contextMenus: { onClicked: { addListener() {} }, removeAll() {} }
};
await import('../src/background/background.js');
const iocs = [{ type: 'ip', normalized: '8.8.8.8', sourceContext: { pageUrl: 'https://report.test', pageTitle: 'Report' } }];
const send = (type, payload, tabId = 7) => new Promise((resolve) => message({ type, payload }, { tab: { id: tabId } }, resolve));

test('worker startup and update remove legacy detection without touching history', async () => {
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(local.mustela_last_detected, undefined);
  local.mustela_last_detected = { 7: ['legacy'] };
  await installed({ reason: 'update' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(local, { mustela_history: ['keep'] });
});

test('tab closure clears only that tab and navigation clears detection before completion', async () => {
  assert.equal(typeof removed, 'function');
  await Promise.all([send('PAGE_IOCS_DETECTED', iocs), send('PAGE_IOCS_DETECTED', iocs, 8)]);
  assert.deepEqual((await send('GET_DETECTED_IOCS', { tabId: 7 })).data, iocs);
  await removed(7);
  assert.deepEqual((await send('GET_DETECTED_IOCS', { tabId: 7 })).data, []);
  assert.deepEqual((await send('GET_DETECTED_IOCS', { tabId: 8 })).data, iocs);
  await updated(8, { title: 'New title' }, {});
  assert.deepEqual((await send('GET_DETECTED_IOCS', { tabId: 8 })).data, iocs);
  await updated(8, { status: 'loading' }, {});
  assert.deepEqual((await send('GET_DETECTED_IOCS', { tabId: 8 })).data, []);
  await send('PAGE_IOCS_DETECTED', iocs, 8);
  await updated(8, { url: 'https://report.test/next' }, {});
  assert.deepEqual((await send('GET_DETECTED_IOCS', { tabId: 8 })).data, []);
  assert.deepEqual(session, {});
});
