import { buildThreatSummary, detectSingleIoc, isProtectedIoc, PUBLIC_LOOKUP_BLOCK_REASON, PROTECTED_IPV4_EXPLANATION, summarizeProviderVerdict } from '../shared/ioc.js';
import { generateCorrelationAnalysis, generateInvestigationSummary, validateOpenAiCompatibleConfig } from '../integrations/assistants.js';
import { addIocToMisp, isProviderSupportedForIoc, PROVIDERS } from '../providers/providers.js';
import { addHistory, clearCache, clearDisabledPages, clearHistory, getCachedResult, getDetectedForTab, getHistory, getHistoryEntry, getSettings, isPageDisabled, saveDetectedForTab, saveHistoryNote, saveHistoryTlp, saveSettings, setCachedResult, setPageDisabled, toggleHistoryPin } from '../storage/storage.js';

import { createTransmissionGate, pauseFailure } from './pause.js';

const transmissions = createTransmissionGate();
const TRANSMISSION_MESSAGES = new Set(['LOOKUP_IOC', 'OPEN_EXTERNAL_PROVIDER', 'CORRELATE_IOCS', 'ADD_IOC_TO_MISP', 'TEST_API_KEY']);

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

async function openInvestigationPanel(ioc, tab) {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL', payload: ioc });
  } catch (error) {
    console.debug('Unable to open in-page investigation panel', error);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const token = await transmissions.begin();
    return await handleInvestigationMenu(info, tab, token);
  } catch (error) {
    const failure = pauseFailure(error);
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: 'MUSTELA_ACTION_BLOCKED', ...failure }).catch(() => undefined);
    }
    return failure;
  }
});

async function handleInvestigationMenu(info, tab, token) {
  const detected = detectSingleIoc(info.selectionText || '');
  if (!detected) return;

  if (isProtectedIoc(detected) && ['open-virustotal', 'open-abuseipdb', 'open-shodan'].includes(info.menuItemId)) {
    // Explain the blocked pivot in the panel instead of silently doing nothing.
    await transmissions.run(token, () => openInvestigationPanel(detected, tab));
    return;
  }

  if (info.menuItemId === 'open-virustotal') {
    const url = PROVIDERS.virustotal.buildExternalUrl?.(detected);
    if (url) await transmissions.run(token, () => chrome.tabs.create({ url }));
    return;
  }
  if (info.menuItemId === 'open-abuseipdb' && isProviderSupportedForIoc('abuseipdb', detected)) {
    const url = PROVIDERS.abuseipdb.buildExternalUrl?.(detected);
    if (url) await transmissions.run(token, () => chrome.tabs.create({ url }));
    return;
  }
  if (info.menuItemId === 'open-shodan' && isProviderSupportedForIoc('shodan', detected)) {
    const url = PROVIDERS.shodan.buildExternalUrl?.(detected);
    if (url) await transmissions.run(token, () => chrome.tabs.create({ url }));
    return;
  }
  if (info.menuItemId !== 'investigate-selection') return;
  await transmissions.run(token, () => openInvestigationPanel(detected, tab));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => {
    sendResponse(pauseFailure(error));
  });
  return true;
});

