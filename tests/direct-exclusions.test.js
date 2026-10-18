import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/storage/storage.js';

let store = {};
let listener;
let menu;
let activeUrl = '';
let liveUrl = '';
const calls = [];
const navigations = [];
const panels = [];
const extensionSender = { id: 'test-extension', url: 'chrome-extension://test-extension/src/popup/popup.html' };
const contentSender = { id: 'test-extension', url: 'https://frame.test/report', tab: { id: 7, url: 'https://original.test/report' } };
globalThis.chrome = {
  runtime: { id: 'test-extension', onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  contextMenus: { onClicked: { addListener(fn) { menu = fn; } } },
  tabs: {
    onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    async query() { return [{ id: 7, url: activeUrl }]; },
    async get() { return { id: 7, url: liveUrl }; },
    async create(details) { navigations.push(details); },
    async sendMessage(id, message) { panels.push(message); }
  },
  storage: { local: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(store[key])])); },
    async set(values) { Object.assign(store, structuredClone(values)); },
    async remove(key) { delete store[key]; }
  } }
};
await import('../src/background/background.js');
const send = (type, payload, sender = extensionSender) => new Promise((resolve) => listener({ type, payload }, sender, resolve));
const ioc = { type: 'ip', normalized: '8.8.8.8' };
const iocRule = { kind: 'ioc', iocType: 'ip', value: '8.8.8.8' };
const pageRule = (value) => ({ kind: 'page-url', value });
function rules(value) { store.mustela_exclusions = { version: 1, rules: value }; }
function reset() {
  store = { mustela_settings: structuredClone(DEFAULT_SETTINGS) };
  for (const [id, provider] of Object.entries(store.mustela_settings.providers)) {
    Object.assign(provider, { enabled: true, apiKey: 'test-key', ...(id === 'misp' ? { baseUrl: 'https://misp.example', defaultEventId: '42' } : {}) });
  }
  store.mustela_settings.analystAssist = { enabled: true, baseUrl: 'https://assistant.test/v1', apiKey: 'test-key', model: 'test-model' };
  activeUrl = liveUrl = '';
  calls.length = navigations.length = panels.length = 0;
  rules([]);
}
function blocked(response) {
  assert.equal(response.ok, false);
  assert.equal(response.code, 'MUSTELA_EXCLUDED');
  assert.match(response.error, /excluded/i);
}
function instrument(t, hook = () => {}) {
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    await hook();
    if (String(url).includes('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"brief"}' } }] }));
    if (String(url).includes('/attributes/add/')) return new Response(JSON.stringify({ Attribute: { id: '7', event_id: '42' } }));
    return new Response('{}', { status: 503 });
  });
}

test('current IOC or any source page exclusion blocks all direct messages before cache, providers, MISP and LLM', async (t) => {
  instrument(t);
  for (const scenario of ['ioc', 'source', 'sender', 'frame', 'live', 'popup', 'host', 'legacy']) {
    reset();
    const target = { ...ioc, sourceContext: { pageUrl: 'https://source.test/report' } };
    // Populate a real cached investigation before adding a rule.
    assert.equal((await send('LOOKUP_IOC', target)).ok, true);
    calls.length = 0;
    let sender = extensionSender;
    if (scenario === 'ioc') rules([iocRule]);
    if (scenario === 'host') rules([{ kind: 'host', value: 'source.test' }]);
    if (scenario === 'source') rules([pageRule(target.sourceContext.pageUrl)]);
    if (['sender', 'frame', 'live'].includes(scenario)) {
      sender = contentSender;
      liveUrl = 'https://live.test/report';
      rules([pageRule(scenario === 'sender' ? sender.tab.url : scenario === 'frame' ? sender.url : liveUrl)]);
    }
    if (scenario === 'popup') { activeUrl = 'https://active.test/report'; rules([pageRule(activeUrl)]); }
    if (scenario === 'legacy') store.mustela_disabled_pages = [target.sourceContext.pageUrl];
    for (const rerun of [false, true, false]) blocked(await send('LOOKUP_IOC', { ...target, ...(rerun ? { _rerun: 1 } : {}) }, sender));
    for (const provider of ['virustotal', 'abuseipdb', 'shodan']) blocked(await send('OPEN_EXTERNAL_PROVIDER', { provider, ioc: target }, sender));
    blocked(await send('ADD_IOC_TO_MISP', { ioc: target }, sender));
    assert.deepEqual(calls, [], scenario);
    assert.deepEqual(navigations, [], scenario);
  }
});

