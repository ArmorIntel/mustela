import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, bindPopupToTab, getServiceWorker } from './support/extensionHarness.js';

test('popup detection is session-only and tab closure/navigation release only the affected tab', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  const { context, extensionId } = extension;
  try {
    const worker = await getServiceWorker(context);
    const first = await openFixturePage(context, server.urlFor('/iocs.html'));
    const second = await openFixturePage(context, server.urlFor('/email-iocs.html'));
    await expect(first.locator('.mustela-highlight').first()).toBeVisible();
    await expect(second.locator('#report .mustela-highlight')).toHaveCount(3);
    const popup = await bindPopupToTab(context, await openPopup(context, extensionId), first);
    await expect(popup.locator('#iocList')).toContainText('8.8.8.8');
    const tabIds = await worker.evaluate(async (urls) => {
      const tabs = await chrome.tabs.query({});
      return urls.map((url) => tabs.find((tab) => tab.url === url).id);
    }, [first.url(), second.url()]);
    const read = (tabId) => popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'GET_DETECTED_IOCS', payload: { tabId } }), tabId);
    await expect.poll(async () => (await read(tabIds[1])).data.length).toBe(3);
    const secondIocs = (await read(tabIds[1])).data;
    const stored = await worker.evaluate(() => chrome.storage.session.get(null));
    const record = stored[`mustela_detected_tab_${tabIds[1]}`];
    expect(record.sourceContext.pageUrl).toBe(second.url());
    expect(record.iocs.every((ioc) => !('sourceContext' in ioc))).toBe(true);
    expect(await worker.evaluate(() => chrome.storage.local.get('mustela_last_detected'))).toEqual({});
    await first.close();
    await expect.poll(async () => (await read(tabIds[0])).data).toEqual([]);
    expect((await read(tabIds[1])).data).toEqual(secondIocs);
    expect(await worker.evaluate((id) => chrome.storage.session.get(`mustela_detected_tab_${id}`), tabIds[0])).toEqual({});
    await second.goto('about:blank');
    await expect.poll(async () => (await read(tabIds[1])).data).toEqual([]);
    expect(await worker.evaluate((id) => chrome.storage.session.get(`mustela_detected_tab_${id}`), tabIds[1])).toEqual({});
  } finally {
    await extension.close();
    await server.close();
  }
});
