import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, getServiceWorker } from './support/extensionHarness.js';

const send = (page, type, payload) => page.evaluate(({ type, payload }) => chrome.runtime.sendMessage({ type, payload }), { type, payload });
const marks = (page) => page.locator('.mustela-highlight');
const control = (page) => page.getByRole('button', { name: 'Mustela active on all pages', exact: true });
async function openPanel(worker, page, payload = null) {
  await worker.evaluate(async ({ url, payload }) => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL', payload });
  }, { url: page.url(), payload });
}
async function expectClear(page) {
  await expect(page.locator('.mustela-highlight, .mustela-page-indicator, .mustela-panel')).toHaveCount(0);
}

test('persisted OFF remains effective after a browser and service-worker restart', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const popup = await openPopup(extension.context, extension.extensionId);
    await control(popup).click();
    await expect(control(popup)).toHaveAttribute('aria-pressed', 'false');
    const worker = await getServiceWorker(extension.context);
    await extension.restart();
    const reopened = await openPopup(extension.context, extension.extensionId);
    expect((await send(reopened, 'GET_PAUSE_STATE')).data.paused).toBe(true);
    const nextWorker = await getServiceWorker(extension.context);
    expect(nextWorker).not.toBe(worker);
    const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    await expect.poll(() => page.locator('html').getAttribute('data-mustela-injected')).toBe('true');
    await expectClear(page);
    await openPanel(nextWorker, page, { type: 'ip', normalized: '203.0.113.50' });
    await expectClear(page);
    await control(reopened).click();
    await expect(marks(page).first()).toBeVisible();
  } finally { await extension.close(); await server.close(); }
});

for (const delayedStage of ['provider', 'llm']) {
  test(`OFF invalidates a delayed ${delayedStage} response even after ON, with no replay or panel reopening`, async () => {
    const server = await startFixtureServer();
    const extension = await launchExtensionContext();
    try {
      const popup = await openPopup(extension.context, extension.extensionId);
      await send(popup, 'SAVE_SETTINGS', {
        providers: {
          virustotal: { enabled: true, apiKey: 'fixture-key' },
          abuseipdb: { enabled: false }, shodan: { enabled: false }, misp: { enabled: false }
        },
        analystAssist: { enabled: true, baseUrl: 'https://llm.example/v1', apiKey: 'fixture-key', model: 'fixture-model' }
      });
      const worker = await getServiceWorker(extension.context);
      await worker.evaluate((stage) => {
        globalThis.calls = [];

        globalThis.fetch = async (url) => {
          calls.push(String(url));
          const isLlm = String(url).includes('llm.example');
          if ((stage === 'llm') === isLlm) await new Promise((resolve) => { globalThis.releaseResponse = resolve; });
          return new Response(JSON.stringify(isLlm
            ? { choices: [{ message: { content: '{"summary":"Fixture summary","action":"Review"}' } }] }
            : { data: { attributes: { last_analysis_stats: { malicious: 0, harmless: 1 } } } }), { status: 200 });
        };

      }, delayedStage);
      const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
      await expect(marks(page).first()).toBeVisible();
      await openPanel(worker, page, { type: 'ip', normalized: '8.8.8.8' });
      await expect.poll(() => worker.evaluate(() => typeof globalThis.releaseResponse)).toBe('function');
      await expect(page.locator('.mustela-panel')).toBeVisible();
      await control(popup).click();
      await expect(control(popup)).toHaveAttribute('aria-pressed', 'false');
      await expectClear(page);
      await control(popup).click();
      await expect(marks(page).first()).toBeVisible();
      await worker.evaluate(() => releaseResponse());
      await page.waitForTimeout(300);
      await expect(page.locator('.mustela-panel')).toHaveCount(0);
      expect(await worker.evaluate(() => calls.length)).toBe(delayedStage === 'provider' ? 1 : 2);
    } finally { await extension.close(); await server.close(); }
  });
}

