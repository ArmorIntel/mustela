import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let store, command, listener, fail, beforeGet, beforeSet, badge, title;
let updates;
globalThis.chrome = {
  commands: { onCommand: { addListener(fn) { command = fn; } } },
  action: {
    async setBadgeText({ text }) { badge = text; updates.push(text); },
    async setTitle(value) { title = value.title; }
  },
  runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } }, async sendMessage() {} },
  contextMenus: { onClicked: { addListener() {} } },
  tabs: { onUpdated: { addListener() {} }, async query() { return [{ id: 1 }]; }, async sendMessage() {} },
  storage: { local: {
    async get(key) { await beforeGet(); return { [key]: store[key] }; },
    async set(values) { await beforeSet(); if (fail) throw new Error('Disk unavailable'); Object.assign(store, values); }
  } }
};
let serial = 0;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const send = (type, payload) => new Promise((resolve) => listener({ type, payload }, {}, resolve));
async function start(paused) {
  store = paused === undefined ? {} : { mustela_paused: paused };
  fail = false; beforeGet = beforeSet = async () => {}; updates = []; badge = ''; title = '';
  await import(`../src/background/background.js?commandTest=${++serial}`);
  await tick();
}
test('manifest declares one Chrome-only pause command with no imposed shortcut', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest/chrome.manifest.json', import.meta.url)));
  assert.deepEqual(manifest.commands, { 'toggle-global-pause': { description: 'Toggle Mustela global pause' } });
});
test('command and popup share durable authority, including keyless and rapid toggles', async () => {
  await start();
  assert.equal(badge, 'ON');
  await command('unrelated');
  assert.equal(store.mustela_paused, undefined);
  await Promise.all([command('toggle-global-pause'), command('toggle-global-pause'), command('toggle-global-pause')]);
  assert.equal(store.mustela_paused, true);
  assert.equal(badge, 'OFF');
  assert.match(title, /OFF.*paused/i);
  assert.deepEqual(updates, ['ON', 'OFF', 'ON', 'OFF']);
  assert.equal((await send('SET_PAUSE_STATE', { paused: false })).ok, true);
  assert.equal(badge, 'ON');
  assert.match(title, /ON.*preferences/i);
});
test('startup waits for saved OFF; no false ON or network navigation during restoration', async () => {
  await start(true);
  assert.equal(badge, 'OFF');
  let release;
  beforeGet = () => new Promise((resolve) => { release = resolve; });
  updates = [];
  await import(`../src/background/background.js?commandTest=${++serial}`);
  await tick();
  assert.ok(!updates.includes('ON'));
  const lookup = send('OPEN_EXTERNAL_PROVIDER', {});
  release();
  assert.equal((await lookup).code, 'MUSTELA_PAUSED');
  await tick();
  assert.equal(badge, 'OFF');
});
test('failed command leaves confirmed badge intact and exposes retryable error until success', async () => {
  await start(); fail = true;
  await command('toggle-global-pause');
  assert.equal(badge, 'ON');
  const state = await send('GET_PAUSE_STATE');
  assert.equal(state.data.paused, false);
  assert.match(state.transitionError, /retry/i);
  fail = false;
  await command('toggle-global-pause');
  assert.equal(badge, 'OFF');
  assert.equal((await send('GET_PAUSE_STATE')).transitionError, undefined);
});
test('badge never confirms an uncommitted write and mixed requests finish in invocation order', async () => {
  await start();
  let release;
  beforeSet = () => new Promise((resolve) => { release = resolve; });
  const first = command('toggle-global-pause');
  await tick();
  assert.equal(badge, 'ON');
  const second = send('SET_PAUSE_STATE', { paused: false });
  beforeSet = async () => {};
  release();
  await Promise.all([first, second]);
  assert.deepEqual(updates, ['ON', 'OFF', 'ON']);
  assert.equal(store.mustela_paused, false);
});

test('failed resume and queued retries retain OFF until a successful durable toggle', async () => {
  await start(true);
  fail = true;
  await Promise.all([command('toggle-global-pause'), command('toggle-global-pause')]);
  assert.equal(store.mustela_paused, true);
  assert.equal(badge, 'OFF');
  assert.deepEqual(updates, ['OFF']);
  assert.match((await send('GET_PAUSE_STATE')).transitionError, /retry/i);
  fail = false;
  await command('toggle-global-pause');
  assert.equal(badge, 'ON');
  assert.equal(store.mustela_paused, false);
});

test('failed startup read publishes no assumed ON and fails network entry closed', async () => {
  await start(true);
  beforeGet = async () => { throw new Error('Read unavailable'); };
  updates = [];
  await import(`../src/background/background.js?commandTest=${++serial}`);
  await tick();
  assert.deepEqual(updates, []);
  assert.equal((await send('OPEN_EXTERNAL_PROVIDER', {})).ok, false);
  beforeGet = async () => {};
  await command('toggle-global-pause');
  assert.equal(store.mustela_paused, false);
  assert.equal(badge, 'ON');
});
