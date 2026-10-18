import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/storage/storage.js';
import { detectSingleIoc } from '../src/shared/ioc.js';

async function testDefangedSelections(t) {
  const raw = 'HXXPS[:]//evil(.)com/a';
  const normalized = 'https://evil.com/a';
  const ioc = detectSingleIoc(raw);
  configure({ keys: false });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected fetch without keys'); });
  await menuListener({ menuItemId: 'investigate-selection', selectionText: raw }, { id: 7 });
  assert.equal(panels[0].message.payload.normalized, normalized);
  const keyless = await send('LOOKUP_IOC', ioc);
  assert.equal(keyless.ok, true);
  assert.equal(keyless.data.ioc.normalized, normalized);
  assert.equal(store.mustela_history[0].ioc.normalized, normalized);
  assert.deepEqual(navigations, []);
  for (const failure of ['HTTP', 'timeout']) {
    configure();
    store.mustela_settings.analystAssist.enabled = false;
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      calls.push(url);
      if (failure === 'timeout') throw new DOMException('Timed out', 'AbortError');
      return new Response('{}', { status: 503 });
    });
    const result = await send('LOOKUP_IOC', ioc);
    assert.equal(result.ok, true);
    assert.equal(result.data.ioc.normalized, normalized);
    assert.ok(result.data.providerResults.some((r) => !r.success && r.error));
    assert.ok(calls.length > 0);
    assert.ok(calls.every((url) => !url.includes('hxxp') && !url.includes('[.]') && !url.startsWith('https://evil.com')));
    assert.deepEqual(navigations, []);
  }
}

let store = {};
let listener;
let menuListener;
const navigations = [];
const panels = [];
globalThis.chrome = {
  runtime: { id: 'test-extension', onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  contextMenus: { onClicked: { addListener(fn) { menuListener = fn; } } },
  tabs: {
    onRemoved: { addListener() {} },
    onUpdated: { addListener() {} },
    async create(value) { navigations.push(value); },
    async sendMessage(tabId, message) { panels.push({ tabId, message }); }
  },
  storage: { local: {
    async remove(key) { delete store[key]; },
    async get(key) { return { [key]: structuredClone(store[key]) }; },
    async set(values) { Object.assign(store, structuredClone(values)); }
  } }
};
await import('../src/background/background.js');
test('defanged selections share normalized panels, history and partial provider failures', testDefangedSelections);
test('IPv6 selection and lookup keep canonical history and isolate provider failures', async (t) => {
  const raw = '2001:0DB8:0:0:0:0:0:1';
  const ioc = detectSingleIoc(raw);
  configure({ keys: false });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected keyless fetch'); });
  await menuListener({ menuItemId: 'investigate-selection', selectionText: raw }, { id: 7 });
  assert.equal(panels[0].message.payload.normalized, '2001:db8::1');
  const keyless = await send('LOOKUP_IOC', ioc);
  assert.equal(keyless.data.overallVerdict, 'unknown');
  assert.equal(store.mustela_history[0].ioc.normalized, '2001:db8::1');
  assert.deepEqual(navigations, []);
  for (const partial of [false, true]) {
    for (const failure of ['HTTP', 'timeout']) {
      configure();
      store.mustela_settings.analystAssist.enabled = false;
      t.mock.method(globalThis, 'fetch', async (url) => {
        if (partial && url.includes('virustotal')) return new Response(JSON.stringify({ data: { attributes: { last_analysis_stats: { malicious: 5 } } } }));
        if (failure === 'timeout') throw new DOMException('Timed out', 'AbortError');
        return new Response('{}', { status: 422 });
      });
      const result = await send('LOOKUP_IOC', { ...ioc, _rerun: 1 });
      assert.equal(result.ok, true);
      assert.equal(result.data.providerResults.filter((r) => r.success).length, partial ? 1 : 0);
      assert.ok(result.data.providerResults.some((r) => !r.success && r.error));
      assert.equal(result.data.overallVerdict, partial ? 'suspicious' : 'unknown');
      assert.deepEqual(navigations, []);
    }
  }
});

const send = (type, payload) => new Promise((resolve) => listener({ type, payload }, { id: 'test-extension', url: 'chrome-extension://test-extension/src/popup/popup.html' }, resolve));
const ip = (normalized) => ({ type: 'ip', normalized });
function configure({ keys = true, enabled = true, misp = false } = {}) {
  store = { mustela_settings: {
    ...structuredClone(DEFAULT_SETTINGS),
    providers: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.providers).map((id) => [id, {
      minIntervalMs: 0, // Policy coverage uses immediate sends; scheduling has clock-controlled tests.
      enabled: id === 'misp' ? misp : enabled, apiKey: keys ? 'test-key' : '', baseUrl: id === 'misp' ? 'https://misp.example' : '', defaultEventId: '42'
    }])),
    analystAssist: { enabled: true, baseUrl: 'http://localhost:1234/v1', apiKey: 'test-key', model: 'test-model' }
  } };
  navigations.length = 0;
  panels.length = 0;
}

