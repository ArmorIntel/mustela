import { test, expect } from '@playwright/test';
import { launchExtensionContext, startFixtureServer, openFixturePage, getServiceWorker, iocHighlights } from './support/extensionHarness.js';

const lifecycle = (page) => page.evaluate(() => JSON.parse(document.documentElement.dataset.testLifecycle || '{}'));
const marker = (page) => page.evaluate(() => document.documentElement.dataset.mustelaInjected);

async function withExtension(run) {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext({ captureContentLifecycle: true });
  try { await run(extension, server); }
  finally { await extension.close(); await server.close(); }
}

test('ten navigations detect IOC without any programmatic script execution', async () => {
  await withExtension(async (extension, server) => {
    const worker = await getServiceWorker(extension.context);
    await worker.evaluate(() => { scriptCalls.length = 0; });
    const page = await extension.context.newPage();
    for (let i = 0; i < 10; i++) {
      await page.goto(server.urlFor(`/iocs.html?navigation=${i}`));
      await expect.poll(() => iocHighlights(page).count()).toBeGreaterThan(0);
      expect(Object.values(await lifecycle(page))).toEqual([
        expect.objectContaining({ observers: 1, scans: 1, disposed: 0 })
      ]);
    }
    expect(await worker.evaluate(() => scriptCalls.length)).toBe(0);
  });
});

test('ordinary insecure HTTP pages can initialize their instance marker and detect IOC', async () => {
  await withExtension(async (extension) => {
    const page = await extension.context.newPage();
    await page.route('http://report.example.test/**', (route) => route.fulfill({
      contentType: 'text/html', body: '<html><body><p>8.8.8.8</p></body></html>'
    }));
    await page.goto('http://report.example.test/report');
    expect(await page.evaluate(() => isSecureContext)).toBe(false);
    await expect.poll(() => iocHighlights(page).count()).toBe(1);
    expect(await marker(page)).toMatch(/^[0-9a-f]{32}$/);
  });
});

test('duplicate injection keeps one observer and scans a later mutation once', async () => {
  await withExtension(async (extension, server) => {
    const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    await expect.poll(() => iocHighlights(page).count()).toBeGreaterThan(0);
    const id = await marker(page);
    const worker = await getServiceWorker(extension.context);
    await worker.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      const options = { target: { tabId: tab.id }, files: ['src/shared/ioc.content-runtime.js', 'src/content/content.js'] };
      await chrome.scripting.executeScript(options);
      await chrome.scripting.executeScript(options);
    }, page.url());
    expect(await marker(page)).toBe(id);
    await page.evaluate(() => { const p = document.createElement('p'); p.textContent = '4.4.4.4'; document.body.append(p); });
    await expect.poll(() => iocHighlights(page, 'body', '4.4.4.4').count()).toBe(1);
    expect(await lifecycle(page)).toEqual({ [id]: expect.objectContaining({ observers: 1, scans: 2, disposed: 0 }) });
  });
});

test('extension reload replaces the open-tab instance and the old observer stays disconnected', async () => {
  await withExtension(async (extension, server) => {
    const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    await expect.poll(() => iocHighlights(page).count()).toBeGreaterThan(0);
    const oldId = await marker(page);
    const manager = await extension.context.newPage();
    await manager.goto('chrome://extensions/');
    await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    await manager.evaluate((id) => new Promise((resolve, reject) => {
      chrome.developerPrivate.reload(id, { failQuietly: false }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    }), extension.extensionId);

    const replacement = await getServiceWorker(extension.context);
    await expect.poll(() => marker(page)).not.toBe(oldId);
    await expect.poll(() => iocHighlights(page).count()).toBeGreaterThan(0);
    const newId = await marker(page);
    const before = await lifecycle(page);
    expect(before[oldId].disposed).toBe(1);
    expect(before[newId]).toEqual(expect.objectContaining({ observers: 1, scans: 1, disposed: 0 }));
    expect(await replacement.evaluate(() => scriptCalls.filter((call) => call.files).length)).toBe(1);
    await page.evaluate(() => { const p = document.createElement('p'); p.textContent = '4.4.4.4'; document.body.append(p); });
    await expect.poll(() => iocHighlights(page, 'body', '4.4.4.4').count()).toBe(1);
    const after = await lifecycle(page);
    expect(after[oldId]).toEqual(before[oldId]);
    expect(after[newId].scans).toBe(2);
    await expect(page.locator('.mustela-page-indicator')).toHaveCount(1);
  });
});
