import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/storage/storage.js';

let store = {};
let listener;
let menuListener;
const navigations = [];
const panels = [];
globalThis.chrome = {
  runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  contextMenus: { onClicked: { addListener(fn) { menuListener = fn; } } },
  tabs: {
    onUpdated: { addListener() {} },
    async create(value) { navigations.push(value); },
    async sendMessage(tabId, message) { panels.push({ tabId, message }); }
  },
  storage: { local: {
    async get(key) { return { [key]: structuredClone(store[key]) }; },
    async set(values) { Object.assign(store, structuredClone(values)); }
  } }
};
await import('../src/background/background.js');
const send = (type, payload) => new Promise((resolve) => listener({ type, payload }, {}, resolve));
const ip = (normalized) => ({ type: 'ip', normalized });
function configure({ keys = true, enabled = true, misp = false } = {}) {
  store = { mustela_settings: {
    ...structuredClone(DEFAULT_SETTINGS),
    providers: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.providers).map((id) => [id, {
      enabled: id === 'misp' ? misp : enabled, apiKey: keys ? 'test-key' : '', baseUrl: id === 'misp' ? 'https://misp.example' : '', defaultEventId: '42'
    }])),
    analystAssist: { enabled: true, baseUrl: 'http://localhost:1234/v1', apiKey: 'test-key', model: 'test-model' }
  } };
  navigations.length = 0;
  panels.length = 0;
}

test('protected lookups ignore old cache and LLM data for configured, keyless and disabled providers', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); throw new Error('Unexpected fetch'); });
  for (const options of [{}, { keys: false }, { enabled: false }]) {
    configure(options);
    const first = await send('LOOKUP_IOC', ip('10.0.0.1'));
    assert.equal(first.ok, true);
    assert.equal(first.data.overallVerdict, 'unknown');
    assert.match(first.data.explanation, /Public lookups blocked for internal\/reserved IPv4/);
    const cache = store.mustela_cache;
    for (const entry of Object.values(cache)) {
      entry.value = { ...first.data, llmSummary: { summary: 'stale secret brief' }, providerResults: [{ provider: 'VirusTotal', success: true, externalUrl: 'https://www.virustotal.com/gui/search/10.0.0.1' }] };
    }
    for (const extra of [{}, { _rerun: 1 }]) {
      const response = await send('LOOKUP_IOC', { ...ip('10.0.0.1'), ...extra });
      assert.equal(response.ok, true);
      assert.equal(response.data.cached, false);
      assert.equal(response.data.llmSummary, undefined);
      assert.equal(response.data.providerResults.some((r) => r.externalUrl), false);
      assert.match(response.data.explanation, /Public lookups blocked/);
    }
    for (const provider of ['virustotal', 'abuseipdb', 'shodan']) {
      const response = await send('OPEN_EXTERNAL_PROVIDER', { provider, ioc: ip('10.0.0.1') });
      assert.equal(response.ok, false);
      assert.match(response.error, /Public lookups blocked/);
      await menuListener({ menuItemId: `open-${provider}`, selectionText: '10.0.0.1' }, { id: 1 });
    }
    assert.deepEqual(navigations, []);
    assert.equal(panels.length, 3);
    assert.ok(panels.every(({ message }) => message.type === 'OPEN_INVESTIGATION_PANEL' && message.payload.normalized === '10.0.0.1'));
  }
  assert.equal(calls.length, 0);
});

test('configured MISP lookup and explicit add remain allowed, including error paths without LLM fallback', async (t) => {
  configure({ misp: true });
  const calls = [];
  let fail = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.includes('/attributes/add/') ? { Attribute: { id: '7', event_id: '42' } } : { response: { Attribute: [] } }), { status: fail ? 503 : 200 });
  });
  const lookup = await send('LOOKUP_IOC', ip('192.168.1.1'));
  assert.equal(lookup.ok, true);
  assert.equal(lookup.data.providerResults.find((r) => r.provider === 'MISP').success, true);
  assert.equal(calls.length, 1);
  const add = await send('ADD_IOC_TO_MISP', { ioc: ip('192.168.1.1') });
  assert.equal(add.ok, true);
  assert.equal(calls.length, 2);
  fail = true;
  const failed = await send('LOOKUP_IOC', ip('192.168.1.2'));
  assert.equal(failed.ok, true);
  assert.equal(failed.data.llmSummary, undefined);
  assert.equal(failed.data.providerResults.find((r) => r.provider === 'MISP').success, false);
  assert.ok(calls.every((c) => c.url.startsWith('https://misp.example/')));
});

test('correlation filters legacy protected entries before priority, limit and the minimum of two', async (t) => {
  configure();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"public only"}' } }] }));
  });
  const protectedEntries = Array.from({ length: 12 }, (_, n) => ({ ioc: ip(`10.0.0.${n + 1}`), overallVerdict: 'malicious', summaryText: 'protected-marker' }));
  for (const count of [0, 1, 2]) {
    store.mustela_history = [...protectedEntries, ...['8.8.8.8', '1.1.1.1'].slice(0, count).map((value) => ({ ioc: ip(value), overallVerdict: 'unknown' }))];
    const response = await send('CORRELATE_IOCS', {});
    assert.equal(response.ok, count === 2);
    if (count < 2) assert.match(response.error, /internal\/reserved IPv4.*excluded/i);
  }
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(calls).includes('protected-marker'));
  assert.ok(!JSON.stringify(calls).includes('10.0.0.'));
  assert.match(JSON.stringify(calls), /8\.8\.8\.8/);
  assert.match(JSON.stringify(calls), /1\.1\.1\.1/);
});

test('public provider failure still reaches Analyst Assist and public pivots still navigate', async (t) => {
  configure();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    if (url.startsWith('http://localhost:1234')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"public brief"}' } }] }));
    throw new Error('Provider timed out');
  });
  const response = await send('LOOKUP_IOC', ip('8.8.8.8'));
  assert.equal(response.ok, true);
  assert.equal(response.data.llmSummary.summary, 'public brief');
  assert.equal(calls.length, 4);
  for (const provider of ['virustotal', 'abuseipdb', 'shodan']) {
    assert.equal((await send('OPEN_EXTERNAL_PROVIDER', { provider, ioc: ip('8.8.8.8') })).ok, true);
    await menuListener({ menuItemId: `open-${provider}`, selectionText: '8.8.8.8' }, {});
  }
  assert.equal(navigations.length, 6);
});
