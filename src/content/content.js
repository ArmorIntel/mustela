const { IOC_TYPES, parseIocsFromText, detectSingleIoc } = globalThis.MUSTELA_SHARED || {};
if (document?.documentElement) {
  document.documentElement.dataset.mustelaInjected = 'true';
}
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);

let observer;
let panelEl;
let pageIndicatorEl;
let lastDetectedIocs = [];
let extensionDisabled = false;
let highlightEnabled = true;
let detectionMode = 'balanced';

function walkTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.mustela-panel, .mustela-highlight, .mustela-page-indicator')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}


async function sendRuntimeMessage(message, fallback = null) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return fallback;
  }
}

async function openExternal(provider, ioc) {
  await sendRuntimeMessage({ type: 'OPEN_EXTERNAL_PROVIDER', payload: { provider, ioc } });
}

function isExternalPivotSupported(providerId, ioc) {
  if (!ioc?.type) return false;
  if (providerId === 'virustotal') return [IOC_TYPES.IP, IOC_TYPES.DOMAIN, IOC_TYPES.URL, IOC_TYPES.MD5, IOC_TYPES.SHA1, IOC_TYPES.SHA256].includes(ioc.type);
  if (providerId === 'abuseipdb') return [IOC_TYPES.IP, IOC_TYPES.SUBNET].includes(ioc.type);
  if (providerId === 'shodan') return [IOC_TYPES.IP, IOC_TYPES.ASN].includes(ioc.type);
  return false;
}

function syncManualPivotButtons(root, ioc) {
  const vtBtn = root?.querySelector('#mustela-open-vt');
  const abuseBtn = root?.querySelector('#mustela-open-abuse');
  const shodanBtn = root?.querySelector('#mustela-open-shodan');
  if (vtBtn) vtBtn.disabled = !isExternalPivotSupported('virustotal', ioc);
  if (abuseBtn) abuseBtn.disabled = !isExternalPivotSupported('abuseipdb', ioc);
  if (shodanBtn) shodanBtn.disabled = !isExternalPivotSupported('shodan', ioc);
}

function buildHistoryKey(ioc) {
  const type = String(ioc?.type || '').trim().toLowerCase();
  const normalized = String(ioc?.normalized || '').trim().toLowerCase();
  return type && normalized ? `${type}:${normalized}` : '';
}

function buildInvestigationExport(data, analystNote = '') {
  const providerResults = Array.isArray(data?.providerResults) ? data.providerResults : [];
  return {
    exportedAt: new Date().toISOString(),
    ioc: data?.ioc || null,
    overallVerdict: data?.overallVerdict || 'unknown',
    score: Number(data?.score || 0),
    tags: Array.isArray(data?.tags) ? data.tags : [],
    recommendation: data?.recommendation || {},
    scoreFactors: Array.isArray(data?.scoreFactors) ? data.scoreFactors : [],
    cached: !!data?.cached,
    timestamp: data?.timestamp || new Date().toISOString(),
    analystNote: String(analystNote || '').trim(),
    providerResults: providerResults.map((provider) => ({
      provider: provider?.provider || 'Unknown',
      success: !!provider?.success,
      verdict: provider?.verdict || 'unknown',
      confidence: Number(provider?.confidence || 0),
      summary: provider?.summary || '',
      externalUrl: provider?.externalUrl || '',
      error: provider?.error || '',
      timestamp: provider?.timestamp || '',
      meta: provider?.meta || {}
    }))
  };
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(String(value || ''));
    return true;
  } catch {
    return false;
  }
}

