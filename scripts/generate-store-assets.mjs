import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { launchExtensionContext, getServiceWorker, openPopup, bindPopupToTab, iocHighlights } from '../tests/e2e/support/extensionHarness.js';

const root = new URL('../', import.meta.url);
const output = new URL('docs/store/assets/', root);
const fixture = (name) => fs.readFile(new URL(`tests/fixtures/store/${name}`, root), 'utf8');
const fixedTime = '2026-01-01T12:00:00.000Z';
const reportUrl = 'https://report.example.org/brief';
const still = '* { animation: none !important; transition: none !important; caret-color: transparent !important; }';
const extension = await launchExtensionContext();
try {
  const { context, extensionId } = extension;
  const report = await fixture('report.html');
  // Fail closed: only the reserved report origin is served, entirely from disk.
  await context.route('**/*', async (route) => {
    if (route.request().url() === reportUrl) return route.fulfill({ contentType: 'text/html', body: report });
    if (route.request().url().startsWith(`chrome-extension://${extensionId}/`)) return route.continue();
    return route.abort('blockedbyclient');
  });
  const worker = await getServiceWorker(context);
  await worker.evaluate(async () => {
    globalThis.fetch = async () => { throw new Error('Store capture forbids network requests'); };
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });
  await fs.mkdir(output, { recursive: true });
  const save = async (page, name) => {
    await page.addStyleTag({ content: still });
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: fileURLToPath(new URL(name, output)), animations: 'disabled', caret: 'hide' });
  };
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(reportUrl);
  await expect.poll(() => iocHighlights(page).count()).toBeGreaterThanOrEqual(5);
  await save(page, '01-highlights.png');
  await iocHighlights(page, 'main', 'signal.example.org').click();
  await expect(page.locator('.mustela-panel')).toBeVisible();
  await expect(page.locator('.mustela-panel')).not.toContainText('Loading…');
  await expect(page.locator('.mustela-panel')).toContainText('signal.example.org');
  await save(page, '02-investigation.png');

  // A fixed local history record, not invented provider intelligence.
  await worker.evaluate(async ({ fixedTime, reportUrl }) => {
    await chrome.storage.local.set({ mustela_history: [{
      ioc: { type: 'domain', raw: 'signal.example.org', normalized: 'signal.example.org' },
      firstSeen: fixedTime, lastSeen: fixedTime, seenCount: 1, overallVerdict: 'unknown',
      pageUrl: reportUrl, pageTitle: 'Synthetic incident brief',
      analystNote: 'Synthetic training indicator. No live enrichment.', tlp: 'clear'
    }] });
  }, { fixedTime, reportUrl });
  const popup = await openPopup(context, extensionId);
  await popup.clock.setFixedTime(new Date(fixedTime));
  await popup.setViewportSize({ width: 368, height: 680 });
  await bindPopupToTab(context, popup, page);
  await expect(popup.locator('#summaryBadge')).toContainText('IOC');
  await expect(popup.locator('#globalPauseBtn')).toBeEnabled();
  await popup.addStyleTag({ content: still });
  const clipPopup = async () => {
    await popup.mouse.move(0, 0);
    await popup.evaluate(() => document.fonts.ready);
    let previous;
    let current;
    // Wait for asynchronous popup hydration and compositor painting to settle.
    await expect.poll(async () => {
      current = await popup.screenshot({ animations: 'disabled', caret: 'hide' });
      const stable = previous?.equals(current) || false;
      previous = current;
      return stable;
    }).toBe(true);
    return current.toString('base64');
  };
  const active = await clipPopup();
  await popup.locator('#historyBadge').scrollIntoViewIfNeeded();
  await expect(popup.locator('#historyList')).toContainText('signal.example.org');
  const history = await clipPopup();

  const artwork = await context.newPage();
  const artworkHtml = await fixture('artwork.html');
  const logo = (await fs.readFile(new URL('public/icons/icon128.png', root))).toString('base64');
  const frame = async (name, heading, description, images = [], promo = false) => {
    await artwork.setViewportSize(promo ? { width: 440, height: 280 } : { width: 1280, height: 800 });
    await artwork.setContent(artworkHtml);
    await artwork.evaluate(({ heading, description, images, logo, promo }) => {
      document.body.className = promo ? 'promo' : images.length === 2 ? 'pair' : '';
      document.querySelector('#heading').textContent = heading;
      document.querySelector('#description').textContent = description;
      document.querySelector('#logo').src = `data:image/png;base64,${logo}`;
      if (promo) document.querySelector('#disclaimer').remove();
      for (const { label, data } of images) {
        const figure = document.createElement('figure');
        const caption = document.createElement('figcaption');
        caption.textContent = label;
        const image = document.createElement('img');
        image.className = 'capture';
        image.src = `data:image/png;base64,${data}`;
        figure.append(caption, image);
        document.querySelector('.captures').append(figure);
      }
    }, { heading, description, images, logo, promo });
    await artwork.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    await save(artwork, name);
  };
  await frame('03-popup-history.png', 'Detected here.\nRemembered locally.', 'Copy an indicator, start an investigation or revisit local history. Two views of the same toolbar popup.', [
    { label: 'Current page · popup top', data: active }, { label: 'Local history · popup scrolled', data: history }
  ]);
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1280, height: 800 });
  await settings.goto(`chrome-extension://${extensionId}/src/welcome/welcome.html`);
  await expect(settings.locator('input[type="password"]').first()).toHaveValue('');
  await settings.getByRole('heading', { name: 'Providers', exact: true }).evaluate((heading) => heading.closest('.section-block').scrollIntoView({ block: 'start' }));
  for (const input of await settings.locator('input[type="password"]').all()) await expect(input).toHaveValue('');
  await save(settings, '04-settings.png');

  await popup.evaluate(() => window.scrollTo(0, 0));
  await popup.locator('#globalPauseBtn').click();
  await expect(popup.locator('#globalPauseBtn')).toHaveAttribute('aria-pressed', 'false');
  await expect(popup.locator('#pauseStatus')).toHaveText('OFF confirmed on all pages.');
  await expect(popup.locator('#globalPauseBtn')).toBeEnabled();
  const paused = await clipPopup();
  await frame('05-global-pause.png', 'One switch.\nAll pages.', 'ON keeps Mustela active. OFF removes annotations and blocks new sends. Resuming never replays investigations.', [
    { label: 'ON · active', data: active }, { label: 'OFF · globally paused', data: paused }
  ]);
  await frame('promo-small.png', 'Investigate IOC.\nStay in context.', 'Local detection. Optional enrichment.', [], true);
  console.log('Generated five 1280×800 screenshots and one 440×280 promotional tile in docs/store/assets/.');
} finally {
  await extension.close();
}
