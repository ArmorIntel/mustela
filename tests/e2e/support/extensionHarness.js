import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const extensionPath = path.join(repoRoot, 'dist', 'chrome');
const fixturesDir = path.join(repoRoot, 'tests', 'fixtures');

async function readFixture(name) {
  return fs.readFile(path.join(fixturesDir, name), 'utf8');
}

export async function startFixtureServer() {
  const fixtures = {
    '/iocs.html': await readFixture('iocs.html'),
    '/dynamic-iocs.html': await readFixture('dynamic-iocs.html'),
    '/many-iocs.html': await readFixture('many-iocs.html')
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

export async function launchExtensionContext() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mustela-extension-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(serviceWorker.url()).host;

  for (const page of context.pages()) {
    if (page.url().startsWith(`chrome-extension://${extensionId}/src/welcome/`)) {
      await page.close();
    }
  }

  return {
    context,
    extensionId,
    async close() {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
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

export async function getServiceWorker(context) {
  return context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
}