test('confirmed popup OFF clears two keyless pages, closes panels, suspends mutations and resumes without replay', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const first = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    const second = await openFixturePage(extension.context, server.urlFor('/dynamic-iocs.html'));
    await expect(marks(first).first()).toBeVisible();
    await second.locator('#appendDynamicIoc').click();
    await expect(marks(second).first()).toBeVisible();
    const worker = await getServiceWorker(extension.context);
    await openPanel(worker, first);
    await expect(first.locator('.mustela-panel')).toBeVisible();
    const restricted = await extension.context.newPage();
    await restricted.goto('chrome://version');
    const popup = await openPopup(extension.context, extension.extensionId);
    const otherPopup = await openPopup(extension.context, extension.extensionId);
    await control(popup).focus();
    await control(popup).press('Space');
    await expect(control(popup)).toHaveAttribute('aria-pressed', 'false');
    await expect(control(otherPopup)).toHaveAttribute('aria-pressed', 'false');
    await expectClear(first);
    await expectClear(second);
    for (const page of [first, second]) {
      await page.evaluate(() => document.body.appendChild(Object.assign(document.createElement('p'), { textContent: '203.0.113.50 mutation.example' })));
    }
    await first.waitForTimeout(1300); // Beyond the content mutation debounce.
    await expectClear(first);
    await expectClear(second);
    await openPanel(worker, first, { type: 'ip', normalized: '203.0.113.50' });
    await expectClear(first);
    const fresh = await openFixturePage(extension.context, server.urlFor('/iocs.html?new'));
    await expectClear(fresh);
    await second.reload();
    await expectClear(second);
    const reopened = await openPopup(extension.context, extension.extensionId);
    await expect(control(reopened)).toHaveAttribute('aria-pressed', 'false');
    await control(reopened).click();
    await expect(marks(first).first()).toBeVisible();
    await second.locator('#appendDynamicIoc').click();
    await expect(marks(second).first()).toBeVisible();
    await expect(marks(fresh).first()).toBeVisible();
    await expect(first.locator('.mustela-panel')).toHaveCount(0);
    await expect(second.locator('.mustela-panel')).toHaveCount(0);
  } finally { await extension.close(); await server.close(); }
});

test('resume preserves URL exclusions and disabled highlighting; failed popup writes are retryable', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const popup = await openPopup(extension.context, extension.extensionId);
    const first = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    await expect(marks(first).first()).toBeVisible();
    await send(popup, 'SET_PAGE_DISABLED', { url: server.urlFor('/dynamic-iocs.html'), disabled: true });
    const excluded = await openFixturePage(extension.context, server.urlFor('/dynamic-iocs.html'));
    const settings = (await send(popup, 'GET_SETTINGS')).data;
    const worker = await getServiceWorker(extension.context);
    await worker.evaluate(() => {
      globalThis.originalStorageSet = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async (values) => {
        if ('mustela_paused' in values) throw new Error('Storage unavailable. Please retry.');
        return originalStorageSet(values);
      };
    });
    await control(popup).click();
    await expect(popup.locator('#pauseStatus')).toContainText('retry');
    await expect(control(popup)).toHaveAttribute('aria-pressed', 'true');
    await expect(marks(first).first()).toBeVisible();
    await worker.evaluate(() => { chrome.storage.local.set = originalStorageSet; });
    await popup.getByRole('button', { name: 'Retry global change' }).click();
    await expect(control(popup)).toHaveAttribute('aria-pressed', 'false');
    await control(popup).click();
    await expect(marks(first).first()).toBeVisible();
    await expectClear(excluded);
    expect((await send(popup, 'GET_SETTINGS')).data).toEqual(settings);
    await send(popup, 'SAVE_SETTINGS', { highlightEnabled: false });
    await expectClear(first);
    await control(popup).click();
    await expect(control(popup)).toHaveAttribute('aria-pressed', 'false');
    await control(popup).click();
    await expect(control(popup)).toHaveAttribute('aria-pressed', 'true');
    await expectClear(first);
    await expectClear(excluded);
    expect((await send(popup, 'GET_SETTINGS')).data.highlightEnabled).toBe(false);
    expect((await send(popup, 'IS_PAGE_DISABLED', { url: excluded.url() })).data).toBe(true);
  } finally { await extension.close(); await server.close(); }
});
