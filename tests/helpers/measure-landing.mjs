import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { startLandingServer } from '../helpers/landing-server.js';

// Optional local evidence run; not loaded by the page or shipped as telemetry.
const output = process.argv[2];
if (!output) throw new Error('Supply an output JSON path');
const server = await startLandingServer();
const browser = await chromium.launch({ headless: true });
const samples = [];
try {
  for (const [name, width, height, hasTouch, reducedMotion] of [
    ['desktop', 1440, 900, false, 'no-preference'], ['tablet', 768, 1024, false, 'no-preference'],
    ['mobile-emulated', 390, 844, true, 'no-preference'], ['reduced', 1440, 900, false, 'reduce']
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch, reducedMotion });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = window.requestAnimationFrame.bind(window);
      window.frameSamples = [];
      window.requestAnimationFrame = callback => original(now => {
        const start = performance.now(); callback(now);
        window.frameSamples.push(performance.now() - start);
      });
    });
    await page.goto(server.url);
    for (const section of ['.hero', '.detection', '.enrichment', '.action', '#analyst-assist', '#install']) {
      await page.locator(section).scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await page.evaluate(() => { window.frameSamples = []; });
      await page.waitForTimeout(2000);
      samples.push(await page.evaluate(({ name, section }) => {
        const values = window.frameSamples.slice().sort((a, b) => a - b);
        return { name, section, windowMs: 2000, callbacks: values.length,
          callbackMeanMs: values.reduce((sum, n) => sum + n, 0) / (values.length || 1),
          callbackP95Ms: values[Math.floor(values.length * .95)] || 0,
          callbackMaxMs: values.at(-1) || 0,
          activeScenes: [...document.querySelectorAll('canvas')].filter(c => c.dataset.running === 'true').map(c => c.id || c.dataset.art)
        };
      }, { name, section }));
    }
    await context.close();
  }
  const result = { physicalPhoneTested: false, method: 'Chromium headless, real clock; total JavaScript requestAnimationFrame callback wall time, 2 seconds per viewport/section. Not GPU/raster cost or a physical-device smoothness guarantee.', samples };
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); await server.close(); }
