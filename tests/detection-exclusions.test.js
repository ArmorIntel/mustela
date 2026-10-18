import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let data = {};
const notifications = [];
const local = {
  async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(data[key])])); },
  async set(values) { Object.assign(data, structuredClone(values)); },
  async remove(key) { delete data[key]; }
};
globalThis.chrome = {
  runtime: { id: 'test', onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } }, async sendMessage(message) { notifications.push(message); } },
  contextMenus: { onClicked: { addListener() {} } },
  tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} }, async query() { return [{ id: 7, url: 'https://page.test/' }]; }, async sendMessage(id, message) { notifications.push(message); } },
  storage: { local, session: local }
};
await import('../src/background/background.js');
const privileged = { id: 'test', url: 'chrome-extension://test/src/welcome/welcome.html' };
const content = { id: 'test', url: 'https://page.test/', tab: { id: 7, url: 'https://page.test/' } };
const send = (type, payload, sender = privileged) => new Promise((resolve) => listener({ type, payload }, sender, resolve));
const ip = { type: 'ip', normalized: '8.8.8.8', sourceContext: { pageUrl: content.url } };

test('keyless exclusion editor round trips configured rules and rejects invalid replacement atomically', async () => {
  data = {}; notifications.length = 0;
  const rules = [{ kind: 'ioc', iocType: 'ip', value: '8.8.8.8' }];
  assert.equal((await send('SAVE_EXCLUSIONS', rules)).ok, true);
  assert.deepEqual((await send('GET_EXCLUSIONS')).data.rules, rules);
  assert.equal((await send('SAVE_EXCLUSIONS', [{ kind: 'host', value: '/.*/' }])).ok, false);
  assert.deepEqual((await send('GET_EXCLUSIONS')).data.rules, rules);
  assert.equal((await send('SAVE_EXCLUSIONS', [], content)).error, 'Unauthorized message');
  assert.equal((await send('GET_EXCLUSIONS', undefined, content)).error, 'Unauthorized message');
  assert.ok(notifications.some((message) => message.type === 'EXCLUSIONS_UPDATED'));
});

test('page decisions identify the matched rule; stale publication and reads are filtered', async () => {
  data = {};
  await send('PAGE_IOCS_DETECTED', [ip], content);
  const rules = [{ kind: 'page-url', value: content.url }];
  await send('SAVE_EXCLUSIONS', rules);
  const state = await send('GET_DETECTION_POLICY', { url: content.url }, content);
  assert.equal(state.data.excluded, true);
  assert.deepEqual(state.data.rule, rules[0]);
  assert.match(state.data.reason, /https:\/\/page.test\//);
  assert.match(state.data.reason, /settings/i);
  await send('PAGE_IOCS_DETECTED', [ip], content);
  assert.deepEqual((await send('GET_DETECTED_IOCS', { tabId: 7 })).data, []);
  await send('SAVE_EXCLUSIONS', [{ kind: 'ioc', iocType: 'ip', value: ip.normalized }]);
  await send('PAGE_IOCS_DETECTED', [ip, { ...ip, normalized: '1.1.1.1' }], content);
  assert.deepEqual((await send('GET_DETECTED_IOCS', { tabId: 7 })).data.map((ioc) => ioc.normalized), ['1.1.1.1']);
  await send('SAVE_EXCLUSIONS', []);
  assert.deepEqual((await send('GET_DETECTED_IOCS', { tabId: 7 })).data, [], 'removal must not republish stale detections');
});