function downloadTextFile(filename, content, mimeType = 'application/json') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function highlightNode(node) {
  if (!highlightEnabled) return [];
  const text = node.nodeValue;
  const matches = parseIocsFromText(text, { mode: detectionMode });
  if (!matches.length) return [];

  const detected = matches.map((match) => ({
    raw: match.raw,
    normalized: match.normalized,
    type: match.type,
    confidence: match.confidence,
    sourceContext: { pageUrl: location.href, pageTitle: document.title || '' }
  }));

  if (node.parentElement?.closest('a')) {
    return detected;
  }

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of matches) {
    if (match.index < lastIndex) continue;
    fragment.append(text.slice(lastIndex, match.index));
    const span = document.createElement('span');
    const ioc = {
      raw: match.raw,
      normalized: match.normalized,
      type: match.type,
      confidence: match.confidence,
      sourceContext: { pageUrl: location.href, pageTitle: document.title || '' }
    };
    span.className = 'mustela-highlight';
    span.title = `IOC detected (${match.type}) — click to investigate`;
    span.dataset.iocType = match.type;
    span.dataset.ioc = JSON.stringify(ioc);
    const label = document.createElement('span');
    label.className = 'mustela-label';
    label.textContent = match.raw;
    span.append(label);
    span.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPanel(ioc, true);
    });
    fragment.append(span);
    lastIndex = match.index + match.length;
  }

  fragment.append(text.slice(lastIndex));
  const wrapper = document.createElement('span');
  wrapper.className = 'mustela-fragment';
  wrapper.append(fragment);
  node.parentNode.replaceChild(wrapper, node);
  return detected;
}

function updatePageIndicator(count) {
  if (pageIndicatorEl) pageIndicatorEl.remove();
  if (!count) {
    pageIndicatorEl = null;
    return;
  }
  pageIndicatorEl = document.createElement('div');
  pageIndicatorEl.className = 'mustela-page-indicator';
  pageIndicatorEl.innerHTML = `<strong>${count}</strong> IOC${count > 1 ? 's' : ''} detected`;
  document.body.appendChild(pageIndicatorEl);
}

