import { test, expect } from '@playwright/test';
import {
  startFixtureServer,
  launchExtensionContext,
  openPopup,
  bindPopupToTab,
  openFixturePage,
  getServiceWorker
} from './support/extensionHarness.js';

test.describe('Chrome extension E2E', () => {
  let server;

  test.beforeAll(async () => {
    server = await startFixtureServer();
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test('detects and highlights IOC values, then opens the in-page panel from a highlight', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/iocs.html'));

      await expect(page.locator('.mustela-highlight')).toHaveCount(4);
      await expect(page.locator('.mustela-page-indicator')).toContainText('4');

      await page.locator('.mustela-highlight').nth(1).click();
      await expect(page.locator('.mustela-panel')).toBeVisible();
      await expect(page.locator('.mustela-panel')).toContainText('evil.example.org');
      await expect(page.locator('.mustela-panel')).toContainText('Global verdict');
    } finally {
      await extension.close();
    }
  });

  test('rescans dynamic content and keeps popup summary aligned with newly detected IOC values', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/dynamic-iocs.html'));
      const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);

      await expect(page.locator('.mustela-highlight')).toHaveCount(0);
      await expect(popup.locator('#summaryBadge')).toHaveText('No IOC');

      await page.getByRole('button', { name: 'Append dynamic IOC' }).click();
      await expect(page.locator('.mustela-highlight')).toHaveCount(2);

      await popup.reload({ waitUntil: 'domcontentloaded' });
      await expect(popup.locator('#summaryBadge')).toContainText('2 IOC');
      await expect(popup.locator('#iocList .ioc-item')).toHaveCount(2);
      await expect(popup.locator('#iocList')).toContainText('9.9.9.9');
      await expect(popup.locator('#iocList')).toContainText('dynamic.evil.example');

      await popup.close();
    } finally {
      await extension.close();
    }
  });

  test('can disable and re-enable the extension on the active page from the popup', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/iocs.html'));
      const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);

      await expect(page.locator('.mustela-highlight')).toHaveCount(4);
      await expect(popup.locator('#summaryBadge')).toContainText('4 IOC');

      await popup.locator('#toggleBtn').click();
      await expect(page.locator('.mustela-highlight')).toHaveCount(0);
      await expect(page.locator('.mustela-page-indicator')).toHaveCount(0);
      await expect(popup.locator('#summaryBadge')).toHaveText('Paused');
      await expect(popup.locator('#summaryText')).toContainText('disabled on this page');

      await popup.locator('#toggleBtn').click();
      await expect(page.locator('.mustela-highlight')).toHaveCount(4);
      await expect(popup.locator('#summaryBadge')).toContainText('4 IOC');

      await popup.close();
    } finally {
      await extension.close();
    }
  });

  test('popup manual lookup and current-page actions stay actionable without relying on cosmetic selectors', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/iocs.html'));
      const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);

      await expect(popup.locator('#summaryBadge')).toContainText('4 IOC');
      await expect(popup.locator('#manualInvestigateBtn')).toBeDisabled();

      await popup.locator('#manualInput').fill('1.1.1.1');
      await expect(popup.locator('#manualTypeChip')).toHaveText('IP');
      await expect(popup.locator('#manualHint')).toContainText('IOC recognized: IP');
      await expect(popup.locator('#manualInvestigateBtn')).toBeEnabled();

      await popup.locator('#manualInvestigateBtn').click();
      await expect(page.locator('.mustela-panel')).toBeVisible();
      await expect(page.locator('.mustela-panel')).toContainText('1.1.1.1');

      const popup2 = await bindPopupToTab(context, await openPopup(context, extensionId), page);
      await popup2.locator('#investigateBtn').click();
      await expect(page.locator('.mustela-panel')).toContainText('8.8.8.8');
      await popup2.close();
      await popup.close();
    } finally {
      await extension.close();
    }
  });

  test('recent investigations surface reopen and pin flows after a real lookup', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/iocs.html'));
      const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);

      await popup.locator('#manualInput').fill('8.8.8.8');
      await popup.locator('#manualInvestigateBtn').click();
      await expect(page.locator('.mustela-panel')).toContainText('8.8.8.8');

      const popupAfterLookup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
      await expect(popupAfterLookup.locator('#historyBadge')).toHaveText('1');
      await expect(popupAfterLookup.locator('#historyList')).toContainText('8.8.8.8');
      await expect(popupAfterLookup.locator('#historyShortcuts')).toContainText('Open same page');

      await popupAfterLookup.getByRole('button', { name: 'Pin' }).click();
      await expect(popupAfterLookup.locator('#historyList')).toContainText('📌 8.8.8.8');
      await expect(popupAfterLookup.locator('#historyFilters')).toContainText('Pinned');

      await popupAfterLookup.locator('#historyList .history-open').click();
      await expect(page.locator('.mustela-panel')).toContainText('8.8.8.8');

      await popupAfterLookup.close();
      await popup.close();
    } finally {
      await extension.close();
    }
  });

  test('in-page investigation supports local analyst notes and reusable JSON export', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/iocs.html'));
      const worker = await getServiceWorker(context);

      await page.locator('.mustela-highlight').first().click();
      await expect(page.locator('.mustela-panel')).toBeVisible();
      await page.locator('#mustela-analyst-note').fill('Escalate to IR if beaconing repeats.');
      await page.locator('#mustela-analyst-note').blur();
      await expect(page.locator('#mustela-note-status')).toContainText('Note saved locally');

      await page.locator('#mustela-copy-export').click();
      await expect(page.locator('#mustela-copy-export')).toHaveText('Copied export');
      const exportPayload = JSON.parse(await page.locator('#mustela-copy-export').getAttribute('data-copy-payload'));
      expect(exportPayload.ioc.normalized).toBe('8.8.8.8');
      expect(exportPayload.analystNote).toBe('Escalate to IR if beaconing repeats.');
      expect(Array.isArray(exportPayload.providerResults)).toBeTruthy();

      await page.locator('#mustela-close').click();
      await page.locator('.mustela-highlight').first().click();
      await expect(page.locator('#mustela-analyst-note')).toHaveValue('Escalate to IR if beaconing repeats.');

      const storedHistory = await worker.evaluate(async () => (await chrome.storage.local.get('mustela_history')).mustela_history || []);
      expect(storedHistory[0].analystNote).toBe('Escalate to IR if beaconing repeats.');
    } finally {
      await extension.close();
    }
  });

  test('manual external lookup opens the expected provider tab for supported IOC types', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/iocs.html'));
      const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
      const worker = await getServiceWorker(context);

      await popup.locator('#manualInput').fill('1.1.1.1');
      const newPagePromise = context.waitForEvent('page');
      await popup.locator('#manualVtBtn').click();
      const providerPage = await newPagePromise;
      await providerPage.waitForLoadState('domcontentloaded');
      await expect(providerPage).toHaveURL(/https:\/\/www\.virustotal\.com\/gui\/search\/1\.1\.1\.1/);

      await providerPage.close();
      await popup.close();
      await worker.evaluate(() => chrome.storage.local.clear());
    } finally {
      await extension.close();
    }
  });

  test('settings page can disable and re-enable highlighting without breaking popup summary refresh', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/iocs.html'));
      const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
      const worker = await getServiceWorker(context);

      await expect(page.locator('.mustela-highlight')).toHaveCount(4);
      const settingsPagePromise = context.waitForEvent('page');
      await popup.locator('#settingsBtn').click();
      const settingsPage = await settingsPagePromise;
      await settingsPage.waitForLoadState('domcontentloaded');
      await expect(settingsPage).toHaveURL(new RegExp(`chrome-extension://${extensionId}/src/welcome/welcome\\.html`));

      await settingsPage.locator('#highlightEnabled').uncheck();
      await settingsPage.locator('#saveStickyBtn').click();
      await expect(settingsPage.locator('#saveToast')).toContainText('Settings saved locally.');
      await expect(page.locator('.mustela-highlight')).toHaveCount(0);
      await expect(page.locator('.mustela-page-indicator')).toHaveCount(0);

      await bindPopupToTab(context, popup, page);
      await expect(popup.locator('#summaryBadge')).toHaveText('No IOC');

      await settingsPage.locator('#highlightEnabled').check();
      await settingsPage.locator('#saveStickyBtn').click();
      await expect(page.locator('.mustela-highlight')).toHaveCount(4);

      await bindPopupToTab(context, popup, page);
      await expect(popup.locator('#summaryBadge')).toContainText('4 IOC');

      await settingsPage.close();
      await popup.close();
      await worker.evaluate(() => chrome.storage.local.clear());
    } finally {
      await extension.close();
    }
  });

  test('popup current-page section handles overflow and expands to show all detected IOC values', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/many-iocs.html'));
      const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);

      await expect(page.locator('.mustela-highlight')).toHaveCount(7);
      await expect(popup.locator('#summaryBadge')).toContainText('7 IOC');
      await expect(popup.locator('#iocList .ioc-item')).toHaveCount(5);
      await expect(popup.locator('#iocListHint')).toContainText('Showing 5/7');
      await expect(popup.locator('#iocListToggleBtn')).toHaveText('Show all');

      await popup.locator('#iocListToggleBtn').click();
      await expect(popup.locator('#iocList .ioc-item')).toHaveCount(7);
      await expect(popup.locator('#iocListHint')).toContainText('Showing all 7 detected IOCs');
      await expect(popup.locator('#iocList')).toContainText('10.0.0.0/24');
      await expect(popup.locator('#iocList')).toContainText('AS13335');
      await expect(popup.locator('#iocListToggleBtn')).toHaveText('Show less');

      await popup.close();
    } finally {
      await extension.close();
    }
  });

  test('manual lookup keeps provider pivot buttons aligned with supported IOC types', async () => {
    const extension = await launchExtensionContext();
    const { context, extensionId } = extension;

    try {
      const page = await openFixturePage(context, server.urlFor('/iocs.html'));
      const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);

      await popup.locator('#manualInput').fill('10.0.0.0/24');
      await expect(popup.locator('#manualTypeChip')).toHaveText('SUBNET');
      await expect(popup.locator('#manualVtBtn')).toBeDisabled();
      await expect(popup.locator('#manualAbuseBtn')).toBeEnabled();
      await expect(popup.locator('#manualShodanBtn')).toBeDisabled();

      const abusePagePromise = context.waitForEvent('page');
      await popup.locator('#manualAbuseBtn').click();
      const abusePage = await abusePagePromise;
      await abusePage.waitForLoadState('domcontentloaded');
      await expect(abusePage).toHaveURL(/https:\/\/www\.abuseipdb\.com\/check-block\/10\.0\.0\.0%2F24/);
      await abusePage.close();

      const popupAsn = await bindPopupToTab(context, await openPopup(context, extensionId), page);
      await popupAsn.locator('#manualInput').fill('AS13335');
      await expect(popupAsn.locator('#manualTypeChip')).toHaveText('ASN');
      await expect(popupAsn.locator('#manualVtBtn')).toBeDisabled();
      await expect(popupAsn.locator('#manualAbuseBtn')).toBeDisabled();
      await expect(popupAsn.locator('#manualShodanBtn')).toBeEnabled();

      const shodanPagePromise = context.waitForEvent('page');
      await popupAsn.locator('#manualShodanBtn').click();
      const shodanPage = await shodanPagePromise;
      await shodanPage.waitForLoadState('domcontentloaded');
      await expect(shodanPage).toHaveURL(/https:\/\/www\.shodan\.io\/search\?query=AS13335/);
      await shodanPage.close();
      await popupAsn.close();
      await popup.close();
    } finally {
      await extension.close();
    }
  });
});
