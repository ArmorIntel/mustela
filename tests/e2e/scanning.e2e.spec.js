import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { launchExtensionContext, startFixtureServer, openFixturePage, getServiceWorker, iocHighlights, inspectClosedRoots } from './support/extensionHarness.js';

const runtime = await fs.readFile(new URL('../../src/shared/ioc.content-runtime.js', import.meta.url), 'utf8');
const content = await fs.readFile(new URL('../../dist/chrome/src/content/content.js', import.meta.url), 'utf8');

// Run the shipped content scripts in a real browser DOM with a counted local
// transport. The extension E2E suite separately covers Chrome message delivery.
async function fixture(page, html = '<main><p>8.8.8.8 evil.example.org</p></main>') {
  await page.setContent(`<html><body>${html}</body></html>`);
  await inspectClosedRoots(page);
  await page.evaluate(() => {
    window.metrics = { scans: [], parsed: [], messages: [] };
    window.chrome = { runtime: {
      id: 'fixture-extension',
      onMessage: { addListener(fn) { window.notify = fn; } },
      async sendMessage(message) {
        if (message.type === 'PAGE_IOCS_DETECTED') metrics.messages.push(message.payload);
        return { ok: true, data: message.type === 'GET_PAUSE_STATE' ? { paused: false } : message.type === 'GET_DETECTION_POLICY' ? { rules: [], excluded: false } : {} };
      }
    } };
  });
  await page.addScriptTag({ content: runtime });
  await page.evaluate(() => {
    const parse = MUSTELA_SHARED.parseIocsFromText;
    MUSTELA_SHARED.parseIocsFromText = (text, options) => {
      metrics.parsed.push(text);
      if (window.parseDelay) {
        if (!window.yieldScheduled) {
          window.yieldScheduled = true;
          setTimeout(() => { window.parsedAtYield = metrics.parsed.length; }, 0);
        }
        const until = performance.now() + parseDelay;
        while (performance.now() < until) { /* deterministic work for slice tests */ }
      }
      return parse(text, options);
    };
  });
  await page.addScriptTag({ content: content.replace('bootstrap();', `
    window.scanState = () => ({ retained: detectedByNode.size, queued: pendingRoots.size });
    const originalScan = scanPage;
    scanPage = async (...args) => {
      const started = performance.now();
      const before = metrics.parsed.length;
      const result = await originalScan(...args);
      metrics.scans.push({ duration: performance.now() - started, nodes: metrics.parsed.length - before });
      return result;
    };
    bootstrap();`) });
  await expect.poll(() => page.evaluate(() => metrics.scans.length)).toBeGreaterThan(0);
}

test('loaded extension delivers one detection message and keeps its DOM stable on a static page', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const worker = await getServiceWorker(extension.context);
    await worker.evaluate(() => {
      globalThis.detectionMessages = [];
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message.type === 'PAGE_IOCS_DETECTED') detectionMessages.push({ tab: sender.tab.id, payload: message.payload });
      });
    });
    const page = await openFixturePage(extension.context, server.urlFor('/many-iocs.html'));
    await expect.poll(() => iocHighlights(page).count()).toBeGreaterThan(0);
    await expect.poll(() => worker.evaluate(() => detectionMessages.length)).toBe(1);
    await page.evaluate(() => { window.mark = [...CSS.highlights.get('mustela-ioc')][0]; });
    const indicator = await page.locator('.mustela-page-indicator').elementHandle();
    await page.waitForTimeout(10000);
    expect(await worker.evaluate(() => detectionMessages.length)).toBe(1);
    expect(await page.evaluate(() => CSS.highlights.get('mustela-ioc').has(mark))).toBe(true);
    expect(await indicator.evaluate((first, current) => first === current, await page.locator('.mustela-page-indicator').elementHandle())).toBe(true);
  } finally { await extension.close(); await server.close(); }
});

test('static IOC page stays idle for ten seconds after initial scan', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { window.firstMark = [...CSS.highlights.get('mustela-ioc')][0]; });
  const indicator = await page.locator('.mustela-page-indicator').elementHandle();
  await page.waitForTimeout(10000);
  const result = await page.evaluate(() => ({ ...metrics, stable: CSS.highlights.get('mustela-ioc').has(firstMark) }));
  console.log('static', JSON.stringify(result));
  expect(result.scans).toHaveLength(1);
  expect(result.messages).toHaveLength(1);
  expect(result.stable).toBe(true);
  expect(await indicator.evaluate((first, current) => first === current, await page.locator('.mustela-page-indicator').elementHandle())).toBe(true);
});

