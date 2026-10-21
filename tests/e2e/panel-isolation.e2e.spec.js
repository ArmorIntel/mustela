import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, getServiceWorker, iocHighlights } from './support/extensionHarness.js';

let server;
test.beforeAll(async () => { server = await startFixtureServer(); });
test.afterAll(async () => { await server.close(); });

test('closed panel resists hostile CSS and keeps result renders out of page DOM', async () => {
  const extension = await launchExtensionContext();
  try {
    const page = await openFixturePage(extension.context, server.urlFor('/hostile-styles.html'));
    await page.evaluate(() => {
      window.leakedMutations = [];
      window.leakedDownloadLinks = [];
      new MutationObserver(records => {
        for (const r of records) {
          window.leakedMutations.push(r.target.textContent, ...[...r.addedNodes].map(n => n.textContent));
          for (const node of r.addedNodes) if (node.matches?.('a[download]')) window.leakedDownloadLinks.push(node.href);
        }
      }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      window.leakedInputs = [];
      document.addEventListener('input', e => window.leakedInputs.push(e.data || e.target.value || 'input'));
    });
    await iocHighlights(page).click();
    const panel = page.locator('.mustela-panel');
    await expect(panel).toContainText('Global verdict');
    await expect(page.getByRole('dialog', { name: 'Mustela investigation' })).toBeVisible();
    await expect(page.locator('#mustela-close')).toBeVisible();
    const host = await panel.evaluate(el => {
      const root = el.getRootNode();
      return { mode: root.mode, id: root.host?.id, className: root.host?.className, all: root.host && getComputedStyle(root.host).all };
    });
    expect(host).toMatchObject({ mode: 'closed', id: '', className: '' });
    const accessibility = await extension.context.newCDPSession(page);
    const { nodes } = await accessibility.send('Accessibility.getFullAXTree');
    expect(nodes.some(n => n.role?.value === 'dialog' && n.name?.value === 'Mustela investigation')).toBe(true);
    expect(nodes.some(n => n.role?.value === 'textbox' && n.name?.value === 'Analyst note')).toBe(true);
    const note = page.locator('#mustela-analyst-note');
    await note.fill('Private investigation note');
    await note.blur();
    await expect(page.locator('#mustela-note-status')).toContainText('Note saved locally');
    await page.getByLabel('TLP', { exact: true }).selectOption('red');
    await expect(page.locator('#mustela-tlp-status')).toContainText('saved locally');
    const visible = await panel.screenshot({ animations: 'disabled' });
    await page.evaluate(() => {
      document.querySelector('style').remove();
      document.documentElement.style.background = 'white';
    });
    expect((await panel.screenshot({ animations: 'disabled' })).equals(visible), 'hostile and neutral panel screenshots match pixel-for-pixel').toBe(true);
    const privacy = await page.evaluate(() => ({
      selectors: document.querySelectorAll('.mustela-panel, .mustela-page-indicator, [id^="mustela-"]').length,
      text: document.documentElement.innerText,
      html: document.documentElement.innerHTML,
      openRoots: [...document.querySelectorAll('*')].filter(el => el.shadowRoot).length,
      mutations: window.leakedMutations.join(' '),
      inputs: window.leakedInputs
    }));
    expect(privacy.selectors).toBe(0);
    expect(privacy.openRoots).toBe(0);
    for (const value of [privacy.text, privacy.html, privacy.mutations]) expect(value).not.toMatch(/Global verdict|Private investigation note|Sharing label saved|TLP:RED/);
    expect(privacy.inputs).toEqual([]);
    await page.locator('#mustela-copy-export').click();
    await expect(page.locator('#mustela-copy-export')).toHaveText('Copied export');
    expect(JSON.parse(await page.locator('#mustela-copy-export').getAttribute('data-copy-payload')).analystNote).toBe('Private investigation note');
    const downloading = page.waitForEvent('download');
    await page.locator('#mustela-download-export').click();
    expect((await downloading).suggestedFilename()).toMatch(/\.json$/);
    expect(await page.evaluate(() => window.leakedDownloadLinks)).toEqual([]);
    await page.locator('#mustela-rerun').click();
    await expect(note).toHaveValue('Private investigation note');
    await page.locator('#mustela-close').focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  } finally { await extension.close(); }
});

test('keyboard enters the closed dialog, activates controls and restores prior page focus', async () => {
  const extension = await launchExtensionContext();
  try {
    const page = await openFixturePage(extension.context, server.urlFor('/hostile-styles.html'));
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'page-focus';
      document.body.append(input);
      input.focus();
    });
    const worker = await getServiceWorker(extension.context);
    await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL' });
    }, page.url());
    await expect(page.getByRole('dialog', { name: 'Mustela investigation' })).toBeVisible();
    await expect(page.locator('#mustela-close')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.mustela-ioc-value')).toBeFocused();
    await page.locator('#mustela-manual-input').fill('8.8.8.8');
    await page.keyboard.press('Enter');
    await expect(page.locator('.mustela-panel')).toContainText('Global verdict');
    await page.keyboard.press('Escape');
    await expect(page.locator('.mustela-panel')).toHaveCount(0);
    await expect(page.locator('#page-focus')).toBeFocused();
  } finally { await extension.close(); }
});

test('reduced transparency removes the only panel backdrop filter', async () => {
  const extension = await launchExtensionContext();
  try {
    const page = await openFixturePage(extension.context, server.urlFor('/hostile-styles.html'));
    await iocHighlights(page).click();
    const panel = page.locator('.mustela-panel');
    await expect(panel).toContainText('Global verdict');
    expect(await panel.evaluate(el => [el, ...el.querySelectorAll('*')].filter(n => getComputedStyle(n).backdropFilter !== 'none').length)).toBe(1);
    const session = await extension.context.newCDPSession(page);
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await expect(panel).toHaveCSS('backdrop-filter', 'none');
    expect(await panel.evaluate(el => getComputedStyle(el).backgroundColor)).toMatch(/^rgb\(/);
    const worker = await getServiceWorker(extension.context);
    expect(await worker.evaluate(() => chrome.runtime.getManifest().permissions)).not.toContain('debugger');
  } finally { await extension.close(); }
});
