import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, bindPopupToTab, getServiceWorker, iocHighlights } from './support/extensionHarness.js';

async function settingsPage(extension) {
  const settings = await extension.context.newPage();
  await settings.goto(`chrome-extension://${extension.extensionId}/src/welcome/welcome.html`);
  await expect(settings.locator('#saveExclusions')).toBeEnabled();
  return settings;
}
async function addRule(settings, kind, value, type = 'ip') {
  await settings.locator('#addExclusion').click();
  const row = settings.locator('.exclusion-row').last();
  await row.getByLabel('Rule kind').selectOption(kind);
  if (kind === 'ioc') await row.getByLabel('IOC type').selectOption(type);
  await row.getByLabel('Rule value').fill(value);
}
async function save(settings) {
  await settings.locator('#saveExclusions').click();
  await expect(settings.locator('#exclusionStatus')).toContainText('Exclusions saved locally');
}
const send = (page, type, payload) => page.evaluate(({ type, payload }) => chrome.runtime.sendMessage({ type, payload }), { type, payload });

test('keyless editor validates atomically, propagates exact IOC edits to multiple tabs and persists across restart', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const first = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    const second = await openFixturePage(extension.context, server.urlFor('/dynamic-iocs.html'));
    await expect.poll(() => iocHighlights(first, 'html', '8.8.8.8').count()).toBeGreaterThan(0);
    const settings = await settingsPage(extension);
    await addRule(settings, 'ioc', '8[.]8[.]8[.]8');
    await save(settings);
    await expect.poll(() => iocHighlights(first, 'html', '8.8.8.8').count()).toBe(0);
    await second.evaluate(() => { const p = document.createElement('p'); p.id = 'dynamic-exclusions'; p.textContent = '8.8.8.8 and 1.1.1.1'; document.body.append(p); });
    await expect.poll(() => iocHighlights(second, '#dynamic-exclusions').texts()).toEqual(['1.1.1.1']);
    const popup = await bindPopupToTab(extension.context, await openPopup(extension.context, extension.extensionId), first);
    await expect(popup.locator('#iocList')).not.toContainText('8.8.8.8');
    await addRule(settings, 'host', '/.*/');
    await settings.locator('#saveExclusions').click();
    await expect(settings.locator('#exclusionStatus')).toContainText('Rule 2 is invalid');
    expect((await send(settings, 'GET_EXCLUSIONS')).data.rules).toHaveLength(1);
    await settings.locator('.exclusion-row').last().getByRole('button', { name: 'Remove', exact: true }).click();
    await settings.locator('.exclusion-row').getByLabel('Rule value').fill('1.1.1.1');
    await save(settings);
    await expect.poll(() => iocHighlights(second, '#dynamic-exclusions').texts()).toEqual(['8.8.8.8']);
    await expect(popup.locator('#iocList')).toContainText('8.8.8.8');
    await extension.restart();
    const restored = await settingsPage(extension);
    await expect(restored.locator('.exclusion-row').getByLabel('Rule value')).toHaveValue('1.1.1.1');
    await restored.locator('.exclusion-row').getByRole('button', { name: 'Remove', exact: true }).click();
    await save(restored);
    const allowed = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    await expect.poll(() => iocHighlights(allowed, 'html', '8.8.8.8').count()).toBeGreaterThan(0);
  } finally { await extension.close(); await server.close(); }
});

test('exact page and host exclusions clear stale results, block outputs with rule feedback, and require explicit removal', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    await expect.poll(() => iocHighlights(page).count()).toBeGreaterThan(0);
    const popup = await bindPopupToTab(extension.context, await openPopup(extension.context, extension.extensionId), page);
    const settings = await settingsPage(extension);
    const worker = await getServiceWorker(extension.context);
    await worker.evaluate(() => {
      globalThis.outputs = [];
      globalThis.fetch = async (url) => { outputs.push(String(url)); throw new Error('Unexpected network'); };
      chrome.tabs.create = async (details) => { outputs.push(details.url); return { id: 999 }; };
    });
    await addRule(settings, 'page-url', page.url());
    await save(settings);
    await expect.poll(() => iocHighlights(page).count()).toBe(0);
    await expect(popup.locator('#exclusionStatus')).toContainText(page.url());
    await expect(popup.locator('#toggleBtn')).toBeDisabled();
    await expect(popup.locator('#iocList li')).toHaveCount(0);
    await page.evaluate(() => { const p = document.createElement('p'); p.textContent = '9.9.9.9'; document.body.append(p); });
    const reloaded = await openFixturePage(extension.context, page.url());
    await expect.poll(() => reloaded.evaluate(() => document.documentElement.dataset.mustelaInjected)).toBe('true');
    await expect.poll(() => iocHighlights(reloaded).count()).toBe(0);
    const blocked = await send(settings, 'OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc: { type: 'ip', normalized: '8.8.8.8', sourceContext: { pageUrl: page.url() } } });
    expect(blocked.code).toBe('MUSTELA_EXCLUDED');
    expect(blocked.error).toContain(page.url());
    expect(blocked.error).toContain('settings');
    expect(await worker.evaluate(() => outputs)).toEqual([]);
    await settings.locator('.exclusion-row').getByLabel('Rule kind').selectOption('host');
    await settings.locator('.exclusion-row').getByLabel('Rule value').fill('127.0.0.1');
    await save(settings);
    await expect.poll(() => iocHighlights(page).count()).toBe(0);
    await expect(popup.locator('#exclusionStatus')).toContainText('host rule: 127.0.0.1');
    await settings.locator('.exclusion-row').getByRole('button', { name: 'Remove', exact: true }).click();
    await save(settings);
    await expect.poll(() => iocHighlights(page).count()).toBeGreaterThan(0);
    await expect(popup.locator('#toggleBtn')).toBeEnabled();
    expect(await worker.evaluate(() => outputs)).toEqual([]);
    const allowed = await send(settings, 'OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc: { type: 'ip', normalized: '8.8.8.8' } });
    expect(allowed.ok).toBe(true);
    expect(await worker.evaluate(() => outputs.length)).toBe(1);
  } finally { await extension.close(); await server.close(); }
});
