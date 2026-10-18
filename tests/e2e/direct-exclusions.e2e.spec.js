import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, bindPopupToTab, getServiceWorker, iocHighlights } from './support/extensionHarness.js';

const ip = { type: 'ip', normalized: '8.8.8.8' };
const send = (page, type, payload) => page.evaluate(({ type, payload }) => chrome.runtime.sendMessage({ type, payload }), { type, payload });
async function setRules(worker, rules) {
  await worker.evaluate((rules) => chrome.storage.local.set({ mustela_exclusions: { version: 1, rules } }), rules);
}
async function instrument(context) {
  const worker = await getServiceWorker(context);
  await worker.evaluate(async () => {
    globalThis.calls = [];
    globalThis.navigations = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"brief"}' } }] }));
      if (String(url).includes('/attributes/add/')) return new Response(JSON.stringify({ Attribute: { id: '7', event_id: '42' } }));
      return new Response('{}', { status: 503 });
    };
    chrome.tabs.create = async (details) => { navigations.push(details); return { id: 999, ...details }; };
    await chrome.storage.local.set({ mustela_settings: {
      highlightEnabled: true, detectionMode: 'balanced', cacheTtlMinutes: 30,
      providers: Object.fromEntries(['virustotal', 'abuseipdb', 'shodan', 'misp'].map((id) => [id, { enabled: true, apiKey: 'test-key', baseUrl: id === 'misp' ? 'https://misp.example' : '', defaultEventId: '42' }])),
      analystAssist: { enabled: true, baseUrl: 'https://assistant.test/v1', apiKey: 'test-key', model: 'test-model' }
    } });
  });
  return worker;
}
async function noOutputs(worker) {
  expect(await worker.evaluate(() => calls)).toEqual([]);
  expect(await worker.evaluate(() => navigations.filter(({ url }) => /^https?:/.test(url)))).toEqual([]);
}

for (const byPage of [false, true]) {
  test(`stale content buttons, provider cards, cache and rerun refuse ${byPage ? 'page' : 'IOC'} exclusions`, async () => {
    const server = await startFixtureServer();
    const extension = await launchExtensionContext();
    const pageNavigations = [];
    extension.context.on('page', (page) => page.on('request', (request) => {
      if (/virustotal|abuseipdb|shodan|misp\.example/.test(request.url())) pageNavigations.push(request.url());
    }));
    try {
      const worker = await instrument(extension.context);
      const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
      const highlight = iocHighlights(page, 'html', '8.8.8.8');
      await highlight.click();
      const panel = page.locator('.mustela-panel');
      await expect(panel.locator('#mustela-rerun')).toBeVisible();
      await expect(panel.locator('#mustela-add-misp')).toBeEnabled();
      const rule = byPage ? { kind: 'page-url', value: page.url() } : { kind: 'ioc', iocType: 'ip', value: ip.normalized };
      await setRules(worker, [rule]);
      await worker.evaluate(() => { calls.length = navigations.length = 0; });
      // Native links must not allow middle-click or context-menu navigation.
      await expect(panel.locator('.mustela-provider-link[href]')).toHaveCount(0);
      const pivot = panel.locator('.mustela-provider-link').first();
      await pivot.click();
      await expect(panel).toContainText('excluded');
      // Keep the stale result available for the independent add and rerun actions.
      await panel.locator('#mustela-add-misp').click();
      await expect(panel.locator('#mustela-note-status')).toContainText('excluded');
      await panel.locator('#mustela-rerun').click();
      await expect(panel).toContainText('excluded');
      await panel.locator('#mustela-close').click();
      await highlight.click();
      await expect(panel).toContainText('excluded');
      await noOutputs(worker);
      expect(pageNavigations).toEqual([]);
      // Explicit removal does not replay a blocked action; a new click is needed.
      await setRules(worker, []);
      await noOutputs(worker);
      await panel.locator('#mustela-close').click();
      await highlight.click();
      await expect(panel.locator('#mustela-rerun')).toBeVisible();
      expect(await worker.evaluate(() => calls.length)).toBe(0); // allowed cache reuse
      await panel.locator('#mustela-rerun').click();
      await expect.poll(() => worker.evaluate(() => calls.length)).toBe(5);
    } finally {
      await extension.close();
      await server.close();
    }
  });
}

