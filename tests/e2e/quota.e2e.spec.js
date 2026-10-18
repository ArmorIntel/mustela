import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, getServiceWorker, openFixturePage, iocHighlights } from './support/extensionHarness.js';

test('quota refusals show retry seconds in the panel without blocking other providers', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const { context } = extension;
    const worker = await getServiceWorker(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ mustela_settings: {
        providers: {
          virustotal: { enabled: true, apiKey: 'test-key' },
          abuseipdb: { enabled: true, apiKey: 'test-key' },
          shodan: { enabled: false }, misp: { enabled: false }
        }, analystAssist: { enabled: false }
      } });
      globalThis.quotaCalls = [];
      globalThis.fetch = async (url) => {
        quotaCalls.push(String(url));
        return String(url).includes('virustotal')
          ? new Response('', { status: 429, headers: { 'Retry-After': '60' } })
          : new Response(JSON.stringify({ data: { abuseConfidenceScore: 10, totalReports: 2 } }));
      };
    });
    const page = await openFixturePage(context, server.urlFor('/iocs.html'));
    await iocHighlights(page).click(1);
    await expect(page.locator('.mustela-panel')).toContainText(/quota reached, retry possible in \d+ s/i);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await iocHighlights(page).click(0);
    await expect(page.locator('.mustela-panel')).toContainText(/quota reached, retry possible in \d+ s/i);
    await expect(page.locator('.mustela-panel')).toContainText('AbuseIPDB scored it 10/100 with 2 reports.');
    const calls = await worker.evaluate(() => quotaCalls);
    expect(calls.filter((url) => url.includes('virustotal'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('abuseipdb'))).toHaveLength(1);
  } finally {
    await extension.close();
    await server.close();
  }
});