test('live stream scans only additions in bounded batches', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.added = 0;
    window.stream = setInterval(() => {
      const p = document.createElement('p');
      p.textContent = `event ${++added}: 9.9.9.9`;
      document.querySelector('main').append(p);
      if (added === 100) clearInterval(stream);
    }, 100);
  });
  await expect.poll(() => page.evaluate(() => added), { timeout: 15000 }).toBe(100);
  await page.waitForTimeout(1600);
  const result = await page.evaluate(() => metrics);
  console.log('live', JSON.stringify({ scans: result.scans, messages: result.messages.length, parsed: result.parsed.length }));
  expect(result.scans.length).toBeGreaterThan(3);
  expect(result.scans.length).toBeLessThanOrEqual(12);
  expect(result.parsed).toHaveLength(101);
  expect(result.parsed.filter((text) => text.startsWith('event '))).toHaveLength(100);
  expect(result.messages).toHaveLength(2);
  expect(Math.max(...result.scans.map((scan) => scan.nodes))).toBeLessThanOrEqual(15);
});

test('scan bounds text, covers every queued root, yields and forgets removed IOC', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.parseDelay = 2;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 2000; i++) {
      const p = document.createElement('p');
      p.textContent = i === 0 ? 'a.'.repeat(20000) : `plain event ${i}`;
      fragment.append(p);
    }
    document.querySelector('main').append(fragment);
  });
  await expect.poll(() => page.evaluate(() => metrics.scans.length), { timeout: 15000 }).toBe(2);
  const result = await page.evaluate(() => ({ count: metrics.parsed.length, longest: Math.max(...metrics.parsed.map((text) => text.length)), parsedAtYield, ...scanState() }));
  expect(result.retained).toBe(1);
  expect(result.queued).toBe(0);
  expect(result.longest).toBeLessThanOrEqual(8192);
  expect(result.count).toBe(2001);
  expect(result.parsedAtYield).toBeLessThan(result.count);
  await page.evaluate(() => { window.parseDelay = 0; document.querySelector('main').replaceChildren(); });
  await expect(page.locator('.mustela-page-indicator')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => metrics.messages.at(-1).length)).toBe(0);
});

test('mutations arriving during a sliced scan are not lost when their deadline expires', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.parseDelay = 3;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 600; i++) {
      const p = document.createElement('p'); p.textContent = `batch event ${i}`; fragment.append(p);
    }
    document.querySelector('main').append(fragment);
    setTimeout(() => {
      const p = document.createElement('p'); p.textContent = '9.9.9.9'; document.querySelector('main').append(p);
    }, 1300);
  });
  await expect.poll(() => page.evaluate(() => metrics.messages.at(-1).some((ioc) => ioc.normalized === '9.9.9.9')), { timeout: 15000 }).toBe(true);
  expect(await page.evaluate(() => metrics.parsed.filter((text) => text === '9.9.9.9').length)).toBe(1);
});

test('disabling highlights cancels a yielded scan and re-enabling rebuilds once', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.parseDelay = 3;
    for (let i = 0; i < 100; i++) {
      const p = document.createElement('p'); p.textContent = `event ${i}: 9.9.9.9`; document.querySelector('main').append(p);
    }
    setTimeout(() => notify({ type: 'SETTINGS_UPDATED', payload: { highlightEnabled: false } }, {}, () => {}), 1050);
  });
  await expect.poll(() => page.evaluate(() => metrics.messages.at(-1).length)).toBe(0);
  const before = await page.evaluate(() => metrics.parsed.length);
  await page.waitForTimeout(1200);
  expect(await iocHighlights(page).count()).toBe(0);
  await expect(page.locator('.mustela-page-indicator')).toHaveCount(0);
  expect(await page.evaluate(() => metrics.parsed.length)).toBe(before);
  await page.evaluate(() => {
    window.parseDelay = 0;
    notify({ type: 'SETTINGS_UPDATED', payload: { highlightEnabled: true } }, {}, () => {});
  });
  await expect.poll(() => page.evaluate(() => metrics.messages.at(-1).some((ioc) => ioc.normalized === '9.9.9.9'))).toBe(true);
  const scans = await page.evaluate(() => metrics.scans.length);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => metrics.scans.length)).toBe(scans);
});