function stripHighlights() {
  document.querySelectorAll('.mustela-highlight').forEach((el) => {
    const label = el.querySelector('.mustela-label');
    const textNode = document.createTextNode(label ? label.textContent : el.textContent);
    el.replaceWith(textNode);
  });
  document.querySelectorAll('.mustela-fragment').forEach((el) => {
    if (!el.parentNode) return;
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
}

async function publishDetectedIocs(items) {
  lastDetectedIocs = Array.isArray(items) ? items : [];
  await sendRuntimeMessage({ type: 'PAGE_IOCS_DETECTED', payload: lastDetectedIocs });
}

async function scanPage() {
  if (extensionDisabled || !highlightEnabled) {
    stripHighlights();
    updatePageIndicator(0);
    await publishDetectedIocs([]);
    return [];
  }
  stripHighlights();
  const nodes = walkTextNodes(document.body).slice(0, 1500);
  const found = [];
  for (const node of nodes) found.push(...highlightNode(node));
  const unique = Array.from(new Map(found.map((ioc) => [`${ioc.type}:${ioc.normalized}`, ioc])).values());
  updatePageIndicator(unique.length);
  await publishDetectedIocs(unique);
  return unique;
}

function parseColor(color) {
  if (!color) return null;
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(',').map((p) => Number.parseFloat(p.trim()));
  if (parts.length < 3) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

function luminance({ r, g, b }) {
  const chan = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function detectBackdropTone() {
  const samplePoints = [[window.innerWidth - 220, 80], [window.innerWidth - 220, 220], [window.innerWidth - 220, 360]];
  const values = [];
  for (const [x, y] of samplePoints) {
    const el = document.elementFromPoint(Math.max(0, x), Math.max(0, y));
    let current = el;
    let depth = 0;
    while (current && depth < 6) {
      const bg = parseColor(getComputedStyle(current).backgroundColor);
      if (bg && bg.a > 0.12) {
        values.push(luminance(bg));
        break;
      }
      current = current.parentElement;
      depth += 1;
    }
  }
  if (!values.length) {
    const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
    if (bodyBg) values.push(luminance(bodyBg));
  }
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0.3;
  return avg > 0.58 ? 'light' : 'dark';
}

function renderPanelSkeleton(ioc) {
  closePanel();
  panelEl = document.createElement('div');
  const tone = detectBackdropTone();
  panelEl.className = `mustela-panel ${tone === 'light' ? 'mustela-panel--light' : ''}`.trim();
  panelEl.innerHTML = `
    <header>
      <strong>Mustela</strong>
      <button class="secondary mustela-close-icon" id="mustela-close" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg></button>
    </header>
    <div class="body">
      <div class="mustela-pill-row">
        <span class="mustela-pill mustela-pill--type">${escapeHtml(String(ioc?.type || 'manual').toUpperCase())}</span>
        <span class="mustela-ioc-value mustela-copyable" data-copy-value="${escapeHtml(String(ioc?.normalized || 'No IOC selected'))}" data-copy-feedback="" aria-label="Copy IOC" title="Copy IOC" role="button" tabindex="0">${escapeHtml(String(ioc?.normalized || 'No IOC selected'))}</span>
      </div>
      <div id="mustela-result" style="margin-top:12px;">Loading…</div>
    </div>
  `;
  document.body.appendChild(panelEl);
  panelEl.querySelector('#mustela-close').addEventListener('click', closePanel);
  bindCopyables(panelEl);
}

function renderEmptyState() {
  const result = panelEl?.querySelector('#mustela-result');
  if (!result) return;
  result.innerHTML = `
    <div><strong>No IOC selected yet.</strong></div>
    <div style="margin-top:6px; opacity:.86;">Paste an IOC manually to investigate it now, or pivot directly to your external services.</div>
    <div class="mustela-manual-search" style="margin-top:14px;">
      <div class="mustela-search-shell">
        <div class="mustela-search-row">
          <div class="mustela-search-input-wrap">
            <div id="mustela-type-chip" class="mustela-type-chip"><strong>TYPE</strong></div>
            <input id="mustela-manual-input" class="mustela-search-input" type="text" placeholder="Paste IP, subnet, ASN, domain, URL or hash" />
            <button id="mustela-manual-go" class="mustela-search-icon-btn" title="Search" aria-label="Search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="M20 20l-4.2-4.2"></path></svg></button>
          </div>
        </div>
        <div class="mustela-manual-actions">
          <button class="secondary" id="mustela-open-vt">VirusTotal</button>
          <button class="secondary" id="mustela-open-abuse">AbuseIPDB</button>
          <button class="secondary" id="mustela-open-shodan">Shodan</button>
        </div>
        <div id="mustela-manual-hint" class="mustela-manual-hint">No IOC entered yet.</div>
      </div>
    </div>
  `;
  const input = result.querySelector('#mustela-manual-input');
  const hint = result.querySelector('#mustela-manual-hint');
  const chip = result.querySelector('#mustela-type-chip');
  let lastType = '';
  const readIoc = () => detectSingleIoc(input.value.trim(), { mode: detectionMode });
  const updateHint = () => {
    const ioc = readIoc();
    syncManualPivotButtons(result, ioc);
    if (ioc) {
      const nextType = ioc.type.toUpperCase();
      chip.querySelector('strong').textContent = nextType;
      hint.textContent = `Ready to investigate ${ioc.type}. Press Enter or Search.`;
      if (lastType !== nextType) {
        chip.classList.remove('is-active');
        void chip.offsetWidth;
        chip.classList.add('is-active');
        lastType = nextType;
      }
    } else {
      chip.querySelector('strong').textContent = 'TYPE';
      hint.textContent = input.value.trim() ? 'Try an IP, subnet, ASN, domain, URL or hash.' : 'No IOC entered yet.';
      lastType = '';
      chip.classList.remove('is-active');
    }
    return ioc;
  };
  input.addEventListener('input', updateHint);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const ioc = updateHint();
      if (ioc) openPanel(ioc, false);
    }
  });
  result.querySelector('#mustela-manual-go').addEventListener('click', () => {
    const ioc = updateHint();
    if (ioc) openPanel(ioc, false);
  });
  result.querySelector('#mustela-open-vt').addEventListener('click', () => {
    const ioc = updateHint();
    if (ioc) return openExternal('virustotal', ioc);
    window.open('https://www.virustotal.com/gui/home/search', '_blank');
  });
  result.querySelector('#mustela-open-abuse').addEventListener('click', () => {
    const ioc = updateHint();
    if (isExternalPivotSupported('abuseipdb', ioc)) return openExternal('abuseipdb', ioc);
    window.open('https://www.abuseipdb.com/', '_blank');
  });
  result.querySelector('#mustela-open-shodan').addEventListener('click', () => {
    const ioc = updateHint();
    if (isExternalPivotSupported('shodan', ioc)) return openExternal('shodan', ioc);
    window.open('https://www.shodan.io/', '_blank');
  });
  syncManualPivotButtons(result, null);
}

function humanizeError(message) {
  const text = String(message || 'Unknown error');
  if (/quota/i.test(text)) return 'Local storage is full. The result can still be shown, but the extension cache needs to be trimmed.';
  if (/network/i.test(text) || /fetch/i.test(text)) return 'Network request failed. Check connectivity or provider availability.';
  return 'Something went wrong during the lookup. Try again in a moment.';
}

function providerTone(confidence) {
  const c = Number(confidence || 0);
  if (c >= 80) return 'bad';
  if (c >= 40) return 'warn';
  if (c > 0) return 'good';
  return 'neutral';
}

function providerKind(provider) {
  const msg = String(provider.error || provider.summary || '').toLowerCase();
  if (/not configured/.test(msg)) return { label: 'Setup required', cls: 'setup' };
  if (/access denied|limited|rate limit/.test(msg)) return { label: 'Access limited', cls: 'limited' };
  if (provider.provider === 'Shodan') return { label: 'Context', cls: 'context' };
  return { label: 'Signal', cls: 'signal' };
}

function copyableText(value, label = 'Copy value') {
  const safeValue = String(value || '');
  return `<span class="mustela-copyable" data-copy-value="${escapeHtml(safeValue)}" data-copy-feedback="" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" role="button" tabindex="0">${escapeHtml(safeValue)}</span>`;
}

function renderProviderFields(provider) {
  const meta = provider.meta || {};
  const fields = [];
  if (provider.provider === 'AbuseIPDB') {
    if (meta.totalReports !== undefined) fields.push(['Reports', String(meta.totalReports)]);
    if (meta.usageType) fields.push(['Usage', String(meta.usageType)]);
    if (meta.isp) fields.push(['ISP', String(meta.isp)]);
    if (meta.domain) fields.push(['Domain', String(meta.domain)]);
    if (Array.isArray(meta.hostnames) && meta.hostnames.length) fields.push(['Hostnames', meta.hostnames.slice(0, 2).join(', ')]);
    if (meta.countryCode) fields.push(['Country', String(meta.countryCode)]);
    if (meta.lastReportedAt) fields.push(['Last report', String(meta.lastReportedAt).replace('T', ' ').slice(0, 16)]);
    if (meta.networkAddress) fields.push(['Network', String(meta.networkAddress)]);
  }
  if (provider.provider === 'Shodan') {
    if (Array.isArray(meta.ports) && meta.ports.length) fields.push(['Ports', meta.ports.slice(0, 8).join(', ')]);
    if (meta.org) fields.push(['Org', String(meta.org)]);
    if (meta.asn) fields.push(['ASN', String(meta.asn)]);
    if (meta.total !== undefined) fields.push(['Matches', String(meta.total)]);
  }
  if (provider.provider === 'VirusTotal') {
    if (meta.stats?.malicious !== undefined) fields.push(['Malicious', String(meta.stats.malicious)]);
    if (meta.stats?.suspicious !== undefined) fields.push(['Suspicious', String(meta.stats.suspicious)]);
    if (meta.stats?.harmless !== undefined) fields.push(['Harmless', String(meta.stats.harmless)]);
  }
  if (!fields.length) return '';
  return `<div class="mustela-provider-grid">${fields.map(([k, v]) => `<div class="mustela-provider-field"><strong>${escapeHtml(k)}</strong><span>${copyableText(v, `Copy ${k}`)}</span></div>`).join('')}</div>`;
}

function renderProviderCard(provider) {
  const badge = provider.provider === 'VirusTotal' ? 'VT' : provider.provider === 'AbuseIPDB' ? 'AB' : provider.provider === 'Shodan' ? 'SH' : 'IOC';
  const isContextProvider = provider.provider === 'Shodan';
  const tone = isContextProvider ? 'neutral' : providerTone(provider.confidence);
  const statusText = provider.success ? (isContextProvider ? '' : `${provider.confidence ?? 0}/100`) : 'Unavailable';
  const summary = provider.summary || provider.error || '';
  const fields = renderProviderFields(provider);
  const shouldShowSummary = !fields || !provider.success;
  const kind = providerKind(provider);
  const hideKindLabel = isContextProvider && !statusText;
  return `
    <div class="mustela-provider">
      <div class="mustela-provider-head">
        <div class="mustela-provider-title">
          <span class="mustela-provider-badge">${escapeHtml(badge)}</span>
          <strong>${escapeHtml(provider.provider || 'Provider')}</strong>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
          ${!hideKindLabel ? `<span class="mustela-provider-kind ${escapeHtml(kind.cls)}">${escapeHtml(kind.label)}</span>` : ''}
          ${statusText ? `<div class="mustela-provider-score ${tone}">${escapeHtml(statusText)}</div>` : ''}
        </div>
      </div>
      ${shouldShowSummary ? `<div class="mustela-provider-summary">${escapeHtml(summary)}</div>` : ''}
      ${fields}
      ${provider.error ? `<small style="display:block;margin-top:10px;">${escapeHtml(provider.error)}</small>` : ''}
      ${provider.externalUrl ? `<div class="mustela-provider-actions"><a class="mustela-provider-link" target="_blank" rel="noopener noreferrer" href="${provider.externalUrl}">Open in ${escapeHtml(provider.provider)}</a></div>` : ''}
    </div>
  `;
}

function bindCopyables(root = panelEl) {
  root?.querySelectorAll('.mustela-copyable').forEach((node) => {
    if (node.dataset.copyBound === 'true') return;
    node.dataset.copyBound = 'true';
    const handleCopy = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const value = node.dataset.copyValue || node.textContent || '';
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        return;
      }
      node.classList.add('is-copied');
      node.dataset.copyFeedback = 'Copied';
      if (node.dataset.copyTimer) window.clearTimeout(Number(node.dataset.copyTimer));
      node.dataset.copyTimer = String(window.setTimeout(() => {
        node.classList.remove('is-copied');
        node.dataset.copyFeedback = '';
        delete node.dataset.copyTimer;
      }, 900));
    };
    node.addEventListener('click', handleCopy);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') return handleCopy(event);
    });
  });
}