test('emails stay local with configured providers and reject every external pivot', async (t) => {
  configure({ misp: true });
  store.mustela_settings.analystAssist.enabled = false;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); throw new Error('Unexpected provider fetch'); });
  const ioc = { type: 'email', normalized: 'First.Last@evil.test' };
  await menuListener({ menuItemId: 'investigate-selection', selectionText: 'First.Last@EVIL.TEST' }, { id: 7 });
  assert.equal(panels[0].message.payload.normalized, ioc.normalized);
  for (const extra of [{}, {}, { _rerun: 1 }]) {
    const result = await send('LOOKUP_IOC', { ...ioc, ...extra });
    assert.equal(result.ok, true);
    assert.equal(result.data.overallVerdict, 'unknown');
    assert.deepEqual(result.data.providerResults, []);
  }
  await send('SAVE_HISTORY_NOTE', { historyKey: 'email:First.Last@evil.test', analystNote: 'Keep local case' });
  await send('LOOKUP_IOC', { type: 'email', normalized: 'first.last@evil.test' });
  assert.equal(store.mustela_history.length, 2);
  assert.equal(store.mustela_history.find((e) => e.normalized === ioc.normalized).analystNote, 'Keep local case');
  assert.equal(Object.keys(store.mustela_cache).length, 2);
  for (const provider of ['virustotal', 'abuseipdb', 'shodan']) {
    assert.equal((await send('OPEN_EXTERNAL_PROVIDER', { provider, ioc })).ok, false);
    await menuListener({ menuItemId: `open-${provider}`, selectionText: ioc.normalized }, {});
  }
  assert.equal((await send('ADD_IOC_TO_MISP', { ioc })).ok, false);
  assert.deepEqual(navigations, []);
  assert.deepEqual(calls, []);
});

test('email summaries and explicit correlation keep existing optional LLM triggers and failures', async (t) => {
  const ioc = { type: 'email', normalized: 'Analyst+tag@evil.test', sourceContext: { pageUrl: 'https://case.test/report', pageTitle: 'Email investigation' } };
  for (const failure of [null, 'HTTP', 'timeout']) {
    configure({ misp: true });
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (failure === 'timeout') throw new DOMException('Timed out', 'AbortError');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Email brief"}' } }] }), { status: failure ? 503 : 200 });
    });
    const result = await send('LOOKUP_IOC', ioc);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.providerResults, []);
    assert.equal(result.data.overallVerdict, 'unknown');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith('http://localhost:1234/'));
    assert.match(JSON.stringify(calls[0].body), /Analyst\+tag@evil\.test/);
    assert.match(JSON.stringify(calls[0].body), /Email investigation/);
    assert.ok(failure ? result.data.llmSummary.error : result.data.llmSummary.summary);
    await send('LOOKUP_IOC', ioc);
    assert.equal(calls.length, 1, 'cache does not resend summary');
    store.mustela_history.push({ ioc: { type: 'email', normalized: 'other@evil.test' } });
    const correlation = await send('CORRELATE_IOCS', {});
    assert.equal(correlation.ok, !failure);
    assert.equal(calls.length, 2);
    assert.match(JSON.stringify(calls[1].body), /Analyst\+tag@evil\.test/);
    await send('PAGE_IOCS_DETECTED', [ioc]);
    assert.equal(calls.length, 2, 'detection never invokes LLM');
  }
});

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