test('popup keyless pivot keeps its source page, explains refusal, and history cannot bypass a source exclusion', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const worker = await instrument(extension.context);
    const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    const popup = await bindPopupToTab(extension.context, await openPopup(extension.context, extension.extensionId), page);
    await popup.locator('#manualInput').fill(ip.normalized);
    await worker.evaluate(async () => {
      const { mustela_settings: settings } = await chrome.storage.local.get('mustela_settings');
      for (const provider of Object.values(settings.providers)) provider.apiKey = '';
      await chrome.storage.local.set({ mustela_settings: settings });
      calls.length = navigations.length = 0;
    });
    await setRules(worker, [{ kind: 'page-url', value: page.url() }]);
    await popup.locator('#manualVtBtn').click();
    await expect(popup.locator('#manualHint')).toContainText('excluded');
    expect(popup.isClosed()).toBe(false);
    await popup.locator('#manualInvestigateBtn').click();
    await expect(page.locator('.mustela-panel')).toContainText('excluded');
    await noOutputs(worker);

    const historyPopup = await openPopup(extension.context, extension.extensionId);
    const historical = { ...ip, sourceContext: { pageUrl: 'https://historical.test/report' } };
    await setRules(worker, [{ kind: 'host', value: 'historical.test' }]);
    for (const type of ['LOOKUP_IOC', 'OPEN_EXTERNAL_PROVIDER', 'ADD_IOC_TO_MISP']) {
      const payload = type === 'LOOKUP_IOC' ? { ...historical, _rerun: 1 } : { provider: 'virustotal', ioc: historical };
      const response = await send(historyPopup, type, payload);
      expect(response.code).toBe('MUSTELA_EXCLUDED');
      expect(response.error).toContain('source page');
    }
    await noOutputs(worker);
    await setRules(worker, []);
    expect((await send(historyPopup, 'OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc: ip })).ok).toBe(true);
    expect(await worker.evaluate(() => navigations.filter(({ url }) => /^https?:/.test(url)).length)).toBe(1);
  } finally {
    await extension.close();
    await server.close();
  }
});

test('context menu handlers, in-page manual pivots and history reopening recheck current rules', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext({ captureContextMenus: true });
  try {
    const worker = await instrument(extension.context);
    const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    const panel = page.locator('.mustela-panel');
    const invokeMenu = (menuItemId, frameUrl = '') => worker.evaluate(async ({ menuItemId, frameUrl, url }) => {
      const [tab] = (await chrome.tabs.query({})).filter((tab) => tab.url === url);
      return contextMenuHandlers[0]({ menuItemId, selectionText: '8.8.8.8', pageUrl: url, frameUrl }, tab);
    }, { menuItemId, frameUrl, url: page.url() });
    expect(await worker.evaluate(() => contextMenuHandlers.length)).toBe(1);
    await invokeMenu('investigate-selection');
    await expect(panel.locator('#mustela-rerun')).toBeVisible();
    const popup = await bindPopupToTab(extension.context, await openPopup(extension.context, extension.extensionId), page);
    await expect(popup.locator('#historyList .history-open')).toHaveCount(1);
    await setRules(worker, [{ kind: 'ioc', iocType: 'ip', value: ip.normalized }]);
    await worker.evaluate(() => { calls.length = navigations.length = 0; });
    await popup.locator('#historyList .history-open').click();
    await expect(panel).toContainText('excluded');
    for (const rule of [
      { kind: 'ioc', iocType: 'ip', value: ip.normalized },
      { kind: 'page-url', value: page.url() },
      { kind: 'host', value: 'frame.test' }
    ]) {
      await setRules(worker, [rule]);
      for (const id of ['investigate-selection', 'open-virustotal', 'open-abuseipdb', 'open-shodan']) {
        expect((await invokeMenu(id, 'https://frame.test/report')).code).toBe('MUSTELA_EXCLUDED');
        await expect(panel).toContainText('excluded');
      }
    }
    await noOutputs(worker);

    // Open the manual in-page interface without an IOC; it sends nothing.
    const controller = await openPopup(extension.context, extension.extensionId);
    await controller.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL', payload: null });
    }, page.url());
    await panel.locator('#mustela-manual-input').fill(ip.normalized);
    await setRules(worker, [{ kind: 'page-url', value: page.url() }]);
    for (const id of ['#mustela-open-vt', '#mustela-open-abuse', '#mustela-open-shodan']) {
      await panel.locator(id).click();
      await expect(panel.locator('#mustela-manual-hint')).toContainText('excluded');
    }
    await panel.locator('#mustela-manual-go').click();
    await expect(panel).toContainText('excluded');
    await noOutputs(worker);
    await setRules(worker, []);
    await noOutputs(worker);
    for (const id of ['open-virustotal', 'open-abuseipdb', 'open-shodan']) await invokeMenu(id);
    expect(await worker.evaluate(() => navigations.filter(({ url }) => /^https?:/.test(url)).length)).toBe(3);
  } finally {
    await extension.close();
    await server.close();
  }
});
