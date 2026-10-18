import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS } from '../src/storage/storage.js';

const id = 'test-extension';
const extension = { id, url: `chrome-extension://${id}/src/popup/popup.html` };
const content = { id, url: 'https://report.test/', tab: { id: 7, url: 'https://report.test/' } };
let listener;
let reads = 0;
const store = {};
const notifications = [];
const area = {
  async get(key) { reads++; return { [key]: structuredClone(store[key]) }; },
  async set(values) { Object.assign(store, structuredClone(values)); },
  async remove(key) { delete store[key]; }
};
globalThis.chrome = {
  runtime: { id, getURL: (path) => `chrome-extension://${id}/${path}`, onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  contextMenus: { onClicked: { addListener() {} } },
  tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} }, async query() { return [{ id: 7 }]; }, async sendMessage(tabId, message) { notifications.push(message); }, async create() {} },
  storage: { local: area, session: area }
};
await import('../src/background/background.js');
const send = (type, sender, payload) => new Promise((resolve) => listener({ type, payload }, sender, resolve));
const contentTypes = new Set(['GET_CONTENT_SETTINGS', 'PAGE_IOCS_DETECTED', 'GET_PAUSE_STATE', 'LOOKUP_IOC', 'OPEN_EXTERNAL_PROVIDER', 'GET_HISTORY_ENTRY', 'SAVE_HISTORY_NOTE', 'SAVE_HISTORY_TLP', 'IS_PAGE_DISABLED', 'GET_DETECTION_POLICY', 'ADD_IOC_TO_MISP']);
const types = [...(await readFile(new URL('../src/background/background.js', import.meta.url), 'utf8')).matchAll(/case '([A-Z_]+)'/g)].map((match) => match[1]);

test('every message type enforces its sender boundary before dispatch', async () => {
  assert.ok(types.includes('GET_CONTENT_SETTINGS'));
  for (const type of types) {
    for (const sender of [extension, { ...extension, url: `chrome-extension://${id}/src/welcome/welcome.html`, tab: { id: 8, url: `chrome-extension://${id}/src/welcome/welcome.html` } }, content, {}, { ...content, id: 'other-extension' }, { ...extension, url: 'https://report.test/' }, { ...extension, url: `chrome-extension://${id}.evil/page` }, { ...extension, tab: content.tab }, { ...content, url: 'about:blank' }]) {
      const trusted = sender === extension || sender.url?.endsWith('/src/welcome/welcome.html');
      const allowed = trusted || (sender === content && contentTypes.has(type));
      const before = structuredClone(store);
      const beforeReads = reads;
      const result = await send(type, sender);
      if (allowed) assert.notEqual(result.error, 'Unauthorized message', `${type}: expected dispatch`);
      else {
        assert.deepEqual(result, { ok: false, error: 'Unauthorized message' }, type);
        assert.deepEqual(store, before, type);
        assert.equal(reads, beforeReads, type);
      }
    }
  }
});

test('content settings and broadcasts contain only display preferences; web settings writes are refused', async () => {
  store.mustela_settings = structuredClone(DEFAULT_SETTINGS);
  for (const provider of Object.values(store.mustela_settings.providers)) {
    provider.apiKey = 'configured-fixture';
    provider.baseUrl = 'https://private-api.test';
  }
  store.mustela_settings.analystAssist = { apiKey: 'assist-fixture', baseUrl: 'https://private-llm.test', enabled: true };
  const expected = { highlightEnabled: store.mustela_settings.highlightEnabled, detectionMode: store.mustela_settings.detectionMode };
  assert.deepEqual(await send('GET_CONTENT_SETTINGS', content), { ok: true, data: expected });
  const before = structuredClone(store);
  assert.equal((await send('SAVE_SETTINGS', content, { highlightEnabled: false })).ok, false);
  assert.deepEqual(store, before);
  assert.equal((await send('GET_SETTINGS', content)).ok, false);
  notifications.length = 0;
  assert.equal((await send('SAVE_SETTINGS', extension, { highlightEnabled: false })).ok, true);
  assert.deepEqual(notifications, [{ type: 'SETTINGS_UPDATED', payload: { ...expected, highlightEnabled: false } }]);
  assert.equal((await send('GET_SETTINGS', extension)).data.providers.misp.apiKey, 'configured-fixture');
});

test('content bootstrap requests only its dedicated display settings', async () => {
  const source = await readFile(new URL('../src/content/content.js', import.meta.url), 'utf8');
  assert.match(source, /type: 'GET_CONTENT_SETTINGS'/);
  assert.doesNotMatch(source, /type: 'GET_SETTINGS'/);
});
