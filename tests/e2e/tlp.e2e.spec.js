import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { startFixtureServer, launchExtensionContext, openFixturePage, getServiceWorker, iocHighlights } from './support/extensionHarness.js';

const levels = ['clear', 'green', 'amber', 'amber+strict', 'red', ''];
let server;
test.beforeAll(async () => { server = await startFixtureServer(); });
test.afterAll(async () => { await server.close(); });

async function choose(page, value) {
  await page.getByLabel('TLP', { exact: true }).selectOption(value);
  await expect(page.locator('#mustela-tlp-status')).toHaveText('Sharing label saved locally.');
}

test('TLP remains local across pages, reruns and independent IOCs, with matching real exports', async () => {
  const extension = await launchExtensionContext();
  const { context } = extension;
  try {
    const worker = await getServiceWorker(context);
    await worker.evaluate(() => {
      globalThis.networkCalls = 0;
      globalThis.fetch = () => { globalThis.networkCalls++; throw new Error('Unexpected network request'); };
    });
    const page = await openFixturePage(context, server.urlFor('/iocs.html'));
    await iocHighlights(page).click();
    const select = page.getByLabel('TLP', { exact: true });
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue('');
    await expect(select.locator('option')).toHaveText(['Not classified', 'TLP:CLEAR', 'TLP:GREEN', 'TLP:AMBER', 'TLP:AMBER+STRICT', 'TLP:RED']);
    await expect(page.locator('#mustela-tlp-help')).toHaveText('A sharing label, not a network control. Check the recipient before sharing.');
    await page.locator('#mustela-analyst-note').fill('Keep this local note.');
    await page.locator('#mustela-analyst-note').blur();
    await expect(page.locator('#mustela-note-status')).toContainText('Note saved locally');
    for (const value of levels) await choose(page, value);
    expect(await worker.evaluate(() => globalThis.networkCalls)).toBe(0);
    for (const light of [true, false]) {
      await page.locator('.mustela-panel').evaluate((el, light) => el.classList.toggle('mustela-panel--light', light), light);
      await expect(select).toHaveCSS('color', light ? 'rgb(15, 23, 42)' : 'rgb(248, 250, 252)');
      await expect(select).toHaveCSS('background-color', light ? 'rgb(255, 255, 255)' : 'rgb(30, 41, 59)');
      await select.focus();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await expect(select).toHaveValue('red');
      await expect(page.locator('#mustela-tlp-status')).toHaveText('Sharing label saved locally.');
      if (light) await choose(page, '');
    }
    await page.locator('#mustela-copy-export').click();
    await expect(page.locator('#mustela-copy-export')).toHaveText('Copied export');
    const copied = JSON.parse(await page.locator('#mustela-copy-export').getAttribute('data-copy-payload'));
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(copied);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#mustela-download-export').click();
    const download = await downloadPromise;
    const downloaded = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    expect(downloaded).toEqual(copied);
    expect(copied.tlp).toBe('red');
    expect(copied.analystNote).toBe('Keep this local note.');
    expect(copied.ioc.normalized).toBe('8.8.8.8');
    expect(copied.providerResults.length).toBeGreaterThan(0);
    expect(JSON.stringify(copied)).not.toMatch(/apiKey|Authorization/);
    expect(copied.tags).not.toContain('red');
    await page.locator('#mustela-rerun').click();
    await expect(select).toHaveValue('red');
    await expect(page.locator('#mustela-analyst-note')).toHaveValue('Keep this local note.');
    await page.locator('#mustela-close').click();
    await iocHighlights(page).click(1);
    await expect(select).toHaveValue('');
    await choose(page, 'green');
    const other = await openFixturePage(context, server.urlFor('/other-page.html'));
    await iocHighlights(other).click();
    await expect(other.getByLabel('TLP', { exact: true })).toHaveValue('red');
    await choose(other, '');
    await other.locator('#mustela-close').click();
    await iocHighlights(other).click();
    await expect(other.getByLabel('TLP', { exact: true })).toHaveValue('');
    expect(JSON.parse(await other.locator('#mustela-copy-export').getAttribute('data-copy-payload')).tlp).toBeNull();
    await expect(select).toHaveValue('green');
  } finally { await extension.close(); }
});

test('loading failures keep sharing disabled; retry treats unknown legacy labels as unclassified', async () => {
  const extension = await launchExtensionContext();
  try {
    const { context } = extension;
    const worker = await getServiceWorker(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ mustela_history: [{ ioc: { type: 'ip', normalized: '8.8.8.8' }, tlp: 'unknown' }] });
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      let reads = 0;
      globalThis.restoreGet = () => { chrome.storage.local.get = get; };
      chrome.storage.local.get = async (key) => {
        // First history read belongs to the lookup; second loads the panel metadata.
        if (key === 'mustela_history' && ++reads === 2) {
          await new Promise((resolve) => { globalThis.releaseLoad = resolve; });
          throw new Error('Storage unavailable');
        }
        return get(key);
      };
    });
    const page = await openFixturePage(context, server.urlFor('/iocs.html'));
    await iocHighlights(page).click();
    await expect(page.locator('#mustela-tlp-status')).toHaveText('Loading sharing label…');
    for (const id of ['mustela-copy-export', 'mustela-download-export', 'mustela-add-misp', 'mustela-tlp']) {
      await expect(page.locator(`#${id}`)).toBeDisabled();
    }
    await expect.poll(() => worker.evaluate(() => typeof globalThis.releaseLoad)).toBe('function');
    await worker.evaluate(() => globalThis.releaseLoad());
    await expect(page.locator('#mustela-tlp-status')).toContainText('not loaded');
    await expect(page.locator('#mustela-copy-export')).toBeDisabled();
    await worker.evaluate(() => globalThis.restoreGet());
    await page.locator('#mustela-rerun').click();
    await expect(page.getByLabel('TLP', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('TLP', { exact: true })).toHaveValue('');
    expect(JSON.parse(await page.locator('#mustela-copy-export').getAttribute('data-copy-payload')).tlp).toBeNull();
  } finally { await extension.close(); }
});

