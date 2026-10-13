import { test, expect } from '@playwright/test';
import { startLandingServer } from '../helpers/landing-server.js';
let server;
test.beforeAll(async () => { server = await startLandingServer(); });
test.afterAll(async () => { await server?.close(); });

for (const [name, width, height, hasTouch, reducedMotion] of [
  ['desktop', 1440, 900, false, 'no-preference'], ['tablet', 768, 1024, false, 'no-preference'],
  ['mobile', 390, 844, true, 'no-preference'], ['reduced', 1440, 900, false, 'reduce']
]) {
  test(`complete narrative and accessible variants: ${name}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch, reducedMotion });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(r.url()); });
    page.on('request', r => requests.push(r.url()));
    await page.goto(server.url);
    await expect(page.locator('#signal')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`hero-${name}.png`) });
    for (const [selector, key, variants] of [
      ['.detection', 'type', ['IP', 'DOMAIN', 'HASH']], ['.action', 'action', ['NOTE', 'JSON', 'MISP']]
    ]) {
      const section = page.locator(selector);
      for (const variant of variants) {
        const button = section.locator(`[data-${key}="${variant}"]`);
        if (hasTouch) await button.tap(); else { await button.focus(); await page.keyboard.press('Enter'); }
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(section.locator('canvas')).toHaveAttribute('data-variant', variant);
        if (!hasTouch) expect(await button.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
        expect(await button.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        await expect(section.locator('.scene-description')).not.toBeEmpty();
        await expect(section.locator('canvas')).toHaveAttribute('data-progress', '1.000');
        await section.screenshot({ path: info.outputPath(`${key}-${variant}-${name}.png`) });
      }
      await section.screenshot({ path: info.outputPath(`${key}-${name}.png`) });
    }
    await page.locator('.enrichment').scrollIntoViewIfNeeded();
    await page.locator('.enrichment').screenshot({ path: info.outputPath(`sources-${name}.png`) });
    await page.locator('#analyst-assist').scrollIntoViewIfNeeded();
    await expect(page.locator('#thinking-orb')).toHaveAttribute('data-stage', 'ready', { timeout: 20000 });
    await expect(page.locator('#ai-output')).toBeVisible();
    await page.locator('#analyst-assist').screenshot({ path: info.outputPath(`assist-${name}.png`) });
    await page.screenshot({ path: info.outputPath(`complete-${name}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(requests.every(url => url.startsWith(server.url))).toBe(true); expect(errors).toEqual([]);
    await context.close();
  });
}

test('cached page restoration resumes scenes without losing user pause', async ({ page }) => {
  await page.clock.install(); await page.goto(server.url); await page.clock.runFor(100);
  const signal = page.locator('#signal');
  await expect(signal).toHaveAttribute('data-running', 'true');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(signal).toHaveAttribute('data-running', 'false');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.clock.runFor(100); await expect(signal).toHaveAttribute('data-running', 'true');
  await page.locator('#motion').click();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.clock.runFor(100); await expect(signal).toHaveAttribute('data-running', 'false');
  await page.locator('#demo').scrollIntoViewIfNeeded();
  await page.locator('#play').click(); await page.clock.runFor(3000);
  const scene = page.locator('.demo-shell');
  const stage = await scene.getAttribute('data-stage');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.clock.runFor(10000); await expect(scene).toHaveAttribute('data-stage', stage);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.clock.runFor(10000); await expect(scene).toHaveAttribute('data-stage', '5');
});

test('fine pointer responds then returns progressively to idle', async ({ page }) => {
  await page.goto(server.url);
  const signal = page.locator('#signal');
  await signal.hover(); await expect(signal).toHaveAttribute('data-motion', 'pointer');
  await page.mouse.move(5, 5); await expect(signal).toHaveAttribute('data-motion', 'idle');
  for (const selector of ['.detection canvas', '.enrichment canvas', '.action canvas', '#thinking-orb']) {
    const canvas = page.locator(selector); await canvas.hover();
    await expect(canvas).toHaveAttribute('data-pointer', 'active');
    await page.mouse.move(5, 5); await expect(canvas).toHaveAttribute('data-pointer', 'idle');
  }
});

test('correlation follows all five narrative stages', async ({ page }, info) => {
  await page.clock.install(); await page.goto(server.url);
  await page.locator('#analyst-assist').scrollIntoViewIfNeeded();
  await page.clock.runFor(100);
  await page.locator('#ai-example').click();
  for (const [stage, advance] of [['link', 0], ['absorb', 1800], ['mix', 2400], ['emit', 2700], ['ready', 2500]]) {
    await page.clock.runFor(advance);
    await expect(page.locator('#thinking-orb')).toHaveAttribute('data-stage', stage);
    await page.locator('#analyst-assist').screenshot({ path: info.outputPath(`correlation-${stage}.png`) });
  }
});

test('scene suspension preserves manual pause, correlation progress and closed demo', async ({ page }) => {
  // Exercise native media/visibility delivery with the real browser clock.
  // Synthetic frame advancement does not synchronize Chromium media events.
  await page.goto(server.url);
  const setMotion = async reducedMotion => {
    await page.emulateMedia({ reducedMotion });
    // Emulation returns before the scene preference listeners have run.
    for (const selector of ['#motion', '#orb-pause']) {
      if (reducedMotion === 'reduce') await expect(page.locator(selector)).toBeDisabled();
      else await expect(page.locator(selector)).toBeEnabled();
    }
  };
  const signal = page.locator('#signal');
  await expect(signal).toHaveAttribute('data-running', 'true');
  await page.locator('#motion').click();
  await setMotion('reduce');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.locator('#install').scrollIntoViewIfNeeded(); await page.waitForTimeout(1000);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await setMotion('no-preference');
  await page.locator('.hero').scrollIntoViewIfNeeded();
  await expect(signal).toHaveAttribute('data-running', 'false');
  await expect(page.locator('#motion')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#motion').click(); await expect(signal).toHaveAttribute('data-running', 'true');
  await page.locator('#analyst-assist').scrollIntoViewIfNeeded();
  const orb = page.locator('#thinking-orb'); await expect(orb).toHaveAttribute('data-stage', 'mix');
  await page.locator('#orb-pause').click();
  const progress = await orb.getAttribute('data-progress');
  await setMotion('reduce');
  await expect(orb).toHaveAttribute('data-stage', 'ready');
  await setMotion('no-preference');
  // Observe a full continuation interval: explicit pause must freeze progress.
  await page.waitForTimeout(5000);
  await expect(orb).toHaveAttribute('data-progress', progress);
  await expect(orb).toHaveAttribute('data-running', 'false');
  await page.locator('#orb-pause').click(); await expect(orb).toHaveAttribute('data-stage', 'ready');
  await page.getByRole('button', { name: 'Investigate IP 203.0.113.42', exact: true }).click();
  await page.getByRole('button', { name: 'Close investigation', exact: true }).click();
  await setMotion('reduce'); await setMotion('no-preference');
  await page.waitForTimeout(10000); await expect(page.locator('#investigation')).toBeHidden();
  await page.locator('#install').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('canvas').evaluateAll(cs => cs.every(c => c.dataset.running === 'false'))).toBe(true);
});
