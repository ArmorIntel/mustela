import { test, expect } from '@playwright/test';
import { launchExtensionContext, startFixtureServer, openFixturePage, getServiceWorker } from './support/extensionHarness.js';

const ioc = { type: 'ip', raw: '8.8.8.8', normalized: '8.8.8.8' };
const entry = { ioc, normalized: ioc.normalized, historyKey: 'ip:8.8.8.8', pageUrl: 'https://report.example/', overallVerdict: 'clean' };

// Exercise the packaged popup DOM with deterministic message latency and gates.
async function popupHarness(context, extensionId, options = {}) {
  const popup = await context.newPage();
  await popup.addInitScript(({ options, ioc, entry }) => {
    window.calls = [];
    window.releases = {};
    window.rowListeners = [];
    window.close = () => {};
    const listen = Element.prototype.addEventListener;
    Element.prototype.addEventListener = function (type, ...args) {
      if (this.closest?.('#iocList, #historyList, #historyFilters, #historyShortcuts') && !this.id) window.rowListeners.push(type);
      return listen.call(this, type, ...args);
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.copied = value; } } });
    chrome.tabs.query = async () => [{ id: 123, url: 'https://report.example/', title: 'Report' }];
    const respond = async ({ type, payload }) => {
      window.calls.push({ type, payload });
      if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
      if (options.gates?.includes(type)) await new Promise((resolve) => { window.releases[type] = resolve; });
      if (options.reject?.includes(type)) throw new Error('No receiver');
      const responses = {
        GET_PAUSE_STATE: { ok: true, data: { paused: false } },
        GET_DETECTION_POLICY: { ok: true, data: { excluded: !!options.excluded } },
        GET_HISTORY: { ok: true, data: options.history ? [entry] : [] },
        GET_SETTINGS: { ok: true, data: {} },
        GET_DETECTED_IOCS: { ok: true, data: [] },
        GET_PAGE_IOCS: { ok: true, data: options.empty ? [] : [ioc] },
        RESCAN_PAGE_IOCS: { ok: true, data: [ioc] }
      };
      return responses[type] || { ok: true };
    };
    chrome.runtime.sendMessage = respond;
    chrome.tabs.sendMessage = (tabId, message) => respond(message);
    new MutationObserver(() => {
      if (document.querySelector('#iocList .ioc-item') && window.listRenderedAt === undefined) window.listRenderedAt = performance.now();
    }).observe(document, { subtree: true, childList: true });
  }, { options, ioc, entry });
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  return popup;
}

let extension;
test.beforeAll(async () => { extension = await launchExtensionContext(); });
test.afterAll(async () => { await extension?.close(); });

test('five opens of a confirmed empty page never request a rescan', async () => {
  for (let count = 0; count < 5; count++) {
    const popup = await popupHarness(extension.context, extension.extensionId, { empty: true });
    await expect(popup.locator('#summaryBadge')).toHaveText('No IOC');
    expect(await popup.evaluate(() => calls.filter(({ type }) => type === 'RESCAN_PAGE_IOCS'))).toEqual([]);
    expect(await popup.evaluate(() => calls.filter(({ type }) => ['GET_PAGE_IOCS', 'GET_DETECTED_IOCS'].includes(type)).map(({ type }) => type))).toEqual(['GET_PAGE_IOCS']);
    await popup.close();
  }
});

test('five real popup opens reuse the content script empty snapshot', async () => {
  const server = await startFixtureServer();
  try {
    const { context, extensionId } = extension;
    const page = await openFixturePage(context, server.urlFor('/dynamic-iocs.html'));
    const worker = await getServiceWorker(context);
    const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id, page.url());
    await expect.poll(() => worker.evaluate(async (tabId) => {
      try { return await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_IOCS' }); } catch { return null; }
    }, tabId)).toEqual({ ok: true, data: [] });
    const requests = [];
    for (let count = 0; count < 5; count++) {
      const popup = await context.newPage();
      await popup.addInitScript((tabId) => {
        window.pageRequests = [];
        chrome.tabs.query = async () => [{ id: tabId, url: 'http://127.0.0.1/' }];
        const send = chrome.tabs.sendMessage.bind(chrome.tabs);
        chrome.tabs.sendMessage = (id, message) => {
          pageRequests.push(message.type);
          return send(id, message);
        };
      }, tabId);
      await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
      await expect(popup.locator('#summaryBadge')).toHaveText('No IOC');
      requests.push(...await popup.evaluate(() => pageRequests));
      await popup.close();
    }
    expect(requests).toEqual(Array(5).fill('GET_PAGE_IOCS'));
    await page.close();
  } finally {
    // Chromium can retain an idle fixture connection after closing the page.
    server.server.closeAllConnections();
    await server.close();
  }
});

