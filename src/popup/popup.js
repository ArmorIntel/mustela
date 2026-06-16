import { applyHistoryFilter, findSameIocHistory, getManualLookupState, mapCurrentIocsToHistory } from './state.js';

async function send(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

const historyState = {
  filter: 'all'
};

const currentPageState = {
  expanded: false,
  items: []
};

const CURRENT_PAGE_PREVIEW_LIMIT = 5;

function render(disabled) {
  const btn = document.getElementById('toggleBtn');
  btn.classList.remove('power-on', 'power-off');
  btn.classList.add(disabled ? 'power-on' : 'power-off');
  btn.title = disabled ? 'Enable extension on this page' : 'Disable extension on this page';
  btn.setAttribute('aria-label', btn.title);
}

function formatRelativeTime(value) {
  if (!value) return 'just now';
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function verdictLabel(verdict) {
  switch (verdict) {
    case 'malicious': return 'Malicious';
    case 'suspicious': return 'Suspicious';
    case 'clean': return 'Low signal';
    default: return 'Unknown';
  }
}

function compactHistoryPageLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const withoutProtocol = text.replace(/^https?:\/\//i, '');
  const withoutWww = withoutProtocol.replace(/^www\./i, '');
  const compact = withoutWww.replace(/\/$/, '');
  return compact.length > 36 ? `${compact.slice(0, 33)}…` : compact;
}

function formatIocType(type) {
  const value = String(type || '').trim().toLowerCase();
  const labels = {
    ip: 'IP',
    url: 'URL',
    asn: 'ASN',
    md5: 'MD5',
    sha1: 'SHA1',
    sha256: 'SHA256',
    domain: 'DOMAIN',
    subnet: 'SUBNET'
  };
  return labels[value] || String(type || '').slice(0, 6).toUpperCase() || 'IOC';
}

function getCurrentPageStatusLabel(ioc) {
  if (!ioc?.alreadyInvestigated) return '';
  const verdict = verdictLabel(ioc?.lastInvestigation?.overallVerdict);
  const seen = formatRelativeTime(ioc?.lastInvestigation?.lastSeen);
  const count = Number(ioc?.lastInvestigation?.seenCount || 1);
  return `In history · ${verdict} · ${seen}${count > 1 ? ` · ${count} runs` : ''}`;
}

async function copyIocValue(ioc) {
  const value = ioc?.normalized || ioc?.raw || '';
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function armCopyFeedback(element, { idleLabel, successLabel = 'Copied', duration = 900 } = {}) {
  if (!element) return;
  const baseText = element.dataset.copyLabel || idleLabel || element.textContent || '';
  element.dataset.copyLabel = baseText;
  if (idleLabel) {
    element.setAttribute('aria-label', idleLabel);
    element.title = idleLabel;
  }
  const handleCopy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const value = element.dataset.copyValue || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    const resetLabel = element.dataset.copyLabel || baseText;
    element.classList.add('is-copied');
    if ('copyFeedback' in element.dataset) {
      element.dataset.copyFeedback = successLabel;
    }
    if (idleLabel) {
      element.setAttribute('aria-label', successLabel);
      element.title = successLabel;
    }
    if (element.dataset.copyTimer) window.clearTimeout(Number(element.dataset.copyTimer));
    element.dataset.copyTimer = String(window.setTimeout(() => {
      element.classList.remove('is-copied');
      if ('copyFeedback' in element.dataset) {
        element.dataset.copyFeedback = '';
      }
      if (idleLabel) {
        element.setAttribute('aria-label', resetLabel);
        element.title = resetLabel;
      }
      delete element.dataset.copyTimer;
    }, duration));
  };
  element.addEventListener('click', handleCopy);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') return handleCopy(event);
  });
}

function buildActionIcon(kind) {
  if (kind === 'investigate') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="M20 20l-4.2-4.2"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"></rect><rect x="5" y="5" width="10" height="10" rx="2"></rect></svg>';
}

function setIconButtonContent(button, kind, label) {
  button.innerHTML = `${buildActionIcon(kind)}<span class="sr-only">${label}</span>`;
}

