import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const extensionPath = path.join(repoRoot, 'dist', 'chrome');
const fixturesDir = path.join(repoRoot, 'tests', 'fixtures');

async function readFixture(name) {
  return fs.readFile(path.join(fixturesDir, name), 'utf8');
}

export async function startFixtureServer() {
  const fixtures = {
    '/iocs.html': await readFixture('iocs.html'),
    '/email-iocs.html': await readFixture('email-iocs.html'),
    '/ipv6-iocs.html': await readFixture('ipv6-iocs.html'),
    '/defanged-iocs.html': await readFixture('defanged-iocs.html'),
    '/dynamic-iocs.html': await readFixture('dynamic-iocs.html'),
    '/many-iocs.html': await readFixture('many-iocs.html'),
    '/framework-iocs.html': await readFixture('framework-iocs.html')
  };

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const html = fixtures[url] || fixtures['/iocs.html'];
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    server,
    baseUrl,
    urlFor(route) {
      return `${baseUrl}${route}`;
    },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

export async function launchExtensionContext({ captureContextMenus = false } = {}) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mustela-extension-e2e-'));
  let instrumentedPath;
  if (captureContextMenus) {
    // Observe the real registered handlers in a disposable extension copy.
    // Chrome does not expose native context-menu activation to Playwright.
    instrumentedPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mustela-menu-e2e-'));
    await fs.cp(extensionPath, instrumentedPath, { recursive: true });
    const manifest = JSON.parse(await fs.readFile(path.join(instrumentedPath, 'manifest.json'), 'utf8'));
    const workerPath = path.join(instrumentedPath, manifest.background.service_worker);
    const source = await fs.readFile(workerPath, 'utf8');
    await fs.writeFile(workerPath, `
globalThis.contextMenuHandlers = [];
const registerContextMenu = chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);
chrome.contextMenus.onClicked.addListener = (listener) => {
  contextMenuHandlers.push(listener);
  registerContextMenu(listener);
};
${source}`);
  }
  const loadedExtensionPath = instrumentedPath || extensionPath;
  const launchOptions = {
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${loadedExtensionPath}`,
      `--load-extension=${loadedExtensionPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  };
  let context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(serviceWorker.url()).host;

  for (const page of context.pages()) {
    if (page.url().startsWith(`chrome-extension://${extensionId}/src/welcome/`)) {
      await page.close();
    }
  }

  return {
    get context() { return context; },
    extensionId,
    async restart() {
      await context.close();
      context = await chromium.launchPersistentContext(userDataDir, launchOptions);
      await getServiceWorker(context);
    },
    async close() {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
      if (instrumentedPath) await fs.rm(instrumentedPath, { recursive: true, force: true });
    }
  };
}

export async function openPopup(context, extensionId) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  return popup;
}

export async function bindPopupToTab(context, popup, targetPage) {
  const worker = await getServiceWorker(context);
  const targetUrl = targetPage.url();
  await worker.evaluate(async ({ targetUrl }) => {
    const tabs = await chrome.tabs.query({});
    const targetTab = tabs.find((tab) => tab.url === targetUrl);
    if (!targetTab?.id) throw new Error(`Unable to find target tab for ${targetUrl}`);
    await chrome.tabs.update(targetTab.id, { active: true });
  }, { targetUrl });
  await popup.reload({ waitUntil: 'domcontentloaded' });
  return popup;
}

export async function openFixturePage(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

// Highlights are CSS Custom Highlight ranges painted over the page text, not
// DOM elements. Read what the analyst sees: non-empty ranges in document order.
export function iocHighlights(page, scope = 'html', text = null) {
  const locate = (index) => page.evaluate(({ scope, text, index }) => {
    const ranges = [...(CSS.highlights.get('mustela-ioc') || [])]
      .filter((range) => !range.collapsed && range.startContainer.isConnected
        && range.startContainer.parentElement?.closest(scope)
        && (text === null || range.toString().includes(text)))
      .sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
    if (index === null) return ranges.map((range) => range.toString());
    const range = ranges[index];
    if (!range) return null;
    range.startContainer.parentElement.scrollIntoView({ block: 'center' });
    const rect = range.getClientRects()[0];
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, { scope, text, index });
  return {
    texts: () => locate(null),
    count: async () => (await locate(null)).length,
    async click(index = 0) {
      await expect.poll(async () => (await locate(null)).length > index).toBe(true);
      const point = await locate(index);
      await page.mouse.click(point.x, point.y);
    }
  };
}

export async function getServiceWorker(context) {
  return context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
}