test('character changes in links are incremental and unchanged IOC never republishes', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.href = '#'; a.textContent = '9.9.9.9'; document.querySelector('main').append(a);
  });
  await expect.poll(() => page.evaluate(() => metrics.messages.length)).toBe(2);
  await page.evaluate(() => { document.querySelector('a').firstChild.nodeValue = '1.1.1.1'; });
  await expect.poll(() => page.evaluate(() => metrics.messages.length)).toBe(3);
  expect(await page.evaluate(() => metrics.messages.at(-1).map((ioc) => ioc.normalized))).not.toContain('9.9.9.9');
  await page.evaluate(() => { document.querySelector('a').firstChild.nodeValue = 'same IOC: 1.1.1.1'; });
  await expect.poll(() => page.evaluate(() => metrics.scans.length)).toBe(4);
  expect(await page.evaluate(() => metrics.messages.length)).toBe(3);
});

test('initial scan covers 20,000 text nodes including the last IOC', async ({ page }) => {
  const rows = Array.from({ length: 20000 }, (_, i) => `<p>${i === 19999 ? '8.8.8.8' : `plain event ${i}`}</p>`).join('');
  await fixture(page, `<main>${rows}</main>`);
  expect(await page.evaluate(() => metrics.parsed.length)).toBe(20000);
  expect(await page.evaluate(() => metrics.messages.at(-1).map((ioc) => ioc.normalized))).toEqual(['8.8.8.8']);
  expect(await iocHighlights(page).texts()).toEqual(['8.8.8.8']);
});

test('excluded subtrees are pruned and delegated click resolves one of 200 IOC', async ({ page }) => {
  const excluded = ['script', 'style', 'textarea', 'select', 'div contenteditable="true"',
    'div contenteditable=""', 'div contenteditable="plaintext-only"', 'svg', 'div role="textbox"',
    'div class="cm-editor"', 'div class="CodeMirror"', 'div class="monaco-editor"',
    'div class="ace_editor"', 'div aria-live="polite"', 'div class="mustela-panel"'];
  const skipped = excluded.map((tag) => `<${tag}>9.9.9.9</${tag.split(' ')[0]}>`).join('');
  const rows = Array.from({ length: 200 }, (_, i) => `<p>198.51.100.${i + 1}</p>`).join('');
  await fixture(page, `<main>${skipped}<section>${rows}</section></main>`);
  expect(await page.evaluate(() => metrics.parsed.length)).toBe(200);
  expect(await iocHighlights(page, 'section').count()).toBe(200);
  await iocHighlights(page, 'section', '198.51.100.173').click();
  await expect(page.locator('.mustela-panel .mustela-ioc-value')).toHaveText('198.51.100.173');
  expect(await page.locator('section [data-ioc], section span').count()).toBe(0);
});

test('retained range budget is global and removal frees it for new IOC', async ({ page }) => {
  const rows = Array.from({ length: 800 }, () => '<p>8.8.8.8 9.9.9.9</p>').join('');
  await fixture(page, `<main>${rows}</main>`);
  expect(await iocHighlights(page).count()).toBe(1500);
  await page.evaluate(() => { document.querySelector('main').replaceChildren(); });
  await expect.poll(() => iocHighlights(page).count()).toBe(0);
  await page.evaluate(() => { const p = document.createElement('p'); p.textContent = '1.1.1.1'; document.querySelector('main').append(p); });
  await expect.poll(() => iocHighlights(page).texts()).toEqual(['1.1.1.1']);
});

test('overlapping mutation roots parse each new text node only once', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const section = document.createElement('section');
    document.querySelector('main').append(section);
    const p = document.createElement('p'); p.textContent = 'plain overlapping event';
    section.append(p);
  });
  await expect.poll(() => page.evaluate(() => metrics.scans.length)).toBe(2);
  expect(await page.evaluate(() => metrics.parsed.filter(text => text === 'plain overlapping event').length)).toBe(1);
});
