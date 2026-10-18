import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, bindPopupToTab, getServiceWorker } from './support/extensionHarness.js';

test('popup correlation rechecks exclusions after display and explains page and history refusals without sending', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const worker = await getServiceWorker(extension.context);
    await worker.evaluate(async () => {
      globalThis.correlationCalls = [];
      globalThis.fetch = async (url, options) => {
        correlationCalls.push({ url: String(url), body: options.body });
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"patterns":[],"action":"Review allowed evidence"}' } }] }));
      };
      await chrome.storage.local.set({
        mustela_settings: { analystAssist: { enabled: true, baseUrl: 'https://assistant.test/v1', apiKey: 'test-key', model: 'test-model' } },
        mustela_history: ['first.test', 'second.test', 'secret.test'].map((normalized) => ({
          ioc: { type: 'domain', normalized }, overallVerdict: normalized === 'secret.test' ? 'malicious' : 'clean',
          pageUrl: `https://${normalized}/report`, pageTitle: `Title ${normalized}`, summaryText: `Summary ${normalized}`
        }))
      });
    });
    const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    const popup = await bindPopupToTab(extension.context, await openPopup(extension.context, extension.extensionId), page);
    const button = popup.locator('#correlateBtn');
    await expect(button).toBeEnabled();
    // The popup has already rendered; this new page rule must still block its click.
    await worker.evaluate((value) => chrome.storage.local.set({ mustela_exclusions: { version: 1, rules: [{ kind: 'page-url', value }] } }), page.url());
    await button.click();
    await expect(popup.locator('#correlationResult')).toContainText('source page is excluded');
    expect(await worker.evaluate(() => correlationCalls)).toEqual([]);

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ mustela_exclusions: { version: 1, rules: [
        { kind: 'host', value: 'secret.test' }, { kind: 'ioc', iocType: 'domain', value: 'second.test' }
      ] } });
    });
    // Reopen the popup for a fresh analyst action after the refusal.
    await bindPopupToTab(extension.context, popup, page);
    await button.click();
    await expect(popup.locator('#correlationResult')).toContainText('at least two eligible entries');
    expect(await worker.evaluate(() => correlationCalls)).toEqual([]);

    await worker.evaluate(() => chrome.storage.local.set({ mustela_exclusions: { version: 1, rules: [{ kind: 'host', value: 'secret.test' }] } }));
    // Removing a rule alone must not replay either refused action.
    expect(await worker.evaluate(() => correlationCalls)).toEqual([]);
    await bindPopupToTab(extension.context, popup, page);
    await button.click();
    await expect(popup.locator('#correlationResult')).toContainText('Review allowed evidence');
    const calls = await worker.evaluate(() => correlationCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toContain('first.test');
    expect(calls[0].body).toContain('second.test');
    expect(calls[0].body).not.toContain('secret.test');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('mustela_history')).mustela_history.length)).toBe(3);
  } finally {
    await extension.close();
    await server.close();
  }
});
