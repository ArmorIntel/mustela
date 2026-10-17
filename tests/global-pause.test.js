import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../src/storage/storage.js';

let store = {};
let listener;
let menu;
let failWrite = false;
let beforeGet = async () => {};
let beforeSet = async () => {};
const navigations = [];
const panels = [];
globalThis.chrome = {
  runtime: { id: 'test-extension', onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  contextMenus: { onClicked: { addListener(fn) { menu = fn; } } },
  tabs: {
    onRemoved: { addListener() {} },
    onUpdated: { addListener() {} },
    async create(value) { navigations.push(value); },
    async query() { return []; },
    async sendMessage(id, message) { panels.push(message); }
  },
  storage: { local: {
    async remove(key) { delete store[key]; },
    async get(key) { await beforeGet(key); return { [key]: structuredClone(store[key]) }; },
    async set(values) {
      await beforeSet(values);
      if (failWrite) throw new Error('Storage unavailable; retry');
      Object.assign(store, structuredClone(values));
    }
  } }
};
let worker = 0;
async function restart() { await import(`../src/background/background.js?worker=${++worker}`); }
const send = (type, payload) => new Promise((resolve) => listener({ type, payload }, { id: 'test-extension', url: 'chrome-extension://test-extension/src/popup/popup.html' }, resolve));
const ip = { type: 'ip', normalized: '8.8.8.8' };
const pause = (paused) => send('SET_PAUSE_STATE', { paused });
test('confirmed transitions broadcast to every tab despite restricted failures, but failed writes do not broadcast', async (t) => {
  await setup();
  const delivered = [];
  const notifications = [];
  t.mock.method(chrome.tabs, 'query', async () => [{ id: 1 }, { id: 2 }, { id: 3 }, {}]);
  t.mock.method(chrome.tabs, 'sendMessage', async (id, message) => {
    delivered.push({ id, message });
    if (id === 2) throw new Error('Restricted tab');
  });
  chrome.runtime.sendMessage = async (message) => { notifications.push(message); };
  t.after(() => { delete chrome.runtime.sendMessage; });
  assert.equal((await pause(true)).ok, true);
  assert.deepEqual(delivered.map(({ id }) => id), [1, 2, 3]);
  assert.ok(delivered.every(({ message }) => message.type === 'PAUSE_STATE_UPDATED' && message.payload.paused));
  assert.equal(notifications.length, 1);
  delivered.length = 0;
  failWrite = true;
  assert.equal((await pause(false)).ok, false);
  assert.deepEqual(delivered, []);
  assert.deepEqual(notifications.map((message) => message.type), ['PAUSE_STATE_UPDATED', 'PAUSE_CHANGE_FAILED']);
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function setup({ paused, keys = true } = {}) {
  store = { mustela_settings: structuredClone(DEFAULT_SETTINGS) };
  if (paused !== undefined) store.mustela_paused = paused;
  for (const provider of Object.values(store.mustela_settings.providers)) {
    provider.enabled = true;
    provider.apiKey = keys ? 'test-key' : '';
    provider.baseUrl = 'https://misp.example';
    provider.defaultEventId = '42';
  }
  store.mustela_settings.analystAssist = { enabled: true, baseUrl: 'https://llm.example/v1', apiKey: 'test-key', model: 'test-model' };
  navigations.length = panels.length = 0;
  failWrite = false;
  beforeGet = async () => {};
  beforeSet = async () => {};
  await restart();
}
function blocked(response) {
  assert.equal(response.ok, false);
  assert.equal(response.code, 'MUSTELA_PAUSED');
  assert.match(response.error, /paused/i);
}

test('existing installs default ON; OFF survives worker restart independently of preferences', async () => {
  await setup();
  assert.deepEqual(await send('GET_PAUSE_STATE'), { ok: true, data: { paused: false } });
  const original = await getSettings();
  assert.deepEqual(await pause(true), { ok: true, data: { paused: true } });
  await restart();
  assert.deepEqual(await send('GET_PAUSE_STATE'), { ok: true, data: { paused: true } });
  assert.deepEqual(await getSettings(), original);
  assert.equal(store.mustela_paused, true);
});

test('OFF rejects all transmission entries before validation, configuration, fetch or navigation', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); throw new Error('Provider timed out'); });
  for (const keys of [true, false]) {
    await setup({ paused: true, keys });
    for (const [type, payload] of [
      ['LOOKUP_IOC', ip], ['LOOKUP_IOC', null], ['LOOKUP_IOC', { ...ip, _rerun: true }],
      ['OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc: ip }], ['OPEN_EXTERNAL_PROVIDER', {}],
      ['CORRELATE_IOCS', {}], ['ADD_IOC_TO_MISP', { ioc: ip }], ['ADD_IOC_TO_MISP', {}],
      ...['llm', 'virustotal', 'abuseipdb', 'shodan', 'misp', 'invalid'].map((provider) => ['TEST_API_KEY', { provider }])
    ]) blocked(await send(type, payload));
    for (const menuItemId of ['investigate-selection', 'open-virustotal', 'open-abuseipdb', 'open-shodan']) {
      for (const selectionText of ['8.8.8.8', 'not an IOC']) blocked(await menu({ menuItemId, selectionText }, { id: 1 }));
    }
    assert.deepEqual(navigations, []);
    assert.ok(panels.every((message) => message.type !== 'OPEN_INVESTIGATION_PANEL'));
  }
  assert.deepEqual(calls, []);
});

