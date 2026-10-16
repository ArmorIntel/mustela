import { test, expect } from '@playwright/test';
import { startFixtureServer, launchExtensionContext, openFixturePage, openPopup, bindPopupToTab, getServiceWorker } from './support/extensionHarness.js';

const ip = (normalized) => ({ type: 'ip', normalized });
const send = (page, type, payload) => page.evaluate(({ type, payload }) => chrome.runtime.sendMessage({ type, payload }), { type, payload });

async function instrument(context, { enabled = true, keys = true, misp = false } = {}) {
  const worker = await getServiceWorker(context);
  await worker.evaluate(async ({ enabled, keys, misp }) => {
    globalThis.policyCalls = [];
    globalThis.policyNavigations = [];
    globalThis.fetch = async (url, options = {}) => {
      policyCalls.push({ url: String(url), body: options.body || '' });
      if (String(url).includes('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Public brief"}' } }] }));
      if (String(url).includes('/attributes/add/')) return new Response(JSON.stringify({ Attribute: { id: '7', event_id: '42' } }));
      if (String(url).includes('/attributes/restSearch')) return new Response(JSON.stringify({ response: { Attribute: [] } }));
      return new Response('{}', { status: 503 });
    };
    chrome.tabs.create = async (details) => { policyNavigations.push(details); return { id: 999, ...details }; };
    await chrome.storage.local.set({ mustela_cache: {}, mustela_history: [], mustela_settings: {
      highlightEnabled: true, detectionMode: 'balanced', cacheTtlMinutes: 30,
      providers: Object.fromEntries(['virustotal', 'abuseipdb', 'shodan', 'misp'].map((id) => [id, { enabled: id === 'misp' ? misp : enabled, apiKey: keys ? 'test-key' : '', baseUrl: id === 'misp' ? 'https://misp.example' : '', defaultEventId: '42' }])),
      analystAssist: { enabled, baseUrl: 'http://localhost:1234/v1', apiKey: keys ? 'test-key' : '', model: 'test-model' }
    } });
  }, { enabled, keys, misp });
  return worker;
}

for (const options of [{ enabled: true, keys: true }, { enabled: true, keys: false }, { enabled: false, keys: false }]) {
  test(`protected panel and manual lookup block disclosure (enabled=${options.enabled}, keys=${options.keys})`, async () => {
    const server = await startFixtureServer();
    const extension = await launchExtensionContext();
    try {
      const worker = await instrument(extension.context, options);
      const page = await openFixturePage(extension.context, server.urlFor('/iocs.html'));
      await page.evaluate(() => { const p = document.createElement('p'); p.textContent = 'Internal indicator 10.0.0.1'; document.body.append(p); });
      const highlight = page.locator('.mustela-highlight').filter({ hasText: '10.0.0.1' });
      await expect(highlight).toHaveCount(1);
      await highlight.click();
      const panel = page.locator('.mustela-panel');
      await expect(panel).toContainText('Internal / reserved');
      await expect(panel).toContainText('Public lookups blocked for internal/reserved IPv4');
      await expect(panel).toContainText('IOC leaves the browser for MISP');
      await expect(panel).toContainText('unknown · 0/100');
      await expect(panel.locator('.mustela-provider-link')).toHaveCount(0);
      await worker.evaluate(async () => {
        const { mustela_cache: cache } = await chrome.storage.local.get('mustela_cache');
        for (const entry of Object.values(cache)) {
          entry.value.llmSummary = { summary: 'stale brief' };
          entry.value.providerResults = [{ provider: 'VirusTotal', success: true, externalUrl: 'https://www.virustotal.com/gui/search/10.0.0.1' }];
        }
        await chrome.storage.local.set({ mustela_cache: cache });
      });
      await panel.locator('#mustela-close').click();
      await highlight.click();
      await expect(panel).toContainText('Internal / reserved');
      await expect(panel).not.toContainText('stale brief');
      await expect(panel.locator('.mustela-provider-link')).toHaveCount(0);
      await panel.locator('#mustela-rerun').click();
      await expect(panel).toContainText('Public lookups blocked');
      await panel.locator('#mustela-analyst-note').fill('Local analyst note');
      await panel.locator('#mustela-analyst-note').blur();
      await expect(panel.locator('#mustela-note-status')).toContainText('saved');
      await panel.locator('#mustela-copy-export').click();
      const downloadEvent = page.waitForEvent('download');
      await panel.locator('#mustela-download-export').click();
      const download = await downloadEvent;
      expect(await download.failure()).toBeNull();

      const popup = await bindPopupToTab(extension.context, await openPopup(extension.context, extension.extensionId), page);
      await popup.locator('#manualInput').fill('10.0.0.1');
      await expect(popup.locator('#manualTypeChip')).toContainText('Internal / reserved');
      for (const id of ['#manualVtBtn', '#manualAbuseBtn', '#manualShodanBtn']) await expect(popup.locator(id)).toBeDisabled();
      await expect(popup.locator('#manualHint')).toContainText('Public lookups blocked');
      for (const provider of ['virustotal', 'abuseipdb', 'shodan']) {
        const response = await send(popup, 'OPEN_EXTERNAL_PROVIDER', { provider, ioc: ip('10.0.0.1') });
        expect(response.ok).toBe(false);
      }
      await popup.locator('#manualInvestigateBtn').click();
      await expect(panel).toContainText('Internal / reserved');
      expect(await worker.evaluate(() => policyCalls)).toEqual([]);
      // Installation may concurrently open the extension's own welcome page.
      expect(await worker.evaluate(() => policyNavigations.filter((navigation) => /^https?:/.test(navigation.url)))).toEqual([]);
    } finally {
      await extension.close();
      await server.close();
    }
  });
}

