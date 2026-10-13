import { test, expect } from '@playwright/test';
import { startLandingServer } from '../helpers/landing-server.js';

let server;
test.beforeAll(async () => { server = await startLandingServer(); });
test.afterAll(async () => { await server?.close(); });

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844, hasTouch: true },
  { name: 'reduced-motion', width: 1440, height: 900, reducedMotion: 'reduce' }
];

for (const { name, width, height, hasTouch = false, reducedMotion = 'no-preference' } of viewports) {
  test(`static landing shell over HTTP: ${name}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => errors.push(request.url()));
    page.on('request', request => requests.push(request.url()));
    await page.goto(server.url);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Investigate threats.Stay in context.');
    expect(await page.locator('main > section').evaluateAll(sections => sections.map(section => section.className))).toEqual([
      'hero', 'chapter detection', 'product', 'chapter enrichment', 'chapter action', 'chapter ai', 'privacy', 'closing'
    ]);
    await expect(page.getByText('Static preparation only.', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Installation instructions' })).toHaveAttribute('href', 'https://github.com/ArmorIntel/mustela#installation');
    expect(await page.locator('.brand img').evaluate(img => img.complete && img.naturalWidth === 128)).toBe(true);
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(8, 11, 17)');
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily)).toContain('system-ui');
    // All internal links resolve, IDs are unique and every section has a heading label.
    expect(await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      return ids.length === new Set(ids).size && [...document.querySelectorAll('a[href^="#"]')].every(a => document.getElementById(a.hash.slice(1))) && [...document.querySelectorAll('main > section')].every(el => document.getElementById(el.getAttribute('aria-labelledby')));
    })).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    expect(await page.locator(':focus').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    const install = page.locator('.hero .button').first();
    if (hasTouch) await install.tap(); else await install.click();
    await expect(page).toHaveURL(`${server.url}#install`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Contrast is checked for rendered text on composite ancestor surfaces.
    // Test both supported translucency and the deliberately opaque fallback.
    for (const fallback of [false, true]) {
      if (fallback) await page.addStyleTag({ content: '.landing .demo-shell .example-ioc {background:#b5c2d9;backdrop-filter:none}' });
      const contrastFailures = await page.evaluate(() => {
        const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
        const composite = (fg, bg) => fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
        const luminance = color => color.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const failures = [];
        for (const el of document.querySelectorAll('body *')) {
          if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
          const style = getComputedStyle(el);
          if (style.display === 'none' || !el.getClientRects().length || el.closest('.skip-link')) continue;
          let background = [8, 11, 17];
          const parents = [];
          for (let parent = el; parent; parent = parent.parentElement) parents.unshift(parent);
          for (const parent of parents) background = composite(rgb(getComputedStyle(parent).backgroundColor), background);
          // The white gradient can only increase the contrast of this dark label;
          // the opaque base is the conservative minimum and fallback surface.
          const foreground = composite(rgb(style.color), background);
          const l = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
          const ratio = (l[1] + .05) / (l[0] + .05);
          const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5)) failures.push({ text: el.textContent.slice(0, 50), ratio });
        }
        return failures;
      });
      expect(contrastFailures).toEqual([]);
    }
    // CSS isolation: a sibling specimen outside the page root keeps native styles.
    expect(await page.evaluate(() => {
      const outside = document.createElement('article');
      outside.innerHTML = '<h1>Host heading</h1><div class="demo-shell"><div class="report">Host report</div></div>';
      document.body.classList.remove('landing');
      document.body.append(outside);
      const snapshot = () => [...outside.querySelectorAll('*')].map(el => {
        const s = getComputedStyle(el);
        return [s.fontSize, s.backgroundColor, s.display, s.padding, s.borderRadius];
      });
      const before = JSON.stringify(snapshot());
      const isolated = document.createElement('div');
      isolated.className = 'landing';
      isolated.innerHTML = outside.innerHTML;
      document.body.append(isolated);
      const after = JSON.stringify(snapshot());
      isolated.remove();
      outside.remove();
      document.body.classList.add('landing');
      return before === after;
    })).toBe(true);
    await page.goto(server.url);
    await page.screenshot({ path: testInfo.outputPath(`shell-${name}-not-final.png`), fullPage: true });
    await testInfo.attach(`Static shell — ${name} — not final delivery`, { path: testInfo.outputPath(`shell-${name}-not-final.png`), contentType: 'image/png' });
    expect(requests.every(url => url.startsWith(server.url))).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
}
