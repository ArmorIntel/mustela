const SETTINGS_KEY = 'mustela_settings';
const HISTORY_KEY = 'mustela_history';
const CACHE_KEY = 'mustela_cache';
const DETECTED_KEY = 'mustela_last_detected';
const DISABLED_PAGES_KEY = 'mustela_disabled_pages';
const MAX_CACHE_ENTRIES = 30;
const MAX_HISTORY_ENTRIES = 50;

export const DEFAULT_SETTINGS = {
  highlightEnabled: true,
  detectionMode: 'balanced',
  providers: {
    virustotal: { enabled: true, apiKey: '' },
    abuseipdb: { enabled: true, apiKey: '' },
    shodan: { enabled: true, apiKey: '' }
  },
  cacheTtlMinutes: 30
};

function getStorageArea() {
  return chrome.storage.local;
}

function sanitizeInvestigationForStorage(value) {
  if (!value || typeof value !== 'object') return value;
  return {
    ...value,
    providerResults: Array.isArray(value.providerResults)
      ? value.providerResults.map((provider) => ({
          provider: provider.provider,
          success: provider.success,
          timestamp: provider.timestamp,
          verdict: provider.verdict,
          confidence: provider.confidence,
          summary: provider.summary,
          externalUrl: provider.externalUrl,
          error: provider.error,
          meta: provider.meta
        }))
      : []
  };
}

function compactHistoryIoc(ioc) {
  if (!ioc || typeof ioc !== 'object') return null;
  return {
    type: ioc.type,
    raw: ioc.raw,
    normalized: ioc.normalized,
    confidence: ioc.confidence,
    sourceContext: ioc.sourceContext
      ? {
          pageUrl: ioc.sourceContext.pageUrl,
          pageTitle: ioc.sourceContext.pageTitle
        }
      : undefined
  };
}

export function buildHistoryKey(entry) {
  const type = String(entry?.ioc?.type || entry?.type || '').trim();
  const normalized = String(entry?.ioc?.normalized || entry?.normalized || '').trim().toLowerCase();
  return type && normalized ? `${type}:${normalized}` : '';
}

export function normalizeHistoryEntry(entry) {
  const timestamp = entry?.lastSeen || entry?.timestamp || new Date().toISOString();
  const firstSeen = entry?.firstSeen || timestamp;
  const ioc = compactHistoryIoc(entry?.ioc || entry);
  const pageUrl = entry?.pageUrl || ioc?.sourceContext?.pageUrl || '';
  const pageTitle = entry?.pageTitle || ioc?.sourceContext?.pageTitle || '';
  const historyKey = buildHistoryKey({ ioc });

  return {
    historyKey,
    ioc,
    type: ioc?.type || entry?.type || '',
    normalized: ioc?.normalized || entry?.normalized || '',
    firstSeen,
    lastSeen: timestamp,
    seenCount: Math.max(1, Number(entry?.seenCount || 1)),
    overallVerdict: entry?.overallVerdict || 'unknown',
    score: Number(entry?.score || 0),
    pinned: !!entry?.pinned,
    pinnedAt: entry?.pinnedAt || '',
    analystNote: String(entry?.analystNote || ''),
    analystNoteUpdatedAt: entry?.analystNoteUpdatedAt || '',
    pageUrl,
    pageTitle
  };
}

export function mergeHistoryEntries(history, incomingEntry, limit = MAX_HISTORY_ENTRIES) {
  const incoming = normalizeHistoryEntry(incomingEntry);
  if (!incoming.historyKey) return (Array.isArray(history) ? history : []).slice(0, limit);

  const current = Array.isArray(history)
    ? history.map((entry) => normalizeHistoryEntry(entry)).filter((entry) => entry.historyKey)
    : [];

  const existingIndex = current.findIndex((entry) => entry.historyKey === incoming.historyKey);
  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    current.splice(existingIndex, 1);
    current.unshift({
      ...existing,
      ...incoming,
      firstSeen: existing.firstSeen || incoming.firstSeen,
      lastSeen: incoming.lastSeen,
      seenCount: Math.max(1, Number(existing.seenCount || 1)) + 1,
      score: Number(incoming.score || existing.score || 0),
      overallVerdict: incoming.overallVerdict || existing.overallVerdict || 'unknown',
      pinned: incoming.pinned || existing.pinned || false,
      pinnedAt: incoming.pinnedAt || existing.pinnedAt || '',
      analystNote: incoming.analystNote || existing.analystNote || '',
      analystNoteUpdatedAt: incoming.analystNoteUpdatedAt || existing.analystNoteUpdatedAt || '',
      pageUrl: incoming.pageUrl || existing.pageUrl || '',
      pageTitle: incoming.pageTitle || existing.pageTitle || '',
      ioc: incoming.ioc || existing.ioc
    });
  } else {
    current.unshift(incoming);
  }

  return current
    .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')))
    .slice(0, limit);
}