test('real worker preserves MISP and public flows, and filters correlation before limit and threshold', async () => {
  const extension = await launchExtensionContext();
  try {
    const worker = await instrument(extension.context, { misp: true });
    const popup = await openPopup(extension.context, extension.extensionId);
    const result = await send(popup, 'LOOKUP_IOC', ip('192.168.1.1'));
    expect(result.ok).toBe(true);
    expect(result.data.llmSummary).toBeUndefined();
    expect((await send(popup, 'ADD_IOC_TO_MISP', { ioc: ip('192.168.1.1') })).ok).toBe(true);
    let calls = await worker.evaluate(() => policyCalls);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.url.startsWith('https://misp.example/'))).toBe(true);
    expect(calls.every((call) => call.body.includes('192.168.1.1'))).toBe(true);
    for (const count of [0, 1, 2]) {
      await worker.evaluate(async (count) => {
        globalThis.policyCalls = [];
        const protectedEntries = Array.from({ length: 12 }, (_, n) => ({ ioc: { type: 'ip', normalized: `10.0.0.${n + 1}` }, overallVerdict: 'malicious', summaryText: 'protected-marker' }));
        const publicEntries = ['8.8.8.8', '1.1.1.1'].slice(0, count).map((normalized) => ({ ioc: { type: 'ip', normalized }, overallVerdict: 'unknown' }));
        await chrome.storage.local.set({ mustela_history: [...protectedEntries, ...publicEntries] });
      }, count);
      const response = await send(popup, 'CORRELATE_IOCS', {});
      expect(response.ok).toBe(count === 2);
      calls = await worker.evaluate(() => policyCalls);
      expect(calls).toHaveLength(count === 2 ? 1 : 0);
      if (count === 2) {
        expect(calls[0].body).not.toContain('protected-marker');
        expect(calls[0].body).not.toContain('10.0.0.');
        expect(calls[0].body).toContain('8.8.8.8');
        expect(calls[0].body).toContain('1.1.1.1');
      } else expect(response.error).toContain('internal/reserved IPv4 entries are excluded');
    }
    await worker.evaluate(() => { globalThis.policyCalls = []; });
    const publicResult = await send(popup, 'LOOKUP_IOC', ip('8.8.8.8'));
    expect(publicResult.data.llmSummary.summary).toBe('Public brief');
    expect(await worker.evaluate(() => policyCalls.length)).toBe(5);
    for (const provider of ['virustotal', 'abuseipdb', 'shodan']) expect((await send(popup, 'OPEN_EXTERNAL_PROVIDER', { provider, ioc: ip('8.8.8.8') })).ok).toBe(true);
    expect(await worker.evaluate(() => policyNavigations.filter((navigation) => /^https?:/.test(navigation.url)).length)).toBe(3);
  } finally {
    await extension.close();
  }
});