test('keyless pivots and every context menu refuse excluded selections and pages with a reason', async (t) => {
  instrument(t);
  for (const byPage of [false, true]) {
    reset();
    for (const provider of Object.values(store.mustela_settings.providers)) provider.apiKey = '';
    rules(byPage ? [pageRule('https://excluded.test/')] : [iocRule]);
    blocked(await send('OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc: { ...ioc, sourceContext: { pageUrl: 'https://excluded.test/' } } }));
    for (const menuItemId of ['investigate-selection', 'open-virustotal', 'open-abuseipdb', 'open-shodan']) {
      blocked(await menu({ menuItemId, selectionText: ioc.normalized, pageUrl: 'https://excluded.test/' }, { id: 7, url: 'https://allowed.test/' }));
    }
    assert.equal(panels.length, 4);
    assert.ok(panels.every((message) => message.type === 'MUSTELA_ACTION_BLOCKED' && message.code === 'MUSTELA_EXCLUDED'));
    assert.deepEqual(calls, []);
    assert.deepEqual(navigations, []);
  }
});

test('a newly excluded pending lookup stops before the next provider and LLM; removal sends nothing automatically', async (t) => {
  reset();
  instrument(t, () => rules([iocRule]));
  blocked(await send('LOOKUP_IOC', ioc));
  assert.equal(calls.length, 1);
  assert.equal(calls.some((url) => url.includes('assistant.test')), false);
  rules([]);
  assert.equal(calls.length, 1);
  instrument(t);
  assert.equal((await send('LOOKUP_IOC', { ...ioc, _rerun: 1 })).ok, true);
  assert.equal(calls.length, 6);
  assert.equal((await send('ADD_IOC_TO_MISP', { ioc })).ok, true);
  assert.equal((await send('OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc })).ok, true);
  assert.equal(navigations.length, 1);
});

test('unreadable rules fail closed, without treating malformed storage as no exclusions', async (t) => {
  reset();
  instrument(t);
  store.mustela_exclusions.version = 99;
  assert.equal((await send('LOOKUP_IOC', ioc)).ok, false);
  assert.equal((await send('OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc })).ok, false);
  assert.equal((await send('ADD_IOC_TO_MISP', { ioc })).ok, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(navigations, []);
});

test('popup pivots check the selected tab after navigation, even when another tab is active', async (t) => {
  reset();
  instrument(t);
  activeUrl = 'https://allowed.test/';
  liveUrl = 'https://excluded.test/';
  rules([pageRule(liveUrl)]);
  blocked(await send('OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc, sourceTabId: 7 }));
  assert.deepEqual(navigations, []);
  rules([]);
  t.mock.method(chrome.tabs, 'get', async () => { throw new Error('Tab no longer available'); });
  const response = await send('OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc, sourceTabId: 7 });
  assert.equal(response.code, 'MUSTELA_EXCLUSION_UNAVAILABLE');
  assert.deepEqual(navigations, []);
});

test('context selection retains the originating frame for a later lookup from the top-level panel', async (t) => {
  reset();
  instrument(t);
  const frameUrl = 'https://selected-frame.test/report';
  await menu({ menuItemId: 'investigate-selection', selectionText: ioc.normalized, frameUrl }, { id: 7, url: 'https://allowed.test/' });
  const selection = panels[0].payload;
  rules([pageRule(frameUrl)]);
  blocked(await send('LOOKUP_IOC', selection, contentSender));
  assert.deepEqual(calls, []);
});
