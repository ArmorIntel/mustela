import test from 'node:test';
import assert from 'node:assert/strict';

let installed;
let updated;
const scripts = [];
const styles = [];
const tabs = [{ id: 0, url: 'http://report.test/' }, { id: 7, url: 'https://report.test/' },
  { id: 8, url: 'chrome://extensions/' }, { id: 9, url: 'https://restricted.test/' }, { url: 'https://missing.test/' }];
globalThis.chrome = {
  storage: { local: { async remove() {} }, session: { async remove() {} } },
  runtime: { onInstalled: { addListener(fn) { installed = fn; } }, onMessage: { addListener() {} }, getURL: (p) => p },
  tabs: { onUpdated: { addListener(fn) { updated = fn; } }, onRemoved: { addListener() {} },
    async query() { return tabs; }, async create() {} },
  contextMenus: { onClicked: { addListener() {} }, removeAll() {} },
  scripting: {
    async insertCSS(options) { styles.push(options); if (options.target.tabId === 9) throw new Error('Restricted'); },
    async executeScript(options) { scripts.push(options); return [{ result: false }]; }
  }
};
await import('../src/background/background.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const reason of ['install', 'update']) {
  test(`${reason} injects existing HTTP tabs once without a probe and isolates restricted failures`, async () => {
    scripts.length = styles.length = 0;
    await installed({ reason });
    await tick();
    assert.deepEqual(scripts, [0, 7].map((tabId) => ({ target: { tabId },
      files: ['src/shared/ioc.content-runtime.js', 'src/content/content.js'] })));
    assert.deepEqual(styles.map((entry) => entry.target.tabId), [0, 7, 9]);
  });
}

test('ordinary navigation never probes or injects scripts', async () => {
  scripts.length = styles.length = 0;
  for (let i = 0; i < 10; i++) {
    await updated(7, { status: 'loading' }, tabs[1]);
    await updated(7, { status: 'complete' }, tabs[1]);
  }
  await tick();
  assert.deepEqual(scripts, []);
  assert.deepEqual(styles, []);
});

test('browser-only updates do not inject content scripts', async () => {
  scripts.length = styles.length = 0;
  await installed({ reason: 'chrome_update' });
  await tick();
  assert.deepEqual(scripts, []);
});
