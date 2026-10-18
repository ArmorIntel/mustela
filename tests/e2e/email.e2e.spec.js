import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, bindPopupToTab, getServiceWorker, iocHighlights } from './support/extensionHarness.js';

test('email scan, local notes, export and case-sensitive history need no providers or navigation', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  const { context, extensionId } = extension;
  try {
    const worker = await getServiceWorker(context);
    await worker.evaluate(() => {
      globalThis.emailRequests = [];
      globalThis.fetch = (...args) => { emailRequests.push(String(args[0])); throw new Error('Unexpected network'); };
    });
    const external = [];
    context.on('request', (request) => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(server.baseUrl)) external.push(request.url());
    });
    const page = await openFixturePage(context, server.urlFor('/email-iocs.html'));
    await expect.poll(() => iocHighlights(page, '#report').count()).toBe(3);
    expect(await iocHighlights(page, '#invalid, textarea, [contenteditable]').count()).toBe(0);
    await expect(page.locator('#report')).toHaveText('Contact analyst+tag@evil.test and First.Last@EVIL.TEST. Compare first.last@evil.test.');
    let popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
    await expect(popup.locator('#iocList')).toContainText('First.Last@evil.test');
    expect(await worker.evaluate(() => emailRequests)).toEqual([]);
    expect(external).toEqual([]);
    await popup.close();
    await iocHighlights(page, '#report').click(1);
    await expect(page.locator('.mustela-panel')).toContainText('First.Last@evil.test');
    await expect(page.locator('.mustela-panel')).toContainText('no compatible reputation provider');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy IOC', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('First.Last@evil.test');
    await expect(page.locator('.mustela-panel [data-provider], .mustela-panel a[href*="virustotal"], .mustela-panel a[href*="abuseipdb"], .mustela-panel a[href*="shodan"]')).toHaveCount(0);
    await expect(page.locator('#mustela-add-misp')).toHaveCount(0);
    await page.locator('#mustela-analyst-note').fill('Local uppercase identity');
    await page.locator('#mustela-analyst-note').blur();
    await expect(page.locator('#mustela-note-status')).toContainText('Note saved locally');
    await page.locator('#mustela-copy-export').click();
    await expect(page.locator('#mustela-copy-export')).toHaveText('Copied export');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const exported = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(exported.ioc.type).toBe('email');
    expect(exported.ioc.normalized).toBe('First.Last@evil.test');
    expect(exported.analystNote).toBe('Local uppercase identity');
    expect(exported.providerResults).toEqual([]);
    await page.locator('#mustela-rerun').click();
    await expect(page.locator('#mustela-analyst-note')).toHaveValue('Local uppercase identity');
    popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
    await popup.locator('#manualInput').fill('first.last@EVIL.TEST');
    await popup.locator('#manualInvestigateBtn').click();
    await expect(page.locator('.mustela-panel')).toContainText('first.last@evil.test');
    await expect(page.locator('#mustela-analyst-note')).toHaveValue('');
    const history = await worker.evaluate(async () => (await chrome.storage.local.get('mustela_history')).mustela_history);
    expect(history.map((entry) => entry.historyKey).sort()).toEqual(['email:First.Last@evil.test', 'email:first.last@evil.test']);
    expect(history.find((entry) => entry.normalized.startsWith('First')).analystNote).toBe('Local uppercase identity');
    popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
    await expect(popup.locator('#historyList')).toContainText('First.Last@evil.test');
    const tabsBefore = context.pages().length;
    for (const provider of ['virustotal', 'abuseipdb', 'shodan']) {
      const response = await popup.evaluate(({ provider }) => chrome.runtime.sendMessage({ type: 'OPEN_EXTERNAL_PROVIDER', payload: { provider, ioc: { type: 'email', normalized: 'First.Last@evil.test' } } }), { provider });
      expect(response.ok).toBe(false);
    }
    expect(context.pages()).toHaveLength(tabsBefore);
    await popup.locator('#toggleBtn').click();
    await expect.poll(() => iocHighlights(page).count()).toBe(0);
    await worker.evaluate(async () => {
      const settings = (await chrome.storage.local.get('mustela_settings')).mustela_settings || {};
      await chrome.storage.local.set({ mustela_settings: { ...settings, analystAssist: { enabled: true, baseUrl: 'https://llm.test/v1', apiKey: 'fixture-only', model: 'test' } } });
    });
    await page.reload();
    await expect.poll(() => iocHighlights(page).count()).toBe(0);
    expect(await worker.evaluate(() => emailRequests)).toEqual([]);
    expect(external).toEqual([]);
  } finally {
    await extension.close();
    await server.close();
  }
});