async function bindAnalystActions(data) {
  const historyKey = buildHistoryKey(data?.ioc);
  const noteField = panelEl?.querySelector('#mustela-analyst-note');
  const noteStatus = panelEl?.querySelector('#mustela-note-status');
  const copyBtn = panelEl?.querySelector('#mustela-copy-export');
  const exportBtn = panelEl?.querySelector('#mustela-download-export');
  if (!historyKey || !noteField || !noteStatus || !copyBtn || !exportBtn) return;

  const syncButtons = () => {
    const payload = buildInvestigationExport(data, noteField.value);
    copyBtn.dataset.copyPayload = JSON.stringify(payload, null, 2);
    exportBtn.dataset.exportPayload = copyBtn.dataset.copyPayload;
    exportBtn.dataset.exportFilename = `${String(data?.ioc?.normalized || 'ioc').replace(/[^a-z0-9._-]+/gi, '_')}-investigation.json`;
  };

  const noteRes = await sendRuntimeMessage({ type: 'GET_HISTORY_ENTRY', payload: { historyKey } }, { ok: true, data: null });
  const existingNote = noteRes?.data?.analystNote || '';
  noteField.value = existingNote;
  syncButtons();
  noteStatus.textContent = existingNote ? 'Local note loaded.' : 'Local note stays on this browser only.';

  let saveTimer = 0;
  const persistNote = async () => {
    noteStatus.textContent = 'Saving note…';
    const response = await sendRuntimeMessage({ type: 'SAVE_HISTORY_NOTE', payload: { historyKey, analystNote: noteField.value } }, { ok: false });
    noteStatus.textContent = response?.ok ? 'Note saved locally.' : 'Note not saved.';
    syncButtons();
  };

  noteField.addEventListener('input', () => {
    noteStatus.textContent = 'Saving soon…';
    syncButtons();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persistNote, 350);
  });
  noteField.addEventListener('blur', () => {
    window.clearTimeout(saveTimer);
    persistNote();
  });

  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(copyBtn.dataset.copyPayload || '');
    copyBtn.textContent = ok ? 'Copied export' : 'Copy failed';
    window.setTimeout(() => { copyBtn.textContent = 'Copy export'; }, 900);
  });

  exportBtn.addEventListener('click', () => {
    downloadTextFile(exportBtn.dataset.exportFilename || 'investigation.json', exportBtn.dataset.exportPayload || '{}');
    exportBtn.textContent = 'Downloaded';
    window.setTimeout(() => { exportBtn.textContent = 'Download JSON'; }, 900);
  });
}

