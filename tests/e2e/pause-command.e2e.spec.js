import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { launchExtensionContext, openPopup, getServiceWorker, startFixtureServer, openFixturePage, iocHighlights } from './support/extensionHarness.js';

// CDP key events do not reach Chrome extension accelerators. Use native X11
// delivery after assigning a shortcut through Chrome's own settings UI.
async function assignShortcut(extension) {
  const settings = await extension.context.newPage();
  await settings.goto('chrome://extensions/shortcuts');
  const entry = settings.locator('.command-entry').filter({ hasText: 'Toggle Mustela global pause' });
  await entry.getByRole('button', { name: 'Edit shortcut Toggle Mustela global pause for Mustela' }).click();
  await entry.locator('input').press('Control+Shift+Y');
  const worker = await getServiceWorker(extension.context);
  await expect.poll(async () => (await worker.evaluate(() => chrome.commands.getAll()))
    .find((entry) => entry.name === 'toggle-global-pause').shortcut).toBe('Ctrl+Shift+Y');
  await settings.close();
}
async function command(page) {
  await page.bringToFront();
  execFileSync('xdotool', ['key', '--clearmodifiers', 'ctrl+shift+y']);
}
const badge = (worker) => worker.evaluate(() => chrome.action.getBadgeText({}));
const control = (page) => page.locator('#globalPauseBtn');

test('command without popup clears keyless pages and panel; popup, badge and restart agree', async () => {
  const extension = await launchExtensionContext();
  const server = await startFixtureServer();
  try {
    const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    await expect.poll(() => iocHighlights(page).count()).toBeGreaterThan(0);
    const worker = await getServiceWorker(extension.context);
    await worker.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL' });
    }, page.url());
    await expect(page.locator('.mustela-panel')).toBeVisible();
    await assignShortcut(extension);
    await command(page);
    await expect.poll(() => iocHighlights(page).count()).toBe(0);
    await expect(page.locator('.mustela-panel')).toHaveCount(0);
    expect(await badge(worker)).toBe('OFF');
    const popup = await openPopup(extension.context, extension.extensionId);
    await expect(control(popup)).toHaveText('Mustela OFF — resume');
    await extension.restart();
    const next = await getServiceWorker(extension.context);
    await expect.poll(() => badge(next)).toBe('OFF');
    const reopened = await openPopup(extension.context, extension.extensionId);
    await expect(control(reopened)).toHaveText('Mustela OFF — resume');
    const fresh = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
    await expect.poll(() => fresh.locator('html').getAttribute('data-mustela-injected')).toBe('true');
    await expect.poll(() => iocHighlights(fresh).count()).toBe(0);
    await command(reopened);
    await expect(control(reopened)).toHaveText('Mustela ON — pause');
    await expect.poll(() => iocHighlights(fresh).count()).toBeGreaterThan(0);
    await expect(fresh.locator('.mustela-panel')).toHaveCount(0);
    expect(await badge(next)).toBe('ON');
  } finally { await extension.close(); await server.close(); }
});

test('failed command is visible in open and reopened popup with retry and no false OFF', async () => {
  const extension = await launchExtensionContext();
  try {
    const popup = await openPopup(extension.context, extension.extensionId);
    const worker = await getServiceWorker(extension.context);
    const commands = await worker.evaluate(() => chrome.commands.getAll());
    expect(commands.find((entry) => entry.name === 'toggle-global-pause').shortcut).toBe('');
    await expect(control(popup)).toBeEnabled();
    await expect(popup.locator('#pauseShortcuts')).toHaveAttribute('href', 'chrome://extensions/shortcuts');
    await assignShortcut(extension);
    await worker.evaluate(() => {
      globalThis.originalPauseSet = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async (values) => {
        if ('mustela_paused' in values) throw new Error('Storage unavailable. Please retry.');
        return originalPauseSet(values);
      };
    });
    await command(popup);
    await expect(popup.locator('#pauseStatus')).toContainText('retry');
    await expect(control(popup)).toHaveText('Mustela ON — pause');
    expect(await badge(worker)).toBe('ON');
    const reopened = await openPopup(extension.context, extension.extensionId);
    await expect(reopened.locator('#pauseStatus')).toContainText('retry');
    await worker.evaluate(() => { chrome.storage.local.set = originalPauseSet; });
    await reopened.locator('#pauseRetryBtn').click();
    await expect(control(reopened)).toHaveText('Mustela OFF — resume');
    await expect(control(popup)).toHaveText('Mustela OFF — resume');
    expect(await badge(worker)).toBe('OFF');
    await popup.locator('#pauseShortcuts').click();
    await expect.poll(() => extension.context.pages().some((entry) => entry.url() === 'chrome://extensions/shortcuts')).toBe(true);
  } finally { await extension.close(); }
});
