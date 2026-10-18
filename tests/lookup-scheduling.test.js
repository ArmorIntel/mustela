import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/storage/storage.js';

let listener;
let store;
let worker = 0;
const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/src/popup/popup.html' };
globalThis.chrome = {
  runtime: { id: sender.id, onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  contextMenus: { onClicked: { addListener() {} } },
  tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} }, async query() { return []; } },
  storage: { local: {
    async get(key) { return Object.fromEntries((Array.isArray(key) ? key : [key]).map((name) => [name, structuredClone(store[name])])); },
    async set(values) { Object.assign(store, structuredClone(values)); },
    async remove(key) { delete store[key]; }
  } }
};
const send = (type, payload, origin = sender) => new Promise((resolve) => listener({ type, payload }, origin, resolve));
const ip = (value = '8.8.8.8') => ({ type: 'ip', normalized: value });
const lookup = (ioc = ip()) => send('LOOKUP_IOC', ioc);
const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
const response = () => new Response(JSON.stringify({ data: { attributes: {}, abuseConfidenceScore: 0 } }));
async function setup(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  store = { mustela_settings: structuredClone(DEFAULT_SETTINGS) };
  for (const [id, config] of Object.entries(store.mustela_settings.providers)) {
    config.enabled = id === 'virustotal';
    config.apiKey = 'test-key';
  }
  store.mustela_settings.analystAssist.enabled = false;
  await import(`../src/background/background.js?scheduling=${++worker}`);
}

test('three duplicate requests share one network lookup and subsequent requests use cache', async (t) => {
  await setup(t);
  let release;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; return new Promise((resolve) => { release = resolve; }); });
  const first = lookup();
  await flush();
  const copies = [lookup(), lookup(), lookup()];
  await flush();
  assert.equal(calls, 1);
  release(response());
  const results = await Promise.all([first, ...copies]);
  assert.ok(results.every((result) => result.ok && result.data.providerResults[0].success));
  assert.deepEqual(results.map((result) => result.data.providerResults), Array(4).fill(results[0].data.providerResults));
  assert.equal((await lookup()).data.cached, true);
  assert.equal(calls, 1);
});

test('explicit re-runs wait for existing work then each starts a fresh spaced lookup', async (t) => {
  await setup(t);
  const releases = [];
  t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => { releases.push(resolve); }));
  const first = lookup();
  await flush();
  const reruns = [lookup({ ...ip(), _rerun: true }), lookup({ ...ip(), _rerun: true })];
  await flush();
  assert.equal(releases.length, 1);
  releases[0](response());
  assert.equal((await first).ok, true);
  await flush();
  assert.equal(releases.length, 1);
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(releases.length, 2);
  releases[1](response());
  assert.equal((await reruns[0]).ok, true);
  await flush();
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(releases.length, 3);
  releases[2](response());
  assert.equal((await reruns[1]).ok, true);
});

test('Retry-After blocks only the throttled provider, reports remaining seconds and does not cache the refusal', async (t) => {
  await setup(t);
  store.mustela_settings.providers.abuseipdb.enabled = true;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    return url.includes('virustotal')
      ? new Response('', { status: 429, headers: { 'Retry-After': '60' } }) : response();
  });
  const first = await lookup();
  assert.equal(first.ok, true);
  assert.match(first.data.providerResults.find((r) => r.provider === 'VirusTotal').error, /quota reached.*60 s/i);
  t.mock.timers.tick(1000);
  for (const ioc of [ip('1.1.1.1'), ip()]) {
    const result = await lookup(ioc);
    assert.equal(result.ok, true);
    assert.match(result.data.providerResults.find((r) => r.provider === 'VirusTotal').error, /59 s/);
    assert.equal(result.data.providerResults.find((r) => r.provider === 'AbuseIPDB').success, true);
  }
  assert.equal(calls.filter((url) => url.includes('virustotal')).length, 1);
  assert.equal(calls.filter((url) => url.includes('abuseipdb')).length, 3);
  t.mock.timers.tick(59000);
  await lookup();
  assert.equal(calls.filter((url) => url.includes('virustotal')).length, 2);
});

test('pause empties interval waits and queued re-runs across resume', async (t) => {
  await setup(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(); });
  await lookup();
  const waiting = lookup(ip('1.1.1.1'));
  const rerun = lookup({ ...ip('1.1.1.1'), _rerun: true });
  await flush();
  assert.equal(calls, 1);
  await send('SET_PAUSE_STATE', { paused: true });
  await send('SET_PAUSE_STATE', { paused: false });
  assert.equal((await waiting).code, 'MUSTELA_PAUSED');
  assert.equal((await rerun).code, 'MUSTELA_PAUSED');
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, 1);
  assert.equal((await lookup(ip('1.1.1.1'))).ok, true);
  assert.equal(calls, 2);
});

test('an old settings read cannot register shared work after pause and resume', async (t) => {
  await setup(t);
  const originalGet = chrome.storage.local.get;
  let release;
  t.mock.method(chrome.storage.local, 'get', async (key) => {
    if (key === 'mustela_settings' && !release) await new Promise((resolve) => { release = resolve; });
    return originalGet(key);
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(); });
  const old = lookup();
  await flush();
  assert.equal(typeof release, 'function');
  await send('SET_PAUSE_STATE', { paused: true });
  await send('SET_PAUSE_STATE', { paused: false });
  release();
  const fresh = lookup();
  assert.equal((await old).code, 'MUSTELA_PAUSED');
  assert.equal((await fresh).ok, true);
  assert.equal(calls, 1);
});

test('a duplicate caller still enforces its own excluded page policy', async (t) => {
  await setup(t);
  let release;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; return new Promise((resolve) => { release = resolve; }); });
  const first = lookup();
  await flush();
  await send('SET_PAGE_DISABLED', { url: 'https://blocked.example/', disabled: true });
  const blocked = await send('LOOKUP_IOC', ip(), {
    id: sender.id, url: 'https://blocked.example/', tab: { id: 42, url: 'https://blocked.example/' }
  });
  assert.equal(blocked.ok, false);
  assert.equal(calls, 1);
  release(response());
  assert.equal((await first).ok, true);
});