test('pending and failed local saves block sharing then retain the last confirmed label', async () => {
  const extension = await launchExtensionContext();
  try {
    const { context } = extension;
    const worker = await getServiceWorker(context);
    const page = await openFixturePage(context, server.urlFor('/iocs.html'));
    await iocHighlights(page).click();
    await choose(page, 'amber+strict');
    await worker.evaluate(() => {
      const set = chrome.storage.local.set.bind(chrome.storage.local);
      globalThis.restoreSet = () => { chrome.storage.local.set = set; };
      chrome.storage.local.set = async (payload) => {
        if (payload.mustela_history?.[0]?.tlp === 'red') {
          await new Promise((resolve) => { globalThis.releaseSave = resolve; });
          throw new Error('Storage unavailable');
        }
        return set(payload);
      };
    });
    await page.getByLabel('TLP', { exact: true }).selectOption('red');
    await expect(page.locator('#mustela-tlp-status')).toHaveText('Saving sharing label…');
    for (const id of ['mustela-copy-export', 'mustela-download-export', 'mustela-add-misp', 'mustela-rerun', 'mustela-tlp']) {
      await expect(page.locator(`#${id}`)).toBeDisabled();
    }
    await worker.evaluate(() => globalThis.releaseSave());
    await expect(page.locator('#mustela-tlp-status')).toContainText('not saved');
    await expect(page.getByLabel('TLP', { exact: true })).toHaveValue('amber+strict');
    await expect(page.locator('#mustela-copy-export')).toBeEnabled();
    expect(JSON.parse(await page.locator('#mustela-copy-export').getAttribute('data-copy-payload')).tlp).toBe('amber+strict');
    await worker.evaluate(() => globalThis.restoreSet());
    await choose(page, 'red');
  } finally { await extension.close(); }
});

test('explicit MISP adds carry each confirmed attribute label; failures keep local data and require manual retry', async () => {
  const extension = await launchExtensionContext();
  try {
    const { context } = extension;
    const worker = await getServiceWorker(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ mustela_settings: { providers: { misp: { enabled: true, baseUrl: 'https://misp.example', apiKey: 'test-only', defaultEventId: '7' } } } });
      globalThis.adds = [];
      globalThis.lookupBodies = [];
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        if (url.endsWith('/attributes/restSearch')) {
          globalThis.lookupBodies.push(body);
          return new Response('{}', { status: 500 });
        }
        if (!url.endsWith('/attributes/add/7')) throw new Error('Unexpected endpoint');
        globalThis.adds.push(body);
        if (globalThis.addStatus === 'timeout') throw new DOMException('Timed out', 'AbortError');
        return new Response(globalThis.addStatus ? '{}' : JSON.stringify({ Attribute: { id: '42' } }), { status: globalThis.addStatus || 200 });
      };
    });
    const page = await openFixturePage(context, server.urlFor('/iocs.html'));
    await iocHighlights(page).click();
    await expect(page.getByLabel('TLP', { exact: true })).toBeEnabled();
    await page.locator('#mustela-analyst-note').fill('Keep note on failure.');
    await page.locator('#mustela-analyst-note').blur();
    await expect(page.locator('#mustela-note-status')).toContainText('Note saved locally');
    for (const value of levels) {
      await choose(page, value);
      const count = await worker.evaluate(() => globalThis.adds.length);
      await page.locator('#mustela-add-misp').click();
      await expect(page.locator('#mustela-add-misp')).toHaveText('Added to MISP');
      const adds = await worker.evaluate(() => globalThis.adds);
      expect(adds).toHaveLength(count + 1);
      expect(adds.at(-1)).toEqual({ value: '8.8.8.8', type: 'ip-dst', category: 'Network activity', to_ids: true, comment: 'Keep note on failure.', ...(value ? { Tag: [{ name: `tlp:${value}` }] } : {}) });
      await page.locator('#mustela-close').click();
      await iocHighlights(page).click();
      await expect(page.getByLabel('TLP', { exact: true })).toBeEnabled();
    }
    await choose(page, 'red');
    for (const status of [403, 429, 503, 'timeout']) {
      await worker.evaluate((status) => { globalThis.addStatus = status; }, status);
      const count = await worker.evaluate(() => globalThis.adds.length);
      await page.locator('#mustela-add-misp').click();
      await expect(page.locator('#mustela-note-status')).toContainText(status === 'timeout' ? 'Timed out' : `MISP HTTP ${status}`);
      await expect(page.locator('#mustela-add-misp')).toBeEnabled();
      await expect(page.getByLabel('TLP', { exact: true })).toHaveValue('red');
      await expect(page.locator('#mustela-analyst-note')).toHaveValue('Keep note on failure.');
      expect(await worker.evaluate(() => globalThis.adds.length)).toBe(count + 1);
    }
    expect(await worker.evaluate(() => globalThis.lookupBodies.some((body) => 'tlp' in body || 'Tag' in body))).toBe(false);
    await worker.evaluate(() => { globalThis.addStatus = 0; });
    await page.locator('#mustela-add-misp').click();
    await expect(page.locator('#mustela-add-misp')).toHaveText('Added to MISP');
  } finally { await extension.close(); }
});
