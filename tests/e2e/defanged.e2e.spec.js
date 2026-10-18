import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, bindPopupToTab, getServiceWorker, iocHighlights } from './support/extensionHarness.js';

test('defanged scan preserves text, stays local and shares canonical investigation/history values', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  const { context, extensionId } = extension;
  try {
    const worker = await getServiceWorker(context);
    await worker.evaluate(() => {
      globalThis.scanRequests = [];
      globalThis.originalFetch = globalThis.fetch;
      globalThis.fetch = (...args) => { scanRequests.push(String(args[0])); throw new Error('Unexpected network'); };
    });
    const external = [];
    context.on('request', (request) => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(server.baseUrl)) external.push(request.url());
    });
    const page = await openFixturePage(context, server.urlFor('/defanged-iocs.html'));
    const original = 'Before (hxxp://evil[.]com/a); HXXPS[:]//evil(.)com/a, evil[.]test and 8[.]8(.)8[.]8. Ordinary 1.1.1.1.';
    await expect.poll(() => iocHighlights(page, '#report').count()).toBe(5);
    await expect(page.locator('#report')).toHaveText(original);
    expect(await iocHighlights(page, 'textarea, [contenteditable]').count()).toBe(0);
    await expect(page.locator('#report a')).toHaveCount(0);
    await page.locator('#append').click();
    await expect.poll(() => iocHighlights(page, '#dynamic').count()).toBe(2);
    expect(external).toEqual([]);
    expect(await worker.evaluate(() => scanRequests)).toEqual([]);

    await iocHighlights(page, '#report').click();
    await expect(page.locator('.mustela-panel')).toContainText('http://evil.com/a');
    await expect(page).toHaveURL(server.urlFor('/defanged-iocs.html'));
    await expect(page.locator('#report')).toHaveText(original);
    let popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
    await expect(popup.locator('#historyList')).toContainText('http://evil.com/a');
    await popup.locator('#manualInput').fill('hxxp://evil[.]com/a');
    await popup.locator('#manualInvestigateBtn').click();
    await expect(page.locator('.mustela-panel')).toContainText('http://evil.com/a');
    const history = await worker.evaluate(async () => (await chrome.storage.local.get('mustela_history')).mustela_history);
    expect(history.filter((entry) => entry.ioc.normalized === 'http://evil.com/a')).toHaveLength(1);
    expect(external).toEqual([]);
    expect(await worker.evaluate(() => scanRequests)).toEqual([]);

    popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
    await popup.locator('#toggleBtn').click();
    await expect.poll(() => iocHighlights(page).count()).toBe(0);
    await expect(page.locator('#report')).toHaveText(original);
    await page.locator('#append').click();
    await expect.poll(() => iocHighlights(page).count()).toBe(0);
    await popup.locator('#toggleBtn').click();
    await expect.poll(() => iocHighlights(page, '#report').count()).toBe(5);
  } finally {
    await extension.close();
    await server.close();
  }
});