async function handleMessage(message, sender) {
  const token = TRANSMISSION_MESSAGES.has(message?.type) ? await transmissions.begin() : undefined;
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
    case 'GET_PAUSE_STATE':
      return { ok: true, data: await transmissions.getState() };
    case 'SET_PAUSE_STATE':
      return { ok: true, data: await transmissions.setState(message.payload?.paused) };
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
      return { ok: true, data: await lookupIoc(message.payload, sender, token) };
    case 'OPEN_EXTERNAL_PROVIDER': {
      const provider = PROVIDERS[message.payload?.provider];
      const ioc = message.payload?.ioc;
      if (!provider || !ioc || !provider.buildExternalUrl) return { ok: false, error: 'Unsupported provider' };
      if (provider.external !== false && isProtectedIoc(ioc)) return { ok: false, error: PUBLIC_LOOKUP_BLOCK_REASON };
      if (!isProviderSupportedForIoc(provider.id, ioc)) return { ok: false, error: 'Unsupported IOC for provider' };
      const url = provider.buildExternalUrl(ioc);
      if (!url) return { ok: false, error: 'External lookup unavailable' };
      await transmissions.run(token, () => chrome.tabs.create({ url }));
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
    case 'SAVE_HISTORY_TLP':
      return { ok: true, data: await saveHistoryTlp(message.payload?.historyKey, message.payload?.tlp) };
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
      const providerId = message.payload?.provider;
      if (providerId === 'llm') {
        const result = await transmissions.run(token, () => validateOpenAiCompatibleConfig(message.payload));
        return { ok: true, data: { valid: !!result.ok, limited: !!result.limited, message: result.message || (result.ok ? 'Connection valid' : 'Validation failed') } };
      }
      const provider = PROVIDERS[providerId];
      if (!provider || !provider.validateApiKey) return { ok: false, error: 'Unsupported provider' };
      const result = await transmissions.run(token, () => provider.validateApiKey(message.payload, () => transmissions.run(token, () => undefined)));
      return { ok: true, data: { valid: !!result.ok, limited: !!result.limited, message: result.message || (result.ok ? 'API key valid' : 'Invalid API key') } };
    }
    case 'CORRELATE_IOCS': {
      const settings = await getSettings();
      const llm = settings?.analystAssist || {};
      if (!llm.enabled || !llm.baseUrl || !llm.apiKey || !llm.model) {
        return { ok: false, error: 'Analyst Assist is not configured or disabled — set it up in settings.' };
      }
      const history = await getHistory();
      const entries = selectCorrelationEntries(history);
      if (entries.length < 2) return { ok: false, error: 'Not enough eligible investigation history for correlation: internal/reserved IPv4 entries are excluded; at least two eligible entries are required.' };
      const { pageUrl = '', pageTitle = '' } = message?.payload || {};
      const result = await transmissions.run(token, () => generateCorrelationAnalysis(entries, llm, { pageUrl, pageTitle }));
      return { ok: true, data: result };
    }
    case 'ADD_IOC_TO_MISP': {
      const settings = await getSettings();
      const ioc = message.payload?.ioc;
      if (!ioc?.normalized || !ioc?.type) return { ok: false, error: 'Invalid IOC' };
      const result = await transmissions.run(token, () => addIocToMisp(ioc, settings.providers?.misp || {}, {
        eventId: message.payload?.eventId,
        comment: message.payload?.comment,
        tlp: message.payload?.tlp
      }));
      return { ok: true, data: result };
    }
    default:
      return { ok: false, error: `Unknown message type: ${message?.type}` };
  }
}



function humanizeProviderError(error, providerName) {
  const status = Number(error?.status || String(error?.message || '').match(/HTTP\s+(\d+)/)?.[1] || 0);
  const provider = providerName || error?.provider || 'Provider';
  if (status === 401) return `${provider} rejected the API key.`;
  if (status === 403) {
    if (provider === 'Shodan') return 'Shodan access denied. Your API key may be valid, but this lookup can require additional access or credits.';
    if (provider === 'MISP' && error?.context === 'add') return 'MISP denied the add request. Check event permissions or the API key role.';
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
  const providerBias = providerResult?.provider === 'AbuseIPDB'
    ? 4
    : providerResult?.provider === 'VirusTotal'
      ? 3
      : providerResult?.provider === 'MISP'
        ? 2
        : providerResult?.provider === 'Shodan'
          ? 1
          : 0;
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

function selectCorrelationEntries(history) {
  const MAX_IOCS = 10;
  const all = Array.isArray(history) ? history : [];
  const threatPriority = (e) => {
    switch (e.overallVerdict) {
      case 'malicious': return 3;
      case 'suspicious': return 2;
      case 'clean': return 1;
      default: return 0;
    }
  };
  return all.filter((entry) => !isProtectedIoc(entry.ioc || entry))
    .sort((a, b) => {
      const tDiff = threatPriority(b) - threatPriority(a);
      if (tDiff !== 0) return tDiff;
      return new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0);
    })
    .slice(0, MAX_IOCS);
}

async function rememberInvestigation(ioc, investigation, sender = {}) {
  const pageUrl = ioc?.sourceContext?.pageUrl || sender?.tab?.url || '';
  const pageTitle = ioc?.sourceContext?.pageTitle || sender?.tab?.title || '';
  const llmSummary = investigation?.llmSummary || {};
  const summaryText = llmSummary.summary || investigation?.threatSummary?.narrative || investigation?.explanation || '';
  const actionText = llmSummary.action || investigation?.recommendation?.action || '';
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
    summaryText,
    summarySource: llmSummary.summary ? 'llm' : 'builtin',
    actionText,
    actionSource: llmSummary.action ? 'llm' : 'builtin',
    timestamp: investigation.timestamp || new Date().toISOString(),
    pageUrl,
    pageTitle
  });
}

