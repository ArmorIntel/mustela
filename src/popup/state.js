import { isProviderSupportedForIoc } from '../providers/providers.js';
import { detectSingleIoc, isProtectedIoc, PROTECTED_IPV4_EXPLANATION } from '../shared/ioc.js';

// Never display an optimistic OFF: only the background owns durable pause state.
export function createPauseController(send, render) {
  let state = { paused: null, pending: false, error: '' };
  let revision = 0;
  let writing = false;
  const update = (patch) => { state = { ...state, ...patch }; render({ ...state }); };
  const read = async () => {
    const response = await send('GET_PAUSE_STATE');
    if (!response?.ok || typeof response.data?.paused !== 'boolean') {
      throw new Error(response?.error || 'Unable to read pause state. Please retry.');
    }
    return response.data.paused;
  };
  async function refresh() {
    const request = ++revision;
    try {
      const paused = await read();
      if (request === revision) update({ paused, error: '' });
    } catch (error) {
      if (request === revision) update({ error: error.message || String(error) });
    }
  }
  const controller = {
    refresh,
    retry() {
      if (!state.error || writing) return;
      return controller.toggle();
    },
    async toggle() {
      if (writing) return;
      if (state.paused === null) return refresh();
      writing = true;
      update({ pending: true, error: '' });
      try {
        const response = await send('SET_PAUSE_STATE', { paused: !state.paused });
        if (!response?.ok) throw new Error(response?.error || 'Unable to save pause state. Please retry.');
        await refresh();
      } catch (error) {
        await refresh();
        update({ error: error.message || String(error) });
      } finally {
        writing = false;
        update({ pending: false });
      }
    }
  };
  return controller;
}

export function buildIocKey(ioc) {
  const type = String(ioc?.type || '').trim().toLowerCase();
  const value = String(ioc?.normalized || '').trim();
  const normalized = type === 'email' ? value : value.toLowerCase();
  return type && normalized ? `${type}:${normalized}` : '';
}

function historyIdentity(entry) {
  const key = String(entry?.historyKey || '');
  return key.startsWith('email:') ? key : key.toLowerCase();
}

export function findSameIocHistory(history, currentIocs) {
  const keys = (Array.isArray(currentIocs) ? currentIocs : []).map(buildIocKey).filter(Boolean);
  return (Array.isArray(history) ? history : []).find((entry) => keys.includes(historyIdentity(entry))) || null;
}

export function mapCurrentIocsToHistory(history, currentIocs) {
  const entries = Array.isArray(history) ? history : [];
  return (Array.isArray(currentIocs) ? currentIocs : []).map((ioc) => {
    const historyKey = buildIocKey(ioc);
    const lastInvestigation = historyKey
      ? entries.find((entry) => historyIdentity(entry) === historyKey)
      : null;
    return {
      ...ioc,
      historyKey,
      alreadyInvestigated: !!lastInvestigation,
      lastInvestigation: lastInvestigation || null
    };
  });
}

export function applyHistoryFilter(history, currentUrl, sameIocEntry, filter = 'all') {
  const list = Array.isArray(history) ? history : [];
  switch (filter) {
    case 'same-page':
      return list.filter((entry) => entry?.pageUrl && entry.pageUrl === currentUrl);
    case 'same-ioc':
      return sameIocEntry ? list.filter((entry) => entry?.historyKey === sameIocEntry.historyKey) : [];
    case 'pinned':
      return list.filter((entry) => entry?.pinned);
    default:
      return list;
  }
}

export function summarizeHistoryContext(history, currentUrl, currentIocs, filter = 'all') {
  const recent = Array.isArray(history) ? history.slice(0, 8) : [];
  const samePageEntry = recent.find((entry) => entry?.pageUrl && entry.pageUrl === currentUrl) || null;
  const sameIocEntry = findSameIocHistory(recent, currentIocs);
  const filtered = applyHistoryFilter(recent, currentUrl, sameIocEntry, filter).slice(0, 5);
  return { recent, samePageEntry, sameIocEntry, filtered };
}

export function getManualLookupState(input) {
  const raw = String(input || '').trim();
  const ioc = raw ? detectSingleIoc(raw) : null;
  if (ioc) {
    return {
      raw,
      ioc,
      chip: isProtectedIoc(ioc) ? 'Internal / reserved' : String(ioc.type || 'TYPE').toUpperCase(),
      hint: isProtectedIoc(ioc) ? PROTECTED_IPV4_EXPLANATION : `IOC recognized: ${String(ioc.type || 'ioc').toUpperCase()}. Press Enter or use Investigate.`,
      pivots: {
        virustotal: isProviderSupportedForIoc('virustotal', ioc),
        abuseipdb: isProviderSupportedForIoc('abuseipdb', ioc),
        shodan: isProviderSupportedForIoc('shodan', ioc)
      }
    };
  }
  return {
    raw,
    ioc: null,
    chip: 'TYPE',
    hint: raw ? 'Try a single IP, subnet, ASN, email, domain, URL, or hash.' : 'Paste a single IOC to investigate it instantly.',
    pivots: {
      virustotal: false,
      abuseipdb: false,
      shodan: false
    }
  };
}

export function choosePrimaryInvestigationTarget(currentIocs, history, currentUrl) {
  const items = Array.isArray(currentIocs) ? currentIocs : [];
  const recent = Array.isArray(history) ? history : [];
  const reopened = items.find((ioc) => ioc?.alreadyInvestigated);
  if (reopened) return reopened;
  if (items.length) return items[0];
  const samePage = recent.find((entry) => entry?.pageUrl === currentUrl || entry?.ioc?.sourceContext?.pageUrl === currentUrl);
  return samePage?.ioc || null;
}