function renderResult(data) {
  const result = panelEl?.querySelector('#mustela-result');
  if (!result) return;
  const providerResults = Array.isArray(data.providerResults) ? data.providerResults : [];
  const providers = providerResults.map((provider) => renderProviderCard(provider)).join('');
  const recommendation = data.recommendation || {};
  const threatSummary = data.threatSummary || {};
  const summaryEvidence = Array.isArray(threatSummary.evidence) ? threatSummary.evidence.slice(0, 2) : [];
  const factors = Array.isArray(data.scoreFactors) ? data.scoreFactors.slice(0, 3) : [];
  const successful = providerResults.filter((provider) => provider?.success).length;
  const degraded = providerResults.length - successful;
  const tags = Array.isArray(data.tags) ? data.tags.slice(0, 4) : [];
  result.innerHTML = `
    <div class="mustela-summary-shell" style="display:grid;gap:10px;">
      <div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.05em;">Global verdict</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px;">${copyableText(`${data.overallVerdict || 'unknown'} · ${data.score || 0}/100`, 'Copy verdict summary')}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <span class="mustela-provider-kind signal">${copyableText(`${successful}/${providerResults.length || 0} sources usable`, 'Copy source summary')}</span>
            ${degraded > 0 ? `<span class="mustela-provider-kind limited">${copyableText(`${degraded} degraded`, 'Copy degraded source count')}</span>` : ''}
            ${data.cached ? `<span class="mustela-provider-kind context">${copyableText('cached', 'Copy cache status')}</span>` : ''}
          </div>
        </div>
        ${tags.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">${tags.map((tag) => `<span class="mustela-provider-kind context">${copyableText(tag, 'Copy tag')}</span>`).join('')}</div>` : ''}
      </div>
      <div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);">
        <div style="font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.05em;">Threat summary</div>
        ${threatSummary.narrative ? `<div style="margin-top:6px;opacity:.9;font-weight:600;">${copyableText(threatSummary.narrative, 'Copy threat summary narrative')}</div>` : ''}
      </div>
      <div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);">
        <div>${copyableText(recommendation.title || 'Recommendation unavailable', 'Copy recommendation title')}</div>
        ${recommendation.summary ? `<div style="margin-top:6px;opacity:.9;">${copyableText(recommendation.summary, 'Copy recommendation summary')}</div>` : ''}
        ${recommendation.action ? `<div style="margin-top:8px;font-size:12px;opacity:.78;"><strong>Recommended action:</strong> ${copyableText(recommendation.action, 'Copy recommended action')}</div>` : ''}
        ${factors.length ? `<ul style="margin:10px 0 0 18px;padding:0;opacity:.82;">${factors.map((factor) => `<li>${copyableText(factor, 'Copy factor')}</li>`).join('')}</ul>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="secondary" id="mustela-rerun">Re-run</button>
        <button class="secondary" id="mustela-copy-export">Copy export</button>
        <button class="secondary" id="mustela-download-export">Download JSON</button>
      </div>
      <div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);display:grid;gap:8px;">
        <label for="mustela-analyst-note" style="font-size:12px;font-weight:700;opacity:.86;">Analyst note</label>
        <textarea id="mustela-analyst-note" rows="4" placeholder="Add a local note for this IOC investigation" style="width:100%;resize:vertical;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(15,23,42,.12);color:inherit;padding:10px 12px;font:inherit;"></textarea>
        <div id="mustela-note-status" style="font-size:12px;opacity:.72;">Local note stays on this browser only.</div>
      </div>
      ${data.storageWarning ? `<div style="font-size:12px;opacity:.78;">${copyableText(data.storageWarning, 'Copy storage warning')}</div>` : ''}
      <div>${providers || '<div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);">No provider result yet.</div>'}</div>
    </div>
  `;
  bindCopyables(panelEl);
  panelEl.querySelector('#mustela-rerun').addEventListener('click', () => openPanel(data.ioc, false));
  bindAnalystActions(data);
}