async function safeSet(payload) {
  try {
    await getStorageArea().set(payload);
    return { ok: true };
  } catch (error) {
    const message = error?.message || String(error);
    if (/quota/i.test(message)) return { ok: false, quota: true, error: message };
    throw error;
  }
}

export async function getSettings() {
  const data = await getStorageArea().get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}), providers: { ...DEFAULT_SETTINGS.providers, ...((data[SETTINGS_KEY] || {}).providers || {}) } };
}

export async function saveSettings(settings) {
  const sanitized = {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    detectionMode: settings?.detectionMode === 'strict' ? 'strict' : 'balanced',
    providers: { ...DEFAULT_SETTINGS.providers, ...((settings || {}).providers || {}) }
  };
  await getStorageArea().set({ [SETTINGS_KEY]: sanitized });
  return sanitized;
}

export async function getHistory() {
  const data = await getStorageArea().get(HISTORY_KEY);
  return (data[HISTORY_KEY] || []).map((entry) => normalizeHistoryEntry(entry));
}

export async function addHistory(entry) {
  const history = await getHistory();
  const merged = mergeHistoryEntries(history, entry);
  await getStorageArea().set({ [HISTORY_KEY]: merged });
  return merged[0] || null;
}

export async function getHistoryEntry(historyKey) {
  const history = await getHistory();
  return history.find((entry) => entry.historyKey === historyKey) || null;
}

export async function toggleHistoryPin(historyKey, pinned) {
  const history = await getHistory();
  const next = history.map((entry) => {
    if (entry.historyKey !== historyKey) return entry;
    return {
      ...entry,
      pinned: !!pinned,
      pinnedAt: pinned ? new Date().toISOString() : ''
    };
  });
  await getStorageArea().set({ [HISTORY_KEY]: next });
  return next;
}

export async function saveHistoryNote(historyKey, analystNote) {
  const history = await getHistory();
  let updated = null;
  const next = history.map((entry) => {
    if (entry.historyKey !== historyKey) return entry;
    updated = {
      ...entry,
      analystNote: String(analystNote || '').trim(),
      analystNoteUpdatedAt: new Date().toISOString()
    };
    return updated;
  });
  if (!updated) return null;
  await getStorageArea().set({ [HISTORY_KEY]: next });
  return updated;
}

export async function clearHistory() {
  await getStorageArea().set({ [HISTORY_KEY]: [] });
}

export async function getCache() {
  const data = await getStorageArea().get(CACHE_KEY);
  return data[CACHE_KEY] || {};
}

export async function getCachedResult(key, ttlMinutes) {
  const cache = await getCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMinutes * 60 * 1000) return null;
  return entry.value;
}

export async function setCachedResult(key, value) {
  const cache = await getCache();
  cache[key] = { timestamp: Date.now(), value: sanitizeInvestigationForStorage(value) };

  const ordered = Object.entries(cache)
    .sort((a, b) => Number(b[1]?.timestamp || 0) - Number(a[1]?.timestamp || 0))
    .slice(0, MAX_CACHE_ENTRIES);

  const trimmedCache = Object.fromEntries(ordered);
  let write = await safeSet({ [CACHE_KEY]: trimmedCache });
  if (write.ok) return { ok: true };

  const smaller = Object.fromEntries(ordered.slice(0, Math.max(10, Math.floor(MAX_CACHE_ENTRIES / 2))));
  write = await safeSet({ [CACHE_KEY]: smaller });
  if (write.ok) return { ok: true, degraded: true };

  await getStorageArea().set({ [CACHE_KEY]: {} });
  return { ok: false, quota: true, degraded: true };
}

export async function clearCache() {
  await getStorageArea().set({ [CACHE_KEY]: {} });
}

export async function saveDetectedForTab(tabId, detected) {
  const data = await getStorageArea().get(DETECTED_KEY);
  const current = data[DETECTED_KEY] || {};
  current[String(tabId)] = detected;
  await getStorageArea().set({ [DETECTED_KEY]: current });
}

export async function getDetectedForTab(tabId) {
  const data = await getStorageArea().get(DETECTED_KEY);
  const current = data[DETECTED_KEY] || {};
  return current[String(tabId)] || [];
}

export async function getDisabledPages() {
  const data = await getStorageArea().get(DISABLED_PAGES_KEY);
  return data[DISABLED_PAGES_KEY] || [];
}

export async function isPageDisabled(url) {
  const pages = await getDisabledPages();
  return pages.includes(url);
}

export async function setPageDisabled(url, disabled) {
  const pages = await getDisabledPages();
  const next = disabled ? Array.from(new Set([...pages, url])) : pages.filter((entry) => entry !== url);
  await getStorageArea().set({ [DISABLED_PAGES_KEY]: next });
  return disabled;
}

export async function clearDisabledPages() {
  await getStorageArea().set({ [DISABLED_PAGES_KEY]: [] });
}