test('confirmed pause invalidates an in-flight chain across resume, success and timeout', async (t) => {
  for (const failure of [false, true]) {
    await setup();
    const started = deferred();
    const release = deferred();
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      calls.push(url);
      started.resolve();
      await release.promise;
      if (failure) throw new Error('Provider timed out');
      return new Response(JSON.stringify({ data: { attributes: {} } }));
    });
    const lookup = send('LOOKUP_IOC', ip);
    await started.promise;
    assert.equal((await pause(true)).ok, true);
    assert.equal((await pause(false)).ok, true);
    release.resolve();
    blocked(await lookup);
    assert.equal(calls.length, 1);
    assert.equal(store.mustela_history, undefined);
    assert.equal(store.mustela_cache, undefined);
    t.mock.restoreAll();
  }
});

test('pause between the last provider and automatic LLM summary blocks the summary', async (t) => {
  await setup();
  for (const [id, provider] of Object.entries(store.mustela_settings.providers)) provider.enabled = id === 'virustotal';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    return { ok: true, async json() {
      await pause(true);
      return { data: { attributes: {} } };
    } };
  });
  blocked(await send('LOOKUP_IOC', ip));
  assert.equal(calls.length, 1);
});

test('pause while correlation reads history blocks its eventual LLM call', async (t) => {
  await setup();
  store.mustela_history = [ip, { ...ip, normalized: '1.1.1.1' }].map((ioc) => ({ ioc }));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected fetch'); });
  beforeGet = async (key) => { if (key === 'mustela_history') await pause(true); };
  blocked(await send('CORRELATE_IOCS', {}));
  assert.equal(calls, 0);
});

test('concurrent pause transitions and preference patches preserve separate authoritative state', async () => {
  await setup();
  const responses = await Promise.all([
    pause(true), send('SAVE_SETTINGS', { highlightEnabled: false }), pause(false),
    send('SAVE_SETTINGS', { detectionMode: 'strict', paused: true }), pause(true)
  ]);
  assert.ok(responses.every((response) => response.ok));
  assert.deepEqual((await send('GET_PAUSE_STATE')).data, { paused: true });
  const settings = await getSettings();
  assert.equal(settings.highlightEnabled, false);
  assert.equal(settings.detectionMode, 'strict');
  assert.equal(settings.providers.virustotal.apiKey, 'test-key');
  assert.equal(Object.hasOwn(settings, 'paused'), false);
});

test('failed OFF is explicit and retryable; invalid transitions do not change state', async () => {
  await setup();
  failWrite = true;
  const failed = await pause(true);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /storage.*retry/i);
  assert.equal((await send('GET_PAUSE_STATE')).data.paused, false);
  failWrite = false;
  assert.equal((await pause('true')).ok, false);
  assert.equal((await pause(true)).ok, true);
  assert.equal((await send('GET_PAUSE_STATE')).data.paused, true);
});

test('pause during Shodan key validation prevents its second request', async (t) => {
  await setup();
  const started = deferred();
  const release = deferred();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      started.resolve();
      await release.promise;
    }
    return new Response('{}');
  });
  const validation = send('TEST_API_KEY', { provider: 'shodan', apiKey: 'test-key' });
  await started.promise;
  assert.equal((await pause(true)).ok, true);
  release.resolve();
  const response = await validation;
  assert.equal(calls.length, 1, 'the host probe must not start after OFF is confirmed');
  blocked(response);
});

test('pause and resume confirmations wait for durable writes in invocation order', async () => {
  await setup();
  const started = deferred();
  const release = deferred();
  const writes = [];
  beforeSet = async (values) => {
    if (!Object.hasOwn(values, 'mustela_paused')) return;
    writes.push(values.mustela_paused);
    if (writes.length === 1) { started.resolve(); await release.promise; }
  };
  let confirmed = false;
  const off = pause(true).then((response) => { confirmed = true; return response; });
  const on = pause(false);
  await started.promise;
  assert.equal(confirmed, false);
  assert.deepEqual(writes, [true]);
  assert.equal((await send('GET_PAUSE_STATE')).data.paused, false);
  release.resolve();
  assert.equal((await off).data.paused, true);
  assert.equal((await on).data.paused, false);
  assert.deepEqual(writes, [true, false]);
  assert.equal(store.mustela_paused, false);
});

test('pause before MISP settings resolve blocks its write; storage reads fail closed and can retry', async (t) => {
  await setup();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected fetch'); });
  beforeGet = async (key) => { if (key === 'mustela_settings') await pause(true); };
  blocked(await send('ADD_IOC_TO_MISP', { ioc: ip }));
  assert.equal(calls, 0);
  await setup();
  beforeGet = async (key) => { if (key === 'mustela_paused') throw new Error('Storage read unavailable'); };
  const response = await send('LOOKUP_IOC', ip);
  assert.equal(response.ok, false);
  assert.match(response.error, /storage read/i);
  assert.equal(calls, 0);
  beforeGet = async () => {};
  assert.equal((await pause(true)).ok, true);
  blocked(await send('LOOKUP_IOC', ip));
});

test('resume does not replay blocked work and respects prior provider settings', async (t) => {
  await setup({ paused: true });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected fetch'); });
  blocked(await send('LOOKUP_IOC', ip));
  await saveSettings({ providers: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.providers).map((id) => [id, { enabled: false }])), analystAssist: { enabled: false } });
  assert.equal((await pause(false)).ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.equal(store.mustela_history, undefined);
  const lookup = await send('LOOKUP_IOC', ip);
  assert.equal(lookup.ok, true);
  assert.equal(lookup.data.providerResults.length, 0);
  assert.equal(calls, 0);
  assert.equal((await send('OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc: ip })).ok, true);
  assert.equal(navigations.length, 1);
});