function createIconActionButton({ kind, label, extraClass = '' }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `ioc-action icon-only${extraClass ? ` ${extraClass}` : ''}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  setIconButtonContent(button, kind, label);
  return button;
}

function renderCurrentPageList(onInvestigate, onReopen) {
  const list = document.getElementById('iocList');
  const footer = document.getElementById('iocListFooter');
  const hint = document.getElementById('iocListHint');
  const toggle = document.getElementById('iocListToggleBtn');
  if (!list || !footer || !hint || !toggle) return;

  const items = Array.isArray(currentPageState.items) ? currentPageState.items : [];
  const visible = currentPageState.expanded ? items : items.slice(0, CURRENT_PAGE_PREVIEW_LIMIT);

  list.innerHTML = '';
  visible.forEach((ioc) => {
    const li = document.createElement('li');
    li.className = `ioc-item${ioc?.alreadyInvestigated ? ' investigated' : ''}`;

    const main = document.createElement('div');
    main.className = 'ioc-main';

    const head = document.createElement('div');
    head.className = 'ioc-head';

    const type = document.createElement('span');
    type.className = 'ioc-type';
    type.textContent = formatIocType(ioc?.type);

    const value = document.createElement('span');
    value.className = 'ioc-value';
    value.tabIndex = 0;
    value.setAttribute('role', 'button');
    value.textContent = ioc?.normalized || ioc?.raw || 'Unknown IOC';
    value.dataset.copyValue = ioc?.normalized || ioc?.raw || '';
    value.dataset.copyFeedback = '';
    armCopyFeedback(value, { idleLabel: 'Copy IOC value' });

    head.append(type, value);
    main.append(head);

    const tools = document.createElement('div');
    tools.className = 'ioc-tools';

    if (ioc?.alreadyInvestigated) {
      main.classList.add('stacked');

      const statusRow = document.createElement('div');
      statusRow.className = 'ioc-status-row';

      const status = document.createElement('span');
      status.className = 'ioc-status';
      status.textContent = getCurrentPageStatusLabel(ioc);

      const reopenBtn = document.createElement('button');
      reopenBtn.type = 'button';
      reopenBtn.className = 'ioc-action secondary';
      reopenBtn.textContent = 'Open details';
      reopenBtn.addEventListener('click', () => onReopen(ioc?.lastInvestigation || ioc));

      statusRow.append(status, reopenBtn);
      main.append(statusRow);
    } else {
      const investigateBtn = createIconActionButton({ kind: 'investigate', label: 'Investigate IOC', extraClass: 'primary' });
      investigateBtn.addEventListener('click', () => onInvestigate(ioc));
      tools.append(investigateBtn);
    }

    if (tools.childElementCount > 0) {
      li.append(main, tools);
    } else {
      li.append(main);
    }
    list.appendChild(li);
  });

  const hasOverflow = items.length > CURRENT_PAGE_PREVIEW_LIMIT;
  footer.hidden = items.length === 0;
  toggle.hidden = !hasOverflow;
  if (!items.length) return;

  const hiddenCount = Math.max(0, items.length - visible.length);
  hint.textContent = currentPageState.expanded
    ? `Showing all ${items.length} detected IOC${items.length > 1 ? 's' : ''}. History stays limited to investigated IOC${items.length > 1 ? 's' : ''}.`
    : hiddenCount > 0
      ? `Showing ${visible.length}/${items.length}. History stays clean until you investigate.`
      : 'History stays clean until you investigate.';
  toggle.textContent = currentPageState.expanded ? 'Show less' : 'Show all';
}

function renderSummary(items, disabled, onInvestigate = () => {}, onReopen = () => {}) {
  const badge = document.getElementById('summaryBadge');
  const text = document.getElementById('summaryText');
  const footer = document.getElementById('iocListFooter');
  if (!badge || !text || !footer) return;

  currentPageState.items = Array.isArray(items) ? items : [];
  if (currentPageState.items.length <= CURRENT_PAGE_PREVIEW_LIMIT) currentPageState.expanded = false;
  renderCurrentPageList(onInvestigate, onReopen);

  if (disabled) {
    badge.textContent = 'Paused';
    text.textContent = 'The extension is disabled on this page.';
    footer.hidden = true;
    return;
  }

  if (!currentPageState.items.length) {
    badge.textContent = 'No IOC';
    text.textContent = 'No indicator detected yet on the active page. Manual lookup stays available below.';
    footer.hidden = true;
    return;
  }

  badge.textContent = `${currentPageState.items.length} IOC`;
  text.textContent = 'Current page stays actionable: investigate any detected IOC without polluting history for untouched detections.';
}

async function getCurrentPageIocs(tabId) {
  try {
    const detectedRes = await send('GET_DETECTED_IOCS', { tabId });
    if (Array.isArray(detectedRes?.data) && detectedRes.data.length) return detectedRes.data;
  } catch {}

  try {
    const pageRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_IOCS' });
    if (Array.isArray(pageRes?.data) && pageRes.data.length) return pageRes.data;
  } catch {}

  try {
    const rescan = await chrome.tabs.sendMessage(tabId, { type: 'RESCAN_PAGE_IOCS' });
    if (Array.isArray(rescan?.data)) return rescan.data;
  } catch {}

  return [];
}

function renderHistoryFilters(history, currentUrl, sameIocEntry, onChange) {
  const container = document.getElementById('historyFilters');
  if (!container) return;
  container.innerHTML = '';

  const samePageCount = history.filter((entry) => entry?.pageUrl && entry.pageUrl === currentUrl).length;
  const pinnedCount = history.filter((entry) => entry?.pinned).length;
  const filters = [
    { key: 'all', label: `All · ${history.length}` },
    { key: 'same-page', label: `Same page · ${samePageCount}`, hidden: samePageCount === 0 },
    { key: 'same-ioc', label: `Same IOC · ${sameIocEntry ? 1 : 0}`, hidden: !sameIocEntry },
    { key: 'pinned', label: `Pinned · ${pinnedCount}`, hidden: pinnedCount === 0 }
  ].filter((filter) => !filter.hidden);

  if (!filters.length || filters.length === 1) return;

  if (!filters.find((filter) => filter.key === historyState.filter)) {
    historyState.filter = 'all';
  }

  filters.forEach((filter) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `history-filter${historyState.filter === filter.key ? ' active' : ''}`;
    btn.textContent = filter.label;
    btn.addEventListener('click', () => {
      historyState.filter = filter.key;
      onChange();
    });
    container.appendChild(btn);
  });
}

function renderHistoryShortcuts(currentUrl, samePageEntry, sameIocEntry, openHistoryInvestigation) {
  const container = document.getElementById('historyShortcuts');
  if (!container) return;
  container.innerHTML = '';

  const shortcuts = [];
  if (samePageEntry) shortcuts.push({ label: 'Open same page', entry: samePageEntry });
  if (sameIocEntry && sameIocEntry.historyKey !== samePageEntry?.historyKey) shortcuts.push({ label: 'Open same IOC', entry: sameIocEntry });

  shortcuts.forEach(({ label, entry }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-shortcut';
    const suffix = entry?.normalized || entry?.ioc?.normalized || currentUrl || 'recent match';
    btn.textContent = `${label} · ${suffix}`;
    btn.addEventListener('click', () => openHistoryInvestigation(entry));
    container.appendChild(btn);
  });
}

function renderHistory(history, currentUrl, currentIocs, openHistoryInvestigation, toggleHistoryPin) {
  const badge = document.getElementById('historyBadge');
  const text = document.getElementById('historyText');
  const list = document.getElementById('historyList');
  if (!badge || !text || !list) return;

  list.innerHTML = '';
  const recent = Array.isArray(history) ? history.slice(0, 8) : [];
  const samePageEntry = recent.find((entry) => entry?.pageUrl && entry.pageUrl === currentUrl) || null;
  const sameIocEntry = findSameIocHistory(recent, currentIocs);
  const filtered = applyHistoryFilter(recent, currentUrl, sameIocEntry, historyState.filter).slice(0, 5);
  badge.textContent = String(filtered.length);

  renderHistoryShortcuts(currentUrl, samePageEntry, sameIocEntry, openHistoryInvestigation);
  renderHistoryFilters(recent, currentUrl, sameIocEntry, () => renderHistory(history, currentUrl, currentIocs, openHistoryInvestigation, toggleHistoryPin));

  if (!recent.length) {
    text.textContent = 'No recent investigation yet. Run one lookup and the extension will keep it warm here.';
    return;
  }

  if (samePageEntry && sameIocEntry) {
    text.textContent = 'You already investigated this page and one current IOC — handy shortcut, less déjà vu.';
  } else if (samePageEntry) {
    text.textContent = 'A recent lookup already exists for this page — useful when reopening an investigation.';
  } else if (sameIocEntry) {
    text.textContent = 'A current IOC already exists in recent investigations — reopen it instead of redoing the whole dance.';
  } else {
    text.textContent = 'Recent investigations keep your last analyst pivots within reach.';
  }

  if (!filtered.length) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = '<div class="history-main"><strong>No match for this filter</strong><span class="history-meta">Switch back to All or pin a few investigations worth keeping close.</span></div>';
    list.appendChild(li);
    return;
  }

  filtered.forEach((entry) => {
    const li = document.createElement('li');
    li.className = `history-item${entry?.pinned ? ' pinned' : ''}`;

    const main = document.createElement('div');
    main.className = 'history-main';
    const title = document.createElement('strong');
    const pinPrefix = entry?.pinned ? '📌 ' : '';
    title.textContent = `${pinPrefix}${entry?.normalized || entry?.ioc?.normalized || 'Unknown IOC'}`;
    const meta = document.createElement('span');
    meta.className = 'history-meta';
    const pageLabel = compactHistoryPageLabel(entry?.pageTitle || entry?.pageUrl || '');
    const metaParts = [
      verdictLabel(entry?.overallVerdict),
      `score ${Number(entry?.score || 0)}`,
      `seen ${Number(entry?.seenCount || 1)}×`,
      formatRelativeTime(entry?.lastSeen)
    ];
    if (pageLabel) metaParts.push(pageLabel);
    meta.textContent = metaParts.join(' · ');
    main.append(title, meta);

    const tools = document.createElement('div');
    tools.className = 'history-tools';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'history-open';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => openHistoryInvestigation(entry));

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'history-pin';
    pinBtn.textContent = entry?.pinned ? 'Unpin' : 'Pin';
    pinBtn.addEventListener('click', () => toggleHistoryPin(entry));

    tools.append(openBtn, pinBtn);
    li.append(main, tools);
    list.appendChild(li);
  });
}

function renderInsight(entry) {
  const badge = document.getElementById('insightBadge');
  const text = document.getElementById('insightText');
  const action = document.getElementById('insightAction');
  if (!badge || !text || !action) return;

  if (!entry) {
    badge.textContent = 'Idle';
    text.textContent = 'Run an investigation to keep a short IOC brief in the popup.';
    action.textContent = '';
    return;
  }

  badge.textContent = `${verdictLabel(entry?.overallVerdict)} · ${Number(entry?.score || 0)}/100`;
  text.textContent = entry?.summaryText || 'No brief saved for this IOC yet.';
  const source = entry?.summarySource === 'llm' ? 'LLM brief' : 'Built-in brief';
  action.textContent = entry?.actionText ? `${source} · ${entry.actionText}` : source;
}

function renderCorrelation(state) {
  const card = document.getElementById('correlationResult');
  const btn = document.getElementById('correlateBtn');
  if (!card || !btn) return;

  if (state.loading) {
    btn.textContent = 'Correlating…';
    btn.disabled = true;
    card.hidden = true;
    return;
  }

  btn.textContent = 'Correlate with AI';

  if (state.error) {
    card.hidden = false;
    card.innerHTML = '';
    const msg = document.createElement('span');
    msg.className = 'muted';
    msg.textContent = state.error;
    card.appendChild(msg);
    return;
  }

  if (!state.result) {
    card.hidden = true;
    return;
  }

  const { patterns = [], verdict = '', action = '', iocCount = 0, model = '' } = state.result;
  card.hidden = false;
  card.innerHTML = '';

  const verdictEl = document.createElement('div');
  verdictEl.className = 'correlation-verdict';
  verdictEl.textContent = verdict || 'Analysis complete';

  const metaEl = document.createElement('div');
  metaEl.className = 'history-meta';
  metaEl.textContent = `${iocCount} IOC${iocCount !== 1 ? 's' : ''} · ${model}`;

  const patList = document.createElement('ul');
  patList.className = 'correlation-patterns';
  (patterns.length ? patterns : ['No clear pattern detected.']).forEach((p) => {
    const li = document.createElement('li');
    li.textContent = p;
    patList.appendChild(li);
  });

  card.append(verdictEl, metaEl, patList);

  if (action) {
    const actionEl = document.createElement('div');
    actionEl.className = 'correlation-action';
    actionEl.textContent = `→ ${action}`;
    card.appendChild(actionEl);
  }
}

function mountCorrelation(history, url, title, llmAvailable) {
  const btn = document.getElementById('correlateBtn');
  if (!btn) return;

  const hasEnoughHistory = Array.isArray(history) && history.length >= 2;
  btn.disabled = !hasEnoughHistory || !llmAvailable;
  if (!hasEnoughHistory) {
    btn.title = 'Investigate at least 2 IOCs to enable correlation';
  } else if (!llmAvailable) {
    btn.title = 'Configure Analyst Assist in settings to enable correlation';
  } else {
    btn.title = `Correlate ${history.length} recent IOCs with AI`;
  }

  btn.addEventListener('click', async () => {
    renderCorrelation({ loading: true });
    try {
      const res = await send('CORRELATE_IOCS', { pageUrl: url, pageTitle: title });
      if (!res?.ok) {
        const isStaleWorker = String(res?.error || '').toLowerCase().includes('unknown message type');
        const errMsg = isStaleWorker
          ? 'Extension needs to be reloaded — go to chrome://extensions and click the refresh icon on Mustela.'
          : (res?.error || 'Correlation failed.');
        renderCorrelation({ error: errMsg });
      } else {
        renderCorrelation({ result: res.data });
      }
    } catch {
      renderCorrelation({ error: 'Correlation failed — check Analyst Assist settings.' });
    }
  });
}

function mountManualLookup(tab, onOpened) {
  const input = document.getElementById('manualInput');
  const chip = document.getElementById('manualTypeChip');
  const hint = document.getElementById('manualHint');
  const investigateBtn = document.getElementById('manualInvestigateBtn');
  const vtBtn = document.getElementById('manualVtBtn');
  const abuseBtn = document.getElementById('manualAbuseBtn');
  const shodanBtn = document.getElementById('manualShodanBtn');
  if (!input || !chip || !hint || !investigateBtn || !vtBtn || !abuseBtn || !shodanBtn) return;

  const syncState = () => {
    const state = getManualLookupState(input.value);
    chip.textContent = state.chip;
    hint.textContent = state.hint;
    investigateBtn.disabled = !state.ioc;
    vtBtn.disabled = !state.pivots?.virustotal;
    abuseBtn.disabled = !state.pivots?.abuseipdb;
    shodanBtn.disabled = !state.pivots?.shodan;
    return state;
  };

  const openPanel = async (ioc) => {
    if (!tab?.id || !ioc) return;
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL', payload: ioc });
    if (typeof onOpened === 'function') onOpened();
    window.close();
  };

  const openExternal = async (provider, ioc) => {
    if (!ioc) return;
    await send('OPEN_EXTERNAL_PROVIDER', { provider, ioc });
    window.close();
  };

  input.addEventListener('input', syncState);
  input.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const { ioc } = syncState();
    if (ioc) await openPanel(ioc);
  });

  investigateBtn.addEventListener('click', async () => {
    const { ioc } = syncState();
    if (ioc) await openPanel(ioc);
  });

  vtBtn.addEventListener('click', async () => {
    const { ioc } = syncState();
    if (ioc) await openExternal('virustotal', ioc);
  });

  abuseBtn.addEventListener('click', async () => {
    const { ioc } = syncState();
    if (ioc) await openExternal('abuseipdb', ioc);
  });

  shodanBtn.addEventListener('click', async () => {
    const { ioc } = syncState();
    if (ioc) await openExternal('shodan', ioc);
  });

  syncState();
}

async function init() {
  const tab = await getActiveTab();
  const url = tab?.url || '';
  const disabledRes = await send('IS_PAGE_DISABLED', { url });
  let disabled = !!disabledRes?.data;
  render(disabled);

  const openCurrentIocInvestigation = async (ioc) => {
    if (!tab?.id || !ioc) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL', payload: ioc });
      window.close();
    } catch {}
  };

  const openHistoryInvestigation = async (entry) => {
    if (!tab?.id || !entry?.ioc) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL', payload: entry.ioc });
      window.close();
    } catch {}
  };

  const hydrateCurrentIocs = (items, currentHistory = history) => mapCurrentIocsToHistory(currentHistory, items);

  let currentIocs = tab?.id && !disabled ? await getCurrentPageIocs(tab.id) : [];

  let history = [];
  let settings = {};
  try {
    const [historyRes, settingsRes] = await Promise.all([send('GET_HISTORY'), send('GET_SETTINGS')]);
    history = Array.isArray(historyRes?.data) ? historyRes.data : [];
    settings = settingsRes?.data || {};
  } catch {}

  currentIocs = hydrateCurrentIocs(currentIocs, history);
  renderSummary(currentIocs, disabled, openCurrentIocInvestigation, openHistoryInvestigation);

  const refreshHistory = async () => {
    try {
      const historyRes = await send('GET_HISTORY');
      history = Array.isArray(historyRes?.data) ? historyRes.data : [];
    } catch {
      history = [];
    }
    currentIocs = hydrateCurrentIocs(currentIocs, history);
    renderSummary(currentIocs, disabled, openCurrentIocInvestigation, openHistoryInvestigation);
    renderHistory(history, url, currentIocs, openHistoryInvestigation, toggleHistoryPin);
    renderInsight(findSameIocHistory(history, currentIocs) || history.find((entry) => entry?.pageUrl === url) || history[0] || null);
  };

  const toggleHistoryPin = async (entry) => {
    if (!entry?.historyKey) return;
    await send('TOGGLE_HISTORY_PIN', { historyKey: entry.historyKey, pinned: !entry?.pinned });
    await refreshHistory();
  };

  renderHistory(history, url, currentIocs, openHistoryInvestigation, toggleHistoryPin);
  renderInsight(findSameIocHistory(history, currentIocs) || history.find((entry) => entry?.pageUrl === url) || history[0] || null);

  const llm = settings?.analystAssist || {};
  const llmAvailable = !!(llm.enabled && llm.baseUrl && llm.apiKey && llm.model);
  mountCorrelation(history, url, tab?.title || '', llmAvailable);

  mountManualLookup(tab, refreshHistory);

  document.getElementById('iocListToggleBtn').addEventListener('click', () => {
    currentPageState.expanded = !currentPageState.expanded;
    renderCurrentPageList(openCurrentIocInvestigation, openHistoryInvestigation);
  });

  document.getElementById('toggleBtn').addEventListener('click', async () => {
    disabled = !disabled;
    await send('SET_PAGE_DISABLED', { url, disabled });
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'SET_PAGE_DISABLED', payload: { disabled } });
      } catch {}
    }
    render(disabled);
    currentIocs = tab?.id && !disabled ? await getCurrentPageIocs(tab.id) : [];
    currentIocs = hydrateCurrentIocs(currentIocs, history);
    renderSummary(currentIocs, disabled, openCurrentIocInvestigation, openHistoryInvestigation);
    renderHistory(history, url, currentIocs, openHistoryInvestigation, toggleHistoryPin);
    renderInsight(findSameIocHistory(history, currentIocs) || history.find((entry) => entry?.pageUrl === url) || history[0] || null);
  });

  document.getElementById('investigateBtn').addEventListener('click', async () => {
    if (!tab?.id) return;
    let ioc = null;
    const items = hydrateCurrentIocs(await getCurrentPageIocs(tab.id), history);
    currentIocs = items;
    if (items.length) ioc = items[0];

    if (!ioc) {
      const sameUrl = history.find((entry) => entry?.pageUrl === url || entry?.ioc?.sourceContext?.pageUrl === url);
      if (sameUrl?.ioc) ioc = sameUrl.ioc;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_INVESTIGATION_PANEL', payload: ioc || null });
      window.close();
    } catch {}
  });

  document.getElementById('settingsBtn').addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') });
  });
}

init();
