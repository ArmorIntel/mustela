import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/storage/storage.js';

let store = {};
let listener;
let activeUrl = '';
let liveUrl = '';
let beforeHistory;
const calls = [];
const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/src/popup/popup.html' };
globalThis.chrome = {
  runtime: { id: 'test-extension', onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  contextMenus: { onClicked: { addListener() {} } },
  tabs: {
    onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    async query() { return [{ id: 7, url: activeUrl }]; },
    async get() { return { id: 7, url: liveUrl }; }
  },
  storage: { local: {
    async get(keys) {
      if (keys === 'mustela_history') await beforeHistory?.();
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(store[key])]));
    },
    async set(values) { Object.assign(store, structuredClone(values)); },
    async remove(key) { delete store[key]; }
  } }
};
await import('../src/background/background.js');
const send = (payload = {}) => new Promise((resolve) => listener({ type: 'CORRELATE_IOCS', payload }, sender, resolve));
const pageRule = (value) => ({ kind: 'page-url', value });
const entry = (value, extra = {}) => ({
  ioc: { type: 'domain', normalized: value }, overallVerdict: 'clean',
  pageUrl: `https://${value}/report`, pageTitle: `Title ${value}`,
  summaryText: `Summary ${value}`, lastSeen: '2026-01-01T00:00:00Z', ...extra
});
function rules(values) { store.mustela_exclusions = { version: 1, rules: values }; }
function reset(t, history) {
  store = { mustela_settings: structuredClone(DEFAULT_SETTINGS), mustela_history: history };
  store.mustela_settings.analystAssist = { enabled: true, baseUrl: 'https://assistant.test/v1', apiKey: 'test-key', model: 'test-model' };
  activeUrl = liveUrl = 'https://allowed.test/';
  beforeHistory = undefined;
  calls.length = 0;
  rules([]);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: options.body });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"patterns":[],"action":"Review"}' } }] }));
  });
}

test('current exclusions remove entire legacy entries before ranking and the ten-entry limit without deleting history', async (t) => {
  const blocked = Array.from({ length: 11 }, (_, i) => entry(`secret${i}.test`, { overallVerdict: 'malicious' }));
  const allowed = Array.from({ length: 12 }, (_, i) => entry(`allowed${i}.test`, { lastSeen: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }));
  reset(t, [...blocked, ...allowed]);
  rules(blocked.map((e, i) => i % 2 ? pageRule(e.pageUrl) : { kind: 'ioc', iocType: 'domain', value: e.ioc.normalized }));
  const original = structuredClone(store.mustela_history);
  const result = await send({ pageUrl: activeUrl, pageTitle: 'Allowed context' });
  assert.equal(result.ok, true);
  assert.equal(result.data.iocCount, 10);
  assert.equal(calls.length, 1);
  for (const e of blocked) {
    for (const value of [e.ioc.normalized, e.pageUrl, e.pageTitle, e.summaryText]) assert.ok(!calls[0].body.includes(value), value);
  }
  assert.ok(calls[0].body.includes('allowed11.test'));
  assert.ok(!calls[0].body.includes('allowed0.test'));
  assert.ok(!calls[0].body.includes('allowed1.test'));
  assert.deepEqual(store.mustela_history, original);
});

test('zero or one allowed entries refuse explicitly; two allowed entries alone reach the endpoint', async (t) => {
  for (const count of [0, 1, 2]) {
    reset(t, [entry('secret.test'), ...Array.from({ length: count }, (_, i) => entry(`allowed${i}.test`))]);
    rules([{ kind: 'host', value: 'secret.test' }]);
    const result = await send();
    assert.equal(result.ok, count === 2);
    assert.equal(calls.length, count === 2 ? 1 : 0);
    if (count < 2) assert.match(result.error, /exclusion rules.*at least two/i);
  }
});

test('both stored page representations and legacy pauses exclude whole entries', async (t) => {
  for (const source of ['pageUrl', 'sourceContext', 'legacy']) {
    const secret = entry('secret.test');
    secret.ioc.sourceContext = { pageUrl: 'https://nested.test/report' };
    reset(t, [secret, entry('allowed.test')]);
    if (source === 'legacy') store.mustela_disabled_pages = [secret.pageUrl];
    else rules([pageRule(source === 'pageUrl' ? secret.pageUrl : secret.ioc.sourceContext.pageUrl)]);
    assert.equal((await send()).ok, false, source);
    assert.equal(calls.length, 0);
  }
});

test('current page checks use fresh rules, supplied context, active tab and navigated tab', async (t) => {
  for (const source of ['payload', 'active', 'live', 'late']) {
    reset(t, [entry('first.test'), entry('second.test')]);
    const pageUrl = 'https://displayed.test/report';
    const excluded = source === 'payload' || source === 'late' ? pageUrl : source === 'active' ? activeUrl : 'https://navigated.test/';
    if (source === 'live') liveUrl = excluded;
    if (source === 'late') beforeHistory = () => rules([pageRule(excluded)]);
    else rules([pageRule(excluded)]);
    const result = await send({ pageUrl, pageTitle: 'Private title' });
    assert.equal(result.ok, false, source);
    assert.equal(result.code, 'MUSTELA_EXCLUDED', source);
    assert.match(result.error, /source page.*excluded/i);
    assert.equal(calls.length, 0);
  }
});

test('unreadable exclusions fail closed and missing LLM configuration never sends', async (t) => {
  reset(t, [entry('first.test'), entry('second.test')]);
  store.mustela_exclusions = { version: 999, rules: [] };
  assert.equal((await send()).ok, false);
  assert.equal(calls.length, 0);
  for (const key of ['enabled', 'baseUrl', 'apiKey', 'model']) {
    reset(t, [entry('first.test'), entry('second.test')]);
    store.mustela_settings.analystAssist[key] = '';
    assert.match((await send()).error, /not configured or disabled/i);
    assert.equal(calls.length, 0);
  }
});
