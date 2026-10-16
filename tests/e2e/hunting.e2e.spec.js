import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, bindPopupToTab, getServiceWorker } from './support/extensionHarness.js';

const header = '// Microsoft Defender XDR Advanced Hunting — requires Defender for Endpoint telemetry';
const query = (table, filter) => `${header}\n${table}\n| where Timestamp >= ago(7d)\n| where ${filter}`;

async function checkDefenderCopy(mode) {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  const { context, extensionId } = extension;
  try {
    const worker = await getServiceWorker(context);
    await worker.evaluate(async (mode) => {
      globalThis.huntingFetchCalls = [];
      globalThis.fetch = async (...args) => {
        huntingFetchCalls.push(String(args[0]));
        if (mode === 'provider-errors') return new Response('{}', { status: 503 });
        throw new DOMException('Timed out', 'TimeoutError');
      };
      await chrome.storage.local.set({
        mustela_paused: mode === 'provider-timeouts-paused',
        mustela_settings: {
          providers: Object.fromEntries(['virustotal', 'abuseipdb', 'shodan', 'misp'].map((id) => [id, {
            enabled: true, apiKey: mode === 'keyless' ? '' : 'test-key', baseUrl: 'https://misp.example', defaultEventId: '42'
          }])),
          analystAssist: { enabled: false }
        }
      });
    }, mode);
    const page = await openFixturePage(context, server.urlFor('/sensitive-case?token=private'));
    const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
    await expect(popup.locator('#manualInvestigateBtn')).toBeDisabled();
    const before = await worker.evaluate(() => chrome.storage.local.get(null));
    const pagesBefore = context.pages();
    const requests = [];
    context.on('request', (request) => requests.push(request.url()));
    await popup.evaluate(() => {
      window.copyCalls = [];
      window.sideEffects = [];
      // Fail closed if the copy action attempts any investigation or page-context API.
      for (const [object, methods] of [[chrome.runtime, ['sendMessage']], [chrome.tabs, ['sendMessage', 'query', 'create']]]) {
        for (const method of methods) object[method] = (...args) => { window.sideEffects.push([method, args]); throw new Error('Unexpected API'); };
      }
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: (text) => {
          window.copyCalls.push(text);
          return new Promise((resolve, reject) => { window.finishCopy = resolve; window.failCopy = () => reject(new Error('Denied')); });
        }
      } });
    });
    const button = popup.getByRole('button', { name: 'Copy Defender KQL' });
    const status = popup.locator('#manualKqlStatus');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(button).toBeDisabled();
    for (const input of ['999.1.1.1', 'around 8.8.8.8', '8.8.8.8 1.1.1.1', 'AS123', '8.8.8.0/24', '2001:db8::1', 'a@evil.example.org', 'evil.example.org" | take 1']) {
      await popup.locator('#manualInput').fill(input);
      await expect(button).toBeDisabled();
      await expect(status).not.toHaveText('');
    }
    expect(await popup.evaluate(() => window.copyCalls)).toEqual([]);

    const cases = [
      [' 8.8.8.8 ', 'DeviceNetworkEvents', 'RemoteIP == "8.8.8.8"', 'Enter'],
      ['EVIL.Example.org', 'DeviceNetworkEvents', 'RemoteUrl =~ "evil.example.org"', 'Space'],
      ['https://evil.example.org/Path?q=Mixed', 'DeviceNetworkEvents', 'RemoteUrl == "https://evil.example.org/Path?q=Mixed"'],
      ['A'.repeat(32), 'DeviceFileEvents', `MD5 =~ "${'a'.repeat(32)}"`],
      ['B'.repeat(40), 'DeviceFileEvents', `SHA1 =~ "${'b'.repeat(40)}"`],
      ['C'.repeat(64), 'DeviceFileEvents', `SHA256 =~ "${'c'.repeat(64)}"`]
    ];
    const expected = [];
    for (const [input, table, filter, key] of cases) {
      await popup.locator('#manualInput').fill(input);
      await expect(button).toBeEnabled();
      await button.focus();
      if (key) await button.press(key); else await button.click();
      expected.push(query(table, filter));
      await expect.poll(() => popup.evaluate(() => window.copyCalls)).toEqual(expected);
      await expect(status).not.toHaveText('Query copied');
      await popup.evaluate(() => window.finishCopy());
      await expect(status).toHaveText('Query copied');
      expect(popup.isClosed()).toBe(false);
    }
    await button.click();
    await popup.evaluate(() => window.failCopy());
    await expect(status).toHaveText('Could not copy query. Try again.');
    await expect(button).toBeEnabled();
    await button.click();
    await popup.evaluate(() => window.finishCopy());
    await expect(status).toHaveText('Query copied');
    expect(await popup.evaluate(() => window.copyCalls)).toEqual([...expected, expected.at(-1), expected.at(-1)]);
    // Editing during an outstanding copy must not confirm the new value.
    await button.click();
    await popup.locator('#manualInput').fill('AS123');
    await popup.evaluate(() => window.finishCopy());
    await expect(button).toBeDisabled();
    await expect(status).toContainText('Use exactly one');
    expect(await popup.evaluate(() => window.sideEffects)).toEqual([]);
    expect(await worker.evaluate(() => huntingFetchCalls)).toEqual([]);
    expect(await worker.evaluate(() => chrome.storage.local.get(null))).toEqual(before);
    expect(context.pages()).toEqual(pagesBefore);
    expect(requests).toEqual([]);
  } finally {
    await extension.close();
    await server.close();
  }
}

for (const mode of ['keyless', 'provider-errors', 'provider-timeouts-paused']) {
  test(`Defender copy is exact, accessible, retryable and local on a sensitive page (${mode})`, async () => {
    await checkDefenderCopy(mode);
  });
}

test('IOC copy and Enter investigation remain independent of query copy', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtensionContext();
  try {
    const { context, extensionId } = extension;
    const page = await openFixturePage(context, server.urlFor('/iocs.html'));
    const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
    await expect(popup.locator('#summaryBadge')).toContainText('4 IOC');
    await popup.evaluate(() => {
      window.copiedIocs = [];
      Object.defineProperty(navigator, 'clipboard', { value: {
        writeText: async (value) => { window.copiedIocs.push(value); }
      } });
    });
    await popup.locator('[data-copy-value="8.8.8.8"]').first().click();
    expect(await popup.evaluate(() => window.copiedIocs)).toEqual(['8.8.8.8']);
    await popup.locator('#manualInput').fill('1.1.1.1');
    // Enter opens the panel and closes this window on keydown. Gate only the
    // close until Playwright has finished keyup, rather than racing a dead page.
    await popup.evaluate(() => {
      window.finishClose = window.close.bind(window);
      window.closeRequested = false;
      window.close = () => { window.closeRequested = true; };
    });
    await popup.locator('#manualInput').press('Enter');
    await expect.poll(() => popup.evaluate(() => window.closeRequested)).toBe(true);
    await expect(page.locator('.mustela-panel')).toContainText('1.1.1.1');
    await Promise.all([
      popup.waitForEvent('close'),
      popup.evaluate(() => { setTimeout(() => window.finishClose(), 0); })
    ]);
  } finally {
    await extension.close();
    await server.close();
  }
});