function buildProviderCacheProfile(settings = {}) {
  const providers = settings.providers || {};
  return JSON.stringify({
    schema: 2,
    providers: Object.fromEntries(Object.entries(providers).map(([providerId, providerSettings]) => [providerId, {
      enabled: !!providerSettings?.enabled,
      hasKey: !!String(providerSettings?.apiKey || '').trim(),
      baseUrl: String(providerSettings?.baseUrl || '').trim(),
      defaultEventId: String(providerSettings?.defaultEventId || '').trim()
    }])),
    analystAssist: {
      enabled: !!settings?.analystAssist?.enabled,
      hasKey: !!String(settings?.analystAssist?.apiKey || '').trim(),
      baseUrl: String(settings?.analystAssist?.baseUrl || '').trim(),
      model: String(settings?.analystAssist?.model || '').trim()
    }
  });
}

async function maybeAttachLlmSummary(settings, investigation, token) {
  transmissions.run(token, () => undefined);
  if (isProtectedIoc(investigation.ioc)) return investigation;
  const llm = settings?.analystAssist || {};
  if (!llm.enabled || !llm.baseUrl || !llm.apiKey || !llm.model) return investigation;

  try {
    const summary = await transmissions.run(token, () => generateInvestigationSummary(investigation, llm));
    return {
      ...investigation,
      llmSummary: summary
    };
  } catch (error) {
    return {
      ...investigation,
      llmSummary: {
        provider: 'OpenAI-compatible',
        model: String(llm.model || '').trim(),
        error: humanizeProviderError(error, 'LLM')
      }
    };
  }
}

async function lookupIoc(ioc, sender = {}, token) {
  const protectedIpv4 = isProtectedIoc(ioc);
  const settings = await getSettings();
  const providerFingerprint = btoa(buildProviderCacheProfile(settings));
  const cacheKey = `${ioc.type}:${ioc.normalized}:${providerFingerprint}`;
  // Never reuse legacy public results, links or AI briefs for protected IPv4.
  const cached = protectedIpv4 || ioc?._rerun ? null : await getCachedResult(cacheKey, settings.cacheTtlMinutes || 30);
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
    transmissions.run(token, () => undefined);
    if (protectedIpv4 && provider.external !== false) {
      results.push({ provider: provider.name, success: false, blocked: true, summary: PUBLIC_LOOKUP_BLOCK_REASON });
      continue;
    }
    const providerSettings = settings.providers?.[providerId];
    if (!providerSettings?.enabled) continue;
    if (!provider.supportedTypes.includes(ioc.type)) continue;
    const configured = typeof provider.isConfigured === 'function'
      ? provider.isConfigured(providerSettings)
      : !!providerSettings?.apiKey;
    if (!configured) {
      results.push({
        provider: provider.name,
        success: false,
        summary: providerId === 'misp'
          ? 'MISP not configured — set base URL and API key'
          : 'API key not configured — external lookup available',
        error: providerId === 'misp' ? 'MISP not configured' : 'API key not configured',
        externalUrl: provider.buildExternalUrl ? provider.buildExternalUrl(ioc) : undefined
      });
      continue;
    }
    try {
      const result = await transmissions.run(token, () => provider.lookup(ioc, providerSettings));
      results.push({ timestamp: new Date().toISOString(), ...result });
    } catch (error) {
      const humanMessage = humanizeProviderError(error, provider.name);
      results.push({ provider: provider.name, success: false, summary: humanMessage, error: humanMessage, timestamp: new Date().toISOString(), externalUrl: provider.buildExternalUrl ? provider.buildExternalUrl(ioc) : undefined });
    }
  }

  const orderedResults = sortProviderResults(results);
  const summary = summarizeProviderVerdict(orderedResults);
  if (protectedIpv4) {
    summary.explanation = PROTECTED_IPV4_EXPLANATION;
    summary.threatSummary.narrative = `${PROTECTED_IPV4_EXPLANATION} ${summary.threatSummary.narrative}`;
  }
  const investigation = {
    ioc,
    providerResults: orderedResults,
    cached: false,
    ...summary,
    timestamp: new Date().toISOString()
  };
  const enrichedInvestigation = await maybeAttachLlmSummary(settings, investigation, token);
  const cacheWrite = await setCachedResult(cacheKey, enrichedInvestigation);
  await rememberInvestigation(ioc, enrichedInvestigation, sender);
  if (cacheWrite && cacheWrite.quota) {
    enrichedInvestigation.storageWarning = 'Cache storage limit reached. Results are shown, but long-term cache was reduced.';
  }
  return enrichedInvestigation;
}
