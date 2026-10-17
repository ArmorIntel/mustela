import { test, expect } from '@playwright/test';
import { launchExtensionContext, openPopup, getServiceWorker } from './support/extensionHarness.js';

const send = (page, type, payload) => page.evaluate(({ type, payload }) => chrome.runtime.sendMessage({ type, payload }), { type, payload });
const ip = { type: 'ip', normalized: '8.8.8.8' };

test('already-open interfaces cannot transmit after confirmed pause; resume never replays work', async () => {
  const extension = await launchExtensionContext();
  try {
    const popup = await openPopup(extension.context, extension.extensionId);
    const worker = await getServiceWorker(extension.context);
    await worker.evaluate(async () => {
      globalThis.pauseCalls = [];
      globalThis.pauseNavigations = [];
      globalThis.fetch = async (url) => { pauseCalls.push(String(url)); return new Response('{}', { status: 503 }); };
      chrome.tabs.create = async (details) => { pauseNavigations.push(details); return { id: 999, ...details }; };
    });
    expect(await send(popup, 'GET_PAUSE_STATE')).toEqual({ ok: true, data: { paused: false } });
    const settings = (await send(popup, 'GET_SETTINGS')).data;
    expect(await send(popup, 'SET_PAUSE_STATE', { paused: true })).toEqual({ ok: true, data: { paused: true } });
    for (const [type, payload] of [
      ['LOOKUP_IOC', ip], ['LOOKUP_IOC', { ...ip, _rerun: true }],
      ['OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc: ip }],
      ['CORRELATE_IOCS', {}], ['ADD_IOC_TO_MISP', { ioc: ip }],
      ...['virustotal', 'abuseipdb', 'shodan', 'misp', 'llm'].map((provider) => ['TEST_API_KEY', { provider }])
    ]) {
      const result = await send(popup, type, payload);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('MUSTELA_PAUSED');
    }
    expect(await worker.evaluate(() => chrome.storage.local.get('mustela_paused'))).toEqual({ mustela_paused: true });
    expect((await send(popup, 'GET_SETTINGS')).data).toEqual(settings);
    expect(await worker.evaluate(() => pauseCalls)).toEqual([]);
    expect(await worker.evaluate(() => pauseNavigations.filter((entry) => /^https?:/.test(entry.url)))).toEqual([]);
    expect((await send(popup, 'SET_PAUSE_STATE', { paused: false })).ok).toBe(true);
    expect(await worker.evaluate(() => pauseCalls)).toEqual([]);
    expect((await send(popup, 'OPEN_EXTERNAL_PROVIDER', { provider: 'virustotal', ioc: ip })).ok).toBe(true);
    expect(await worker.evaluate(() => pauseNavigations.filter((entry) => /^https?:/.test(entry.url)).length)).toBe(1);
  } finally {
    await extension.close();
  }
});
