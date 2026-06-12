import { isProviderSupportedForIoc } from '../providers/providers.js';
import { detectSingleIoc } from '../shared/ioc.js';

export function buildIocKey(ioc) {
  const type = String(ioc?.type || '').trim().toLowerCase();
  const normalized = String(ioc?.normalized || '').trim().toLowerCase();
  return type && normalized ? `${type}:${normalized}` : '';
}

export function findSameIocHistory(history, currentIocs) {
  const keys = (Array.isArray(currentIocs) ? currentIocs : []).map(buildIocKey).filter(Boolean);
  return (Array.isArray(history) ? history : []).find((entry) => keys.includes(String(entry?.historyKey || '').toLowerCase())) || null;
}

export function mapCurrentIocsToHistory(history, currentIocs) {
  const entries = Array.isArray(history) ? history : [];
  return (Array.isArray(currentIocs) ? currentIocs : []).map((ioc) => {
    const historyKey = buildIocKey(ioc);
    const lastInvestigation = historyKey
      ? entries.find((entry) => String(entry?.historyKey || '').toLowerCase() === historyKey)
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
      chip: String(ioc.type || 'TYPE').toUpperCase(),
      hint: `IOC recognized: ${String(ioc.type || 'ioc').toUpperCase()}. Press Enter or use Investigate.`,
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
    hint: raw ? 'Try a single IP, subnet, ASN, domain, URL, or hash.' : 'Paste a single IOC to investigate it instantly.',
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
