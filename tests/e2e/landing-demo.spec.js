import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startLandingServer } from '../helpers/landing-server.js';

let server;
test.beforeAll(async () => { server = await startLandingServer(); });
test.afterAll(async () => { await server?.close(); });
const ip = page => page.getByRole('button', { name: 'Investigate IP 203.0.113.42', exact: true });
const domain = page => page.getByRole('button', { name: 'Investigate domain update.example.org', exact: true });

for (const [name, width, height, hasTouch, reducedMotion] of [
  ['desktop', 1440, 900, false, 'no-preference'], ['tablet', 768, 1024, false, 'no-preference'],
  ['mobile', 390, 844, true, 'no-preference'], ['reduced', 1440, 900, false, 'reduce']
]) {
  test(`manual panel, literal notes, download and clipboard fallback: ${name}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch, reducedMotion });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(r.url()); });
    page.on('request', r => requests.push(r.url()));
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Permission denied'); } } }));
    await page.goto(server.url);
    await ip(page).focus();
    expect(await ip(page).evaluate(el => getComputedStyle(el, '::after').content)).toBe('"IP"');
    expect(await ip(page).evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#source-count')).toHaveText('4/4 sources usable');
    await expect(page.locator('.provider-stack details')).toHaveCount(4);
    await expect(page.getByText('Not a maliciousness score.', { exact: false })).toBeAttached();
    await page.locator('#investigation').screenshot({ path: testInfo.outputPath(`ip-${name}.png`) });
    await testInfo.attach(`IP panel ${name}`, { path: testInfo.outputPath(`ip-${name}.png`), contentType: 'image/png' });
    if (hasTouch) await domain(page).tap(); else await domain(page).click();
    await expect(page.locator('#source-count')).toHaveText('2/2 sources usable');
    await expect(page.locator('.provider-stack details')).toHaveCount(2);
    expect(await domain(page).evaluate(el => getComputedStyle(el, '::after').content)).toBe('"DOMAIN"');
    await expect(page.locator('.provider-stack')).not.toContainText('Shodan');
    await expect(page.locator('.provider-stack')).not.toContainText('AbuseIPDB');
    await page.locator('#investigation').screenshot({ path: testInfo.outputPath(`domain-${name}.png`) });
    await testInfo.attach(`Domain panel ${name}`, { path: testInfo.outputPath(`domain-${name}.png`), contentType: 'image/png' });
    const note = '<img src=x onerror=alert(1)>' + ' long note '.repeat(1500);
    await page.locator('#analyst-note').fill(note);
    // Check the open panel, not just the previously validated static shell.
    for (const fallback of [false, true]) {
      const style = fallback ? await page.addStyleTag({ content: '.landing .demo-shell .mustela-panel {background:#161c26;backdrop-filter:none}' }) : null;
      const failures = await page.locator('#investigation').evaluate(panel => {
        const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
        const composite = (fg, bg) => fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
        const lum = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
        const failures = [];
        for (const el of panel.querySelectorAll('*')) {
          if (!el.getClientRects().length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
          const css = getComputedStyle(el), parents = [];
          for (let p = el; p; p = p.parentElement) parents.unshift(p);
          let bg = [8, 11, 17];
          for (const p of parents) bg = composite(rgb(getComputedStyle(p).backgroundColor), bg);
          const l = [lum(composite(rgb(css.color), bg)), lum(bg)].sort((a, b) => a - b);
          const ratio = (l[1] + .05) / (l[0] + .05);
          const large = parseFloat(css.fontSize) >= 24 || (parseFloat(css.fontSize) >= 18.66 && parseInt(css.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5)) failures.push({ text: el.textContent.slice(0, 40), ratio });
        }
        for (const el of panel.querySelectorAll('button, textarea, summary')) {
          if (!el.getClientRects().length) continue;
          const css = getComputedStyle(el), boundary = el.tagName === 'SUMMARY' ? el.parentElement : el;
          const border = rgb(getComputedStyle(boundary).borderTopColor), parents = [];
          for (let p = boundary.parentElement; p; p = p.parentElement) parents.unshift(p);
          let bg = [8, 11, 17];
          for (const p of parents) bg = composite(rgb(getComputedStyle(p).backgroundColor), bg);
          const l = [lum(composite(border, bg)), lum(bg)].sort((a, b) => a - b);
          if ((l[1] + .05) / (l[0] + .05) < 3) failures.push({ control: el.tagName, boundary: 'contrast below 3' });
          if (parseFloat(css.minHeight) < 44 && el.tagName !== 'TEXTAREA') failures.push({ control: el.tagName, target: 'below 44px' });
        }
        return failures;
      });
      expect(failures).toEqual([]);
      await style?.evaluate(el => el.remove());
    }
    await page.getByRole('button', { name: 'Copy export', exact: true }).click();
    await expect(page.locator('#copy-fallback')).toBeVisible();
    await expect(page.locator('#note-status')).toContainText('Clipboard unavailable');
    await expect(page.locator('#note-status')).not.toContainText('Copied');
    const fallback = JSON.parse(await page.locator('#copy-fallback').inputValue());
    expect(fallback.analystNote).toBe(note);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const download = await downloadEvent;
    const payload = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(payload).toEqual(fallback); expect(payload.fictional).toBe(true);
    expect(payload.sources.map(s => s.name)).toEqual(['VirusTotal', 'MISP']);
    expect(await page.locator('#investigation img').count()).toBe(0);
    await ip(page).click(); await page.locator('#analyst-note').fill('IP note');
    await domain(page).click(); await expect(page.locator('#analyst-note')).toHaveValue(note);
    await page.getByRole('button', { name: 'Add to MISP', exact: true }).click();
    await expect(page.locator('#note-status')).toContainText('no IOC sent');
    await page.locator('#investigation').screenshot({ path: testInfo.outputPath(`actions-${name}.png`) });
    await testInfo.attach(`Actions and long note ${name}`, { path: testInfo.outputPath(`actions-${name}.png`), contentType: 'image/png' });
    await page.screenshot({ path: testInfo.outputPath(`panel-${name}.png`), fullPage: true });
    await testInfo.attach(`Panel ${name} — not final site`, { path: testInfo.outputPath(`panel-${name}.png`), contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape'); await expect(page.locator('#investigation')).toBeHidden();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(6000); await expect(page.locator('#investigation')).toBeHidden();
    expect(requests.every(url => url.startsWith(server.url))).toBe(true); expect(errors).toEqual([]);
    await context.close();
  });
}

test('guide progresses then cancels immediately on sources, notes, close and replay', async ({ page }) => {
  await page.clock.install(); await page.goto(server.url);
  await page.locator('#demo').scrollIntoViewIfNeeded();
  await page.clock.runFor(400);
  await expect(page.locator('.guide-pointer')).toBeVisible();
  await page.clock.runFor(650); await expect(page.locator('.panel-loading')).toBeVisible();
  await page.clock.runFor(800); await expect(page.locator('[data-reveal="3"]').first()).toBeVisible();
  await expect(page.locator('.provider-stack')).toBeHidden();
  await page.clock.runFor(1500); await expect(page.locator('.provider-stack')).toBeVisible();
  await page.locator('.provider-stack summary').last().click();
  await page.clock.runFor(10000);
  await expect(page.locator('.demo-shell')).toHaveAttribute('data-stage', '4');
  await page.getByRole('button', { name: 'Take action', exact: true }).click();
  await page.locator('#analyst-note').fill('My decision'); await page.clock.runFor(10000);
  await expect(page.locator('#analyst-note')).toHaveValue('My decision');
  await page.getByRole('button', { name: 'Replay guide', exact: true }).click();
  await page.clock.runFor(1100); await expect(page.locator('.panel-loading')).toBeVisible();
  await page.getByRole('button', { name: 'Close investigation', exact: true }).click();
  await page.clock.runFor(10000); await expect(page.locator('#investigation')).toBeHidden();
  await ip(page).click(); await expect(page.locator('#analyst-note')).toHaveValue('My decision');
});

test('offscreen, hidden, reduced motion and explicit pause compose without resetting', async ({ page }) => {
  await page.clock.install(); await page.goto(server.url); await page.locator('#demo').scrollIntoViewIfNeeded();
  await page.clock.runFor(2000);
  await expect(page.locator('.demo-shell')).toHaveAttribute('data-stage', '3');
  await page.getByRole('button', { name: 'Pause guide', exact: true }).click();
  await page.locator('#install').scrollIntoViewIfNeeded(); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(10000);
  await page.locator('#demo').scrollIntoViewIfNeeded();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.clock.runFor(10000);
  await expect(page.locator('.demo-shell')).toHaveAttribute('data-stage', '3');
  await page.getByRole('button', { name: 'Resume guide', exact: true }).click(); await page.clock.runFor(1500);
  await expect(page.locator('.demo-shell')).toHaveAttribute('data-stage', '4');
  await page.locator('#install').scrollIntoViewIfNeeded();
  await expect(page.locator('.demo-shell')).toHaveAttribute('data-suspended', 'true');
  await page.clock.runFor(10000);
  await expect(page.locator('.demo-shell')).toHaveAttribute('data-stage', '4');
  await page.locator('#demo').scrollIntoViewIfNeeded(); await page.clock.runFor(2500);
  await expect(page.locator('.demo-shell')).toHaveAttribute('data-stage', '5');
});

test('successful clipboard and late completion respect selection and close', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: text => {
      window.copiedText = text;
      return window.deferCopy ? new Promise(resolve => { window.finishCopy = resolve; }) : Promise.resolve();
    } } });
  });
  await page.goto(server.url); await ip(page).click();
  await page.getByRole('button', { name: 'Copy selected example indicator' }).click();
  await expect(page.locator('#note-status')).toHaveText('Copied example data.');
  expect(await page.evaluate(() => window.copiedText)).toBe('203.0.113.42');
  await page.evaluate(() => { window.deferCopy = true; });
  await page.getByRole('button', { name: 'Copy export', exact: true }).click();
  await domain(page).click(); await page.evaluate(() => window.finishCopy());
  await expect(page.locator('#note-status')).toHaveText('Demo note stays in this session only.');
  await page.getByRole('button', { name: 'Copy export', exact: true }).click();
  await page.getByRole('button', { name: 'Close investigation', exact: true }).click();
  await page.evaluate(() => window.finishCopy());
  await expect(page.locator('#investigation')).toBeHidden();
  await expect(domain(page)).toBeFocused();
});

test('real permitted clipboard over HTTP and keyboard provider disclosure', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(server.url); await ip(page).focus(); await page.keyboard.press('Enter');
  const source = page.locator('.provider-stack details').nth(1);
  await source.locator('summary').focus();
  expect(await source.locator('summary').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter'); await expect(source).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Copy export', exact: true }).click();
  await expect(page.locator('#note-status')).toHaveText('Copied example data.');
  const data = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(data.ioc.value).toBe('203.0.113.42'); expect(data.sources).toHaveLength(4);
});