test('pause and IOC list hydrate while history and settings are still pending', async () => {
  const popup = await popupHarness(extension.context, extension.extensionId, { history: true, gates: ['GET_HISTORY', 'GET_SETTINGS'] });
  await expect(popup.locator('#globalPauseBtn')).toContainText('Mustela ON');
  await expect(popup.locator('#iocList')).toContainText('8.8.8.8');
  expect(await popup.evaluate(() => calls.filter(({ type }) => ['GET_PAGE_IOCS', 'GET_DETECTED_IOCS', 'RESCAN_PAGE_IOCS'].includes(type)).map(({ type }) => type))).toEqual(['GET_PAGE_IOCS']);
  await popup.locator('#manualInput').fill('1.1.1.1');
  await expect(popup.locator('#manualInvestigateBtn')).toBeEnabled();
  await popup.evaluate(() => releases.GET_HISTORY());
  await expect(popup.locator('#iocList .ioc-item')).toHaveClass(/investigated/);
  await expect(popup.locator('#historyList')).toContainText('8.8.8.8');
  await popup.evaluate(() => releases.GET_SETTINGS());
  await popup.close();
});

test('unknown policy holds the skeleton and excluded pages never expose queried IOCs', async () => {
  const popup = await popupHarness(extension.context, extension.extensionId, { excluded: true, gates: ['GET_DETECTION_POLICY'] });
  await expect.poll(() => popup.evaluate(() => calls.some(({ type }) => type === 'GET_PAGE_IOCS'))).toBe(true);
  await expect(popup.locator('#summaryBadge')).toHaveText('Loading');
  await expect(popup.locator('#iocList .ioc-item')).toHaveCount(0);
  await popup.evaluate(() => releases.GET_DETECTION_POLICY());
  await expect(popup.locator('#summaryBadge')).toHaveText('Paused');
  await expect(popup.locator('#iocList .ioc-item')).toHaveCount(0);
  await popup.close();
});

test('only a missing content response uses cached results and recovery rescan', async () => {
  const popup = await popupHarness(extension.context, extension.extensionId, { reject: ['GET_PAGE_IOCS'] });
  await expect(popup.locator('#iocList')).toContainText('8.8.8.8');
  expect(await popup.evaluate(() => calls.filter(({ type }) => ['GET_PAGE_IOCS', 'GET_DETECTED_IOCS', 'RESCAN_PAGE_IOCS'].includes(type)).map(({ type }) => type))).toEqual(['GET_PAGE_IOCS', 'GET_DETECTED_IOCS', 'RESCAN_PAGE_IOCS']);
  await popup.close();
});

test('failed optional reads do not block IOC rendering or local controls', async () => {
  const popup = await popupHarness(extension.context, extension.extensionId, { reject: ['GET_HISTORY', 'GET_SETTINGS'] });
  await expect(popup.locator('#iocList')).toContainText('8.8.8.8');
  await popup.locator('#manualInput').fill('1.1.1.1');
  await expect(popup.locator('#manualInvestigateBtn')).toBeEnabled();
  await popup.close();
});

test('failed policy reads fail closed without blocking pause state', async () => {
  const popup = await popupHarness(extension.context, extension.extensionId, { reject: ['GET_DETECTION_POLICY'] });
  await expect(popup.locator('#globalPauseBtn')).toContainText('Mustela ON');
  await expect(popup.locator('#summaryBadge')).toHaveText('Paused');
  await expect(popup.locator('#iocList .ioc-item')).toHaveCount(0);
  await expect(popup.locator('#toggleBtn')).toBeDisabled();
  await popup.close();
});

test('delegated row actions survive hydration and support keyboard copy and nested icons', async () => {
  const popup = await popupHarness(extension.context, extension.extensionId, { history: true, gates: ['GET_HISTORY'] });
  await expect(popup.locator('#iocList')).toContainText('8.8.8.8');
  await popup.locator('.ioc-value').press('Space');
  expect(await popup.evaluate(() => window.copied)).toBe('8.8.8.8');
  await expect(popup.locator('.ioc-value')).toHaveClass(/is-copied/);
  await popup.locator('#iocList .ioc-action svg').click();
  await popup.evaluate(() => releases.GET_HISTORY());
  await popup.getByRole('button', { name: 'Open details' }).click();
  await popup.locator('#historyList .history-open').press('Enter');
  await popup.locator('#historyList .history-pin').click();
  await expect.poll(() => popup.evaluate(() => calls.filter(({ type }) => type === 'TOGGLE_HISTORY_PIN').length)).toBe(1);
  expect(await popup.evaluate(() => calls.filter(({ type }) => type === 'OPEN_INVESTIGATION_PANEL').map(({ payload }) => payload.normalized))).toEqual(['8.8.8.8', '8.8.8.8', '8.8.8.8']);
  expect(await popup.evaluate(() => rowListeners)).toEqual([]);
  await popup.close();
});

test('measure time to IOC list with equal 40ms message latency', async () => {
  const samples = [];
  for (let count = 0; count < 5; count++) {
    const popup = await popupHarness(extension.context, extension.extensionId, { delay: 40 });
    await expect(popup.locator('#iocList .ioc-item')).toHaveCount(1);
    samples.push(await popup.evaluate(() => window.listRenderedAt));
    await popup.close();
  }
  console.log(`Popup list render milliseconds (navigation start, 40ms/message): ${JSON.stringify(samples)}`);
});
