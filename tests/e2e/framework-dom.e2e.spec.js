import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, iocHighlights } from './support/extensionHarness.js';

const send = (page, type, payload) => page.evaluate(({ type, payload }) => chrome.runtime.sendMessage({ type, payload }), { type, payload });

test.describe('pages whose DOM is owned by a framework', () => {
  let server;
  let extension;

  test.beforeAll(async () => { server = await startFixtureServer(); });
  test.afterAll(async () => { await server?.close(); });
  test.beforeEach(async () => { extension = await launchExtensionContext(); });
  test.afterEach(async () => { await extension?.close(); });

  test('re-rendered text keeps working, stays current and remains investigable', async () => {
    const page = await openFixturePage(extension.context, server.urlFor('/framework-iocs.html'));
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await expect.poll(() => iocHighlights(page, '#feed').texts()).toEqual(['8.8.1.1', '8.8.2.1', '8.8.3.1']);

    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.renderFeed());
      await page.waitForTimeout(i % 5 === 4 ? 1200 : 60);
    }

    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.frameworkErrors)).toEqual([]);
    await expect(page.locator('#feed td')).toHaveText(['Source 1 v21: 8.8.1.21', 'Source 2 v21: 8.8.2.21', 'Source 3 v21: 8.8.3.21']);
    await expect.poll(() => iocHighlights(page, '#feed').texts()).toEqual(['8.8.1.21', '8.8.2.21', '8.8.3.21']);
    await iocHighlights(page, '#feed').click(1);
    await expect(page.locator('.mustela-panel')).toContainText('8.8.2.21');
    await expect(page.locator('.mustela-panel')).toContainText('Global verdict');
  });

  test('highlighting never changes the page DOM, its layout or risky regions', async () => {
    const page = await openFixturePage(extension.context, server.urlFor('/framework-iocs.html'));
    await expect.poll(() => iocHighlights(page, '#static').texts()).toEqual(['8.8.8.8', 'evil.example.org']);
    await expect(page.locator('.mustela-page-indicator')).toBeVisible();

    expect(await iocHighlights(page, '#chart, #editor, #textbox, #live').count()).toBe(0);
    const state = await page.evaluate(() => ({
      boxes: [...document.querySelectorAll('h1, p, td, svg, #editor, #textbox, #live')].map((el) => JSON.stringify(el.getBoundingClientRect())),
      textsConnected: window.originalTexts.every((node) => node.isConnected),
      body: document.body.innerHTML.replace(/<div class="mustela-page-indicator"[\s\S]*?<\/div>$/, '')
    }));
    expect(state.boxes).toEqual(await page.evaluate(() => window.originalBoxes));
    expect(state.textsConnected).toBe(true);
    expect(state.body).toBe(await page.evaluate(() => window.originalBody));

    const popup = await openPopup(extension.context, extension.extensionId);
    expect((await send(popup, 'SET_PAUSE_STATE', { paused: true })).ok).toBe(true);
    await expect.poll(() => iocHighlights(page).count()).toBe(0);
    await expect(page.locator('.mustela-page-indicator')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.innerHTML === window.originalBody
      && window.originalTexts.every((node) => node.isConnected))).toBe(true);
  });
});
