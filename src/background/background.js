import { buildThreatSummary, detectSingleIoc, summarizeProviderVerdict } from '../shared/ioc.js';
import { isProviderSupportedForIoc, PROVIDERS } from '../providers/providers.js';
import { addHistory, clearCache, clearDisabledPages, clearHistory, getCachedResult, getDetectedForTab, getHistory, getHistoryEntry, getSettings, isPageDisabled, saveDetectedForTab, saveHistoryNote, saveSettings, setCachedResult, setPageDisabled, toggleHistoryPin } from '../storage/storage.js';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') });
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'investigate-selection',
      title: 'Investigate with Mustela',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'lookup-parent',
      title: 'Open IOC in external tool',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'open-virustotal',
      parentId: 'lookup-parent',
      title: 'Open in VirusTotal',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'open-abuseipdb',
      parentId: 'lookup-parent',
      title: 'Open in AbuseIPDB',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'open-shodan',
      parentId: 'lookup-parent',
      title: 'Open in Shodan',
      contexts: ['selection']
    });
  });
});

const CONTENT_SCRIPT_FILES = ['src/shared/ioc.content-runtime.js', 'src/content/content.js'];
const CONTENT_STYLE_FILES = ['src/content/content.css'];

async function ensureContentScripts(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement?.dataset?.mustelaInjected === 'true'
    });
    if (results?.[0]?.result) return;
    await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_STYLE_FILES });
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
  } catch (error) {
    console.debug('ensureContentScripts skipped or failed', error?.message || error);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab?.url || !/^https?:/i.test(tab.url)) return;
  ensureContentScripts(tabId);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const detected = detectSingleIoc(info.selectionText || '');
  if (!detected) return;

  if (info.menuItemId === 'open-virustotal') {
    const url = PROVIDERS.virustotal.buildExternalUrl?.(detected);
    if (url) await chrome.tabs.create({ url });
    return;
  }
  if (info.menuItemId === 'open-abuseipdb' && isProviderSupportedForIoc('abuseipdb', detected)) {
    const url = PROVIDERS.abuseipdb.buildExternalUrl?.(detected);
    if (url) await chrome.tabs.create({ url });
    return;
  }
  if (info.menuItemId === 'open-shodan' && isProviderSupportedForIoc('shodan', detected)) {
    const url = PROVIDERS.shodan.buildExternalUrl?.(detected);
    if (url) await chrome.tabs.create({ url });
    return;
  }
  if (info.menuItemId !== 'investigate-selection') return;

  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL', payload: detected });
  } catch (error) {
    console.debug('Unable to open in-page investigation panel', error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'PAGE_IOCS_DETECTED': {
      const tabId = sender.tab?.id;
      if (typeof tabId === 'number') {
        await saveDetectedForTab(tabId, message.payload || []);
      }
      return { ok: true };
    }
    case 'GET_DETECTED_IOCS': {
      const tabId = message.payload?.tabId;
      return { ok: true, data: await getDetectedForTab(tabId) };
    }
    case 'GET_SETTINGS':
      return { ok: true, data: await getSettings() };
    case 'SAVE_SETTINGS': {
      const saved = await saveSettings(message.payload);
      try {
        const tabs = await chrome.tabs.query({});
        await Promise.all(tabs.map((tab) => {
          if (typeof tab.id !== 'number') return Promise.resolve();
          return chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', payload: { highlightEnabled: saved.highlightEnabled, detectionMode: saved.detectionMode } }).catch(() => undefined);
        }));
      } catch {}
      return { ok: true, data: saved };
    }
    case 'LOOKUP_IOC':
      return { ok: true, data: await lookupIoc(message.payload, sender) };
    case 'OPEN_EXTERNAL_PROVIDER': {
      const provider = PROVIDERS[message.payload?.provider];
      const ioc = message.payload?.ioc;
      if (!provider || !ioc || !provider.buildExternalUrl) return { ok: false, error: 'Unsupported provider' };
      const url = provider.buildExternalUrl(ioc);
      await chrome.tabs.create({ url });
      return { ok: true, data: { url } };
    }
    case 'GET_HISTORY':
      return { ok: true, data: await getHistory() };
    case 'GET_HISTORY_ENTRY':
      return { ok: true, data: await getHistoryEntry(message.payload?.historyKey) };
    case 'TOGGLE_HISTORY_PIN':
      return { ok: true, data: await toggleHistoryPin(message.payload?.historyKey, !!message.payload?.pinned) };
    case 'SAVE_HISTORY_NOTE':
      return { ok: true, data: await saveHistoryNote(message.payload?.historyKey, message.payload?.analystNote) };
    case 'IS_PAGE_DISABLED':
      return { ok: true, data: await isPageDisabled(message.payload?.url) };
    case 'SET_PAGE_DISABLED':
      return { ok: true, data: await setPageDisabled(message.payload?.url, !!message.payload?.disabled) };
    case 'CLEAR_CACHE':
      await clearCache();
      return { ok: true };
    case 'CLEAR_HISTORY':
      await clearHistory();
      return { ok: true };
    case 'CLEAR_DISABLED_PAGES':
      await clearDisabledPages();
      return { ok: true };
    case 'TEST_API_KEY': {
      const provider = PROVIDERS[message.payload?.provider];
      const apiKey = (message.payload?.apiKey || '').trim();
      if (!provider || !provider.validateApiKey) return { ok: false, error: 'Unsupported provider' };
      if (!apiKey) return { ok: true, data: { valid: false, message: 'Missing API key' } };
      const result = await provider.validateApiKey(apiKey);
      return { ok: true, data: { valid: !!result.ok, limited: !!result.limited, message: result.message || (result.ok ? 'API key valid' : 'Invalid API key') } };
    }
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}



function humanizeProviderError(error, providerName) {
  const status = Number(error?.status || String(error?.message || '').match(/HTTP\s+(\d+)/)?.[1] || 0);
  const provider = providerName || error?.provider || 'Provider';
  if (status === 401) return `${provider} rejected the API key.`;
  if (status === 403) {
    if (provider === 'Shodan') return 'Shodan access denied. Your API key may be valid, but this lookup can require additional access or credits.';
    return `${provider} denied access to this lookup.`;
  }
  if (status === 404) return `${provider} has no result for this IOC.`;
  if (status === 429) return `${provider} rate limit reached. Try again later.`;
  if (status >= 500) return `${provider} is temporarily unavailable.`;
  return error?.message || 'Lookup failed';
}

function providerPriority(providerResult) {
  const configured = !/API key not configured/i.test(String(providerResult?.error || ''));
  const success = !!providerResult?.success;
  const confidence = Number(providerResult?.confidence || providerResult?.meta?.abuseConfidenceScore || 0);
  const providerBias = providerResult?.provider === 'AbuseIPDB' ? 3 : providerResult?.provider === 'VirusTotal' ? 2 : providerResult?.provider === 'Shodan' ? 1 : 0;
  return {
    configured,
    success,
    confidence,
    providerBias
  };
}

function sortProviderResults(results) {
  return [...results].sort((a, b) => {
    const pa = providerPriority(a);
    const pb = providerPriority(b);
    if (pa.configured !== pb.configured) return Number(pb.configured) - Number(pa.configured);
    if (pa.success !== pb.success) return Number(pb.success) - Number(pa.success);
    if (pa.confidence !== pb.confidence) return pb.confidence - pa.confidence;
    if (pa.providerBias !== pb.providerBias) return pb.providerBias - pa.providerBias;
    return String(a.provider || '').localeCompare(String(b.provider || ''));
  });
}

async function rememberInvestigation(ioc, investigation, sender = {}) {
  const pageUrl = ioc?.sourceContext?.pageUrl || sender?.tab?.url || '';
  const pageTitle = ioc?.sourceContext?.pageTitle || sender?.tab?.title || '';
  await addHistory({
    ioc: {
      ...ioc,
      sourceContext: pageUrl || pageTitle
        ? {
            ...(ioc?.sourceContext || {}),
            pageUrl,
            pageTitle
          }
        : ioc?.sourceContext
    },
    overallVerdict: investigation.overallVerdict,
    score: investigation.score,
    timestamp: investigation.timestamp || new Date().toISOString(),
    pageUrl,
    pageTitle
  });
}

function buildProviderCacheProfile(settings = {}) {
  const providers = settings.providers || {};
  return JSON.stringify({
    schema: 1,
    providers: Object.fromEntries(Object.entries(providers).map(([providerId, providerSettings]) => [providerId, {
      enabled: !!providerSettings?.enabled,
      hasKey: !!String(providerSettings?.apiKey || '').trim()
    }]))
  });
}

async function lookupIoc(ioc, sender = {}) {
  const settings = await getSettings();
  const providerFingerprint = btoa(buildProviderCacheProfile(settings));
  const cacheKey = `${ioc.type}:${ioc.normalized}:${providerFingerprint}`;
  const cached = ioc?._rerun ? null : await getCachedResult(cacheKey, settings.cacheTtlMinutes || 30);
  if (cached) {
    const cachedInvestigation = {
      ...cached,
      threatSummary: cached?.threatSummary || buildThreatSummary(cached),
      cached: true,
      timestamp: new Date().toISOString()
    };
    await rememberInvestigation(ioc, cachedInvestigation, sender);
    return cachedInvestigation;
  }

  const results = [];
  for (const [providerId, provider] of Object.entries(PROVIDERS)) {
    const providerSettings = settings.providers?.[providerId];
    if (!providerSettings?.enabled) continue;
    if (!provider.supportedTypes.includes(ioc.type)) continue;
    if (!providerSettings?.apiKey) {
      results.push({
        provider: provider.name,
        success: false,
        summary: 'API key not configured — external lookup available',
        error: 'API key not configured',
        externalUrl: provider.buildExternalUrl ? provider.buildExternalUrl(ioc) : undefined
      });
      continue;
    }
    try {
      const result = await provider.lookup(ioc, providerSettings.apiKey);
      results.push({ timestamp: new Date().toISOString(), ...result });
    } catch (error) {
      const humanMessage = humanizeProviderError(error, provider.name);
      results.push({ provider: provider.name, success: false, summary: humanMessage, error: humanMessage, timestamp: new Date().toISOString(), externalUrl: provider.buildExternalUrl ? provider.buildExternalUrl(ioc) : undefined });
    }
  }

  const orderedResults = sortProviderResults(results);
  const summary = summarizeProviderVerdict(orderedResults);
  const investigation = {
    ioc,
    providerResults: orderedResults,
    cached: false,
    ...summary,
    timestamp: new Date().toISOString()
  };
  const cacheWrite = await setCachedResult(cacheKey, investigation);
  await rememberInvestigation(ioc, investigation, sender);
  if (cacheWrite && cacheWrite.quota) {
    investigation.storageWarning = 'Cache storage limit reached. Results are shown, but long-term cache was reduced.';
  }
  return investigation;
}
