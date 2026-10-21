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
    '/hostile-styles.html': await readFixture('hostile-styles.html'),
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

export async function launchExtensionContext({ captureContextMenus = false, captureContentLifecycle = false } = {}) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mustela-extension-e2e-'));
  let instrumentedPath;
  if (captureContextMenus || captureContentLifecycle) {
    // Observe the real registered handlers in a disposable extension copy.
    // Chrome does not expose native context-menu activation to Playwright.
    instrumentedPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mustela-menu-e2e-'));
    await fs.cp(extensionPath, instrumentedPath, { recursive: true });
    const manifest = JSON.parse(await fs.readFile(path.join(instrumentedPath, 'manifest.json'), 'utf8'));
    const workerPath = path.join(instrumentedPath, manifest.background.service_worker);
    let source = await fs.readFile(workerPath, 'utf8');
    if (captureContextMenus) source = `
globalThis.contextMenuHandlers = [];
const registerContextMenu = chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);
chrome.contextMenus.onClicked.addListener = (listener) => {
  contextMenuHandlers.push(listener);
  registerContextMenu(listener);
};
${source}`;
    if (captureContentLifecycle) {
      source = `
globalThis.scriptCalls = [];
const execute = chrome.scripting.executeScript.bind(chrome.scripting);
chrome.scripting.executeScript = (options) => { scriptCalls.push(options); return execute(options); };
${source}`;
      const contentPath = path.join(instrumentedPath, 'src/content/content.js');
      let content = await fs.readFile(contentPath, 'utf8');
      content = content.replace('let disposed = false;', `
function recordLifecycle(key) {
  const data = JSON.parse(document.documentElement.dataset.testLifecycle || '{}');
  const entry = data[instanceId] ||= { scans: 0, mutations: 0, observers: 0, disposed: 0 };
  entry[key]++;
  document.documentElement.dataset.testLifecycle = JSON.stringify(data);
}
let disposed = false;`)
        .replace('disposed = true;', "recordLifecycle('disposed'); disposed = true;")
        .replace('async function scanPage(reset = true) {', "async function scanPage(reset = true) { recordLifecycle('scans');")
        .replace('observer = new MutationObserver(collectMutations);', `
recordLifecycle('observers');
observer = new MutationObserver((records) => { recordLifecycle('mutations'); collectMutations(records); });`);
      await fs.writeFile(contentPath, content);
    }
    await fs.writeFile(workerPath, source);
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

// CDP can inspect closed roots. Expose them only to Playwright's utility world:
// the extension still uses mode:closed and page JavaScript still sees null.
export async function inspectClosedRoots(page) {
  const session = await page.context().newCDPSession(page);
  let utilityContext;
  let refreshing = false;
  let again = false;
  async function refresh() {
    if (!utilityContext || page.isClosed()) return;
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
      const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
      async function visit(node) {
        for (const shadow of node.shadowRoots || []) {
          if (shadow.shadowRootType === 'closed') {
            const { object } = await session.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId, executionContextId: utilityContext });
            await session.send('Runtime.callFunctionOn', {
              objectId: object.objectId,
              functionDeclaration: 'function() { Object.defineProperty(this.host, "shadowRoot", { configurable: true, value: this }); }'
            });
            await session.send('Runtime.releaseObject', { objectId: object.objectId });
          }
          await visit(shadow);
        }
        for (const child of node.children || []) await visit(child);
      }
      await visit(root);
    } catch (error) {
      // Navigation destroys execution contexts and nodes; the next lifecycle
      // event retries against the replacement document.
      if (!/closed|destroyed|context|document|node/i.test(error.message)) throw error;
    } finally {
      refreshing = false;
      if (again) { again = false; await refresh(); }
    }
  }
  session.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.name.startsWith('__playwright_utility_world_')) { utilityContext = context.id; void refresh(); }
  });
  session.on('Runtime.executionContextsCleared', () => { utilityContext = null; });
  session.on('DOM.documentUpdated', () => { void refresh(); });
  session.on('DOM.shadowRootPushed', () => { void refresh(); });
  session.on('DOM.childNodeInserted', ({ node }) => {
    if (node.shadowRoots?.length) void refresh();
  });
  page.on('domcontentloaded', () => { void refresh(); });
  await session.send('Runtime.enable');
  await session.send('DOM.enable');
  await session.send('DOM.getDocument', { depth: -1, pierce: true });
}

export async function openFixturePage(context, url) {
  const page = await context.newPage();
  await inspectClosedRoots(page);
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