function renderError(message) {
  const result = panelEl?.querySelector('#mustela-result');
  if (!result) return;
  result.innerHTML = `
    <div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);">
      <div><strong>Lookup unavailable.</strong></div>
      <div style="margin-top:6px; opacity:.86;">${escapeHtml(humanizeError(message))}</div>
      <div style="margin-top:10px; font-size:12px; opacity:.7;">Technical details were hidden to keep the interface clean.</div>
    </div>
  `;
}

async function openPanel(ioc, allowCache) {
  renderPanelSkeleton(ioc || {});
  if (!ioc || !ioc.normalized || !ioc.type) {
    renderEmptyState();
    return;
  }
  const response = await sendRuntimeMessage({ type: 'LOOKUP_IOC', payload: ioc });
  if (!response?.ok) return renderError(response?.error || 'Lookup failed');
  if (!allowCache && response.data?.cached) {
    const second = await sendRuntimeMessage({ type: 'LOOKUP_IOC', payload: { ...ioc, _rerun: Date.now() } });
    if (!second?.ok) return renderError(second?.error || 'Lookup failed');
    return renderResult(second.data);
  }
  renderResult(response.data);
}

function closePanel() {
  if (panelEl) panelEl.remove();
  panelEl = null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_INVESTIGATION_PANEL') {
    openPanel(message.payload || null, true);
    return;
  }
  if (message?.type === 'SET_PAGE_DISABLED') {
    extensionDisabled = !!message.payload?.disabled;
    if (extensionDisabled) {
      stripHighlights();
      updatePageIndicator(0);
      publishDetectedIocs([]);
    } else {
      scanPage();
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === 'SETTINGS_UPDATED') {
    highlightEnabled = message.payload?.highlightEnabled !== false;
    detectionMode = message.payload?.detectionMode === 'strict' ? 'strict' : 'balanced';
    if (!highlightEnabled) {
      stripHighlights();
      updatePageIndicator(0);
      publishDetectedIocs([]);
    } else if (!extensionDisabled) {
      scanPage();
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === 'GET_PAGE_IOCS') {
    sendResponse({ ok: true, data: Array.isArray(lastDetectedIocs) ? lastDetectedIocs : [] });
    return true;
  }
  if (message?.type === 'RESCAN_PAGE_IOCS') {
    scanPage().then((items) => sendResponse({ ok: true, data: items || [] })).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
});

async function bootstrap() {
  try {
    const disabledResponse = await sendRuntimeMessage({ type: 'IS_PAGE_DISABLED', payload: { url: location.href } });
    extensionDisabled = !!disabledResponse?.data;
  } catch {}
  try {
    const settingsResponse = await sendRuntimeMessage({ type: 'GET_SETTINGS' });
    highlightEnabled = settingsResponse?.data?.highlightEnabled !== false;
    detectionMode = settingsResponse?.data?.detectionMode === 'strict' ? 'strict' : 'balanced';
  } catch {}
  const debouncedScan = debounce(scanPage, 1000);
  observer = new MutationObserver(() => debouncedScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scanPage();
}

bootstrap();

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
