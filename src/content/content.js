(() => {
// This guard lives in the extension's isolated world, not in page-controlled DOM.
if (globalThis.MUSTELA_CONTENT_INSTANCE?.isActive()) return;
// getRandomValues also works on ordinary HTTP pages, unlike randomUUID.
const instanceId = [...crypto.getRandomValues(new Uint8Array(16))]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');
let disposed = false;
const instance = { isActive, dispose };
globalThis.MUSTELA_CONTENT_INSTANCE = instance;
const { IOC_TYPES, parseIocsFromText, detectSingleIoc, isProtectedIoc, isExcluded } = globalThis.MUSTELA_SHARED || {};
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'OPTGROUP']);

let observer;
// Replaced with the stylesheet text by scripts/build.mjs, inside this IIFE.
const UI_STYLES = /* MUSTELA_UI_STYLES */ "";
let uiHost;
let uiRoot;
let previousFocus;
let panelEl;

function ensureUiRoot() {
  if (!uiRoot) {
    uiHost = document.createElement('div');
    // Inline important rules protect the boundary even against page resets.
    const boundary = { all: 'initial', position: 'fixed', display: 'block',
      top: '0', left: '0', width: '0', height: '0', overflow: 'visible',
      'z-index': '2147483647', 'pointer-events': 'none', direction: 'ltr' };
    for (const [name, value] of Object.entries(boundary)) uiHost.style.setProperty(name, value, 'important');
    uiRoot = uiHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = UI_STYLES;
    uiRoot.append(style);
    // Keep routine UI events inside the component. Closed shadow DOM is DOM
    // encapsulation, not a security boundary against a hostile page (capture
    // listeners can still observe composed keyboard/pointer events).
    for (const type of ['click', 'input', 'beforeinput', 'change', 'keydown', 'keyup', 'pointerdown', 'pointerup']) {
      uiRoot.addEventListener(type, (event) => event.stopPropagation());
    }
  }
  if (!uiHost.isConnected) document.documentElement.append(uiHost);
  return uiRoot;
}
let pageIndicatorEl;
let lastDetectedIocs = [];
let extensionDisabled = false;
let exclusionRules = [];
let policyRevision = 0;

async function syncExclusions() {
  const revision = ++policyRevision;
  // Invalidate in-flight scans and results before awaiting authority.
  extensionDisabled = true;
  cancelScan();
  stripHighlights();
  updatePageIndicator(0);
  publishedSignature = '';
  if (initialized) await publishDetectedIocs([]);
  const response = await sendRuntimeMessage({ type: 'GET_DETECTION_POLICY', payload: { url: location.href } });
  if (revision !== policyRevision) return;
  exclusionRules = response?.ok ? response.data.rules : [];
  extensionDisabled = !response?.ok || response.data.excluded;
  if (initialized) await scanPage();
}
let highlightEnabled = true;
let detectionMode = 'balanced';
let globallyPaused = true; // Fail closed until the background confirms initialization.
let initialized = false;
let pauseRevision = 0;
let panelGeneration = 0;
// Bound retained ranges and published IOC independently of page length.
const MAX_RETAINED_IOCS = 1500;
const MAX_PENDING_ROOTS = 1500;
let retainedIocCount = 0;
const MAX_TEXT_LENGTH = 8192;
const SCAN_SLICE_MS = 8;
const pendingRoots = new Set();
const detectedByNode = new Map();
let processedNodes = new WeakSet();
let scanGeneration = 0;
let scanTimer;
let activeScan;
let pendingChanges = false;
let publishedSignature = '';
// IOC are painted with the CSS Custom Highlight API: ranges over the site's own
// text nodes, so frameworks that own the DOM never see a node replaced.
const HIGHLIGHT_NAME = 'mustela-ioc';
const HOVER_HIGHLIGHT_NAME = 'mustela-ioc-hover';
const highlightSupported = typeof Highlight === 'function' && !!globalThis.CSS?.highlights;
const iocHighlight = highlightSupported ? new Highlight() : null;
const hoverHighlight = highlightSupported ? new Highlight() : null;
const marksByNode = new Map();
let hoveredMark = null;
let hoverTipEl;
let hoverFrame = 0;

function isActive() {
  if (disposed) return false;
  try { if (chrome.runtime.id) return true; } catch {}
  dispose();
  return false;
}

function onContextCheck() { isActive(); }
function onScroll() {
  if (isActive()) setHoveredMark(null);
}

function dispose() {
  if (disposed) return;
  disposed = true;
  globallyPaused = true;
  initialized = false;
  ++pauseRevision;
  ++policyRevision;
  cancelScan();
  observer?.disconnect();
  closePanel();
  if (hoverFrame) cancelAnimationFrame(hoverFrame);
  stripHighlights();
  pageIndicatorEl?.remove();
  pageIndicatorEl = null;
  hoverTipEl?.remove();
  hoverTipEl = null;
  uiHost?.remove();
  uiHost = null;
  uiRoot = null;
  document.removeEventListener?.('click', onDocumentClick, true);
  document.removeEventListener?.('pointermove', onPointerMove);
  document.removeEventListener?.('mustela:context-check', onContextCheck);
  globalThis.window?.removeEventListener('scroll', onScroll, true);
  try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch {}
  if (highlightSupported) {
    if (CSS.highlights.get(HIGHLIGHT_NAME) === iocHighlight) CSS.highlights.delete(HIGHLIGHT_NAME);
    if (CSS.highlights.get(HOVER_HIGHLIGHT_NAME) === hoverHighlight) CSS.highlights.delete(HOVER_HIGHLIGHT_NAME);
  }
  if (document.documentElement?.dataset.mustelaInjected === instanceId) {
    delete document.documentElement.dataset.mustelaInjected;
  }
  if (globalThis.MUSTELA_CONTENT_INSTANCE === instance) delete globalThis.MUSTELA_CONTENT_INSTANCE;
}

function applyPauseState(paused) {
  if (!isActive()) return;
  const changed = globallyPaused !== paused;
  globallyPaused = paused;
  if (paused) {
    cancelScan();
    observer?.disconnect();
    closePanel();
    stripHighlights();
    updatePageIndicator(0);
    publishDetectedIocs([]);
  } else if (initialized && changed) {
    scanPage();
    observePage();
  }
}

async function syncPauseState() {
  const revision = ++pauseRevision;
  const response = await sendRuntimeMessage({ type: 'GET_PAUSE_STATE' });
  if (revision === pauseRevision) applyPauseState(!response?.ok || response.data?.paused !== false);
}

function observePage() {
  if (isActive() && initialized && !globallyPaused) observer?.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}

const OWN_UI = '.mustela-panel, .mustela-page-indicator, .mustela-ioc-tip';
// Editors, live regions and SVG text are rewritten or read aloud by the page:
// leave them untouched.
const SKIP_REGIONS = '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], svg, [role="textbox"], .cm-editor, .CodeMirror, .monaco-editor, .ace_editor, [aria-live]:not([aria-live="off"])';
const SKIP_ANCESTORS = `${[...SKIP_TAGS].join(',')}, ${OWN_UI}, ${SKIP_REGIONS}`;
function skipElement(element) {
  return element && (element === uiHost || SKIP_TAGS.has(element.tagName)
    || element.matches(SKIP_REGIONS)
    || element.matches(OWN_UI));
}

function cancelScan() {
  scanGeneration++;
  clearTimeout(scanTimer);
  scanTimer = null;
  pendingRoots.clear();
  pendingChanges = false;
  detectedByNode.clear();
  retainedIocCount = 0;
  processedNodes = new WeakSet();
}

function queueRoot(node) {
  if (pendingRoots.has(document.body)) return;
  if (pendingRoots.size >= MAX_PENDING_ROOTS) {
    // A burst must not silently discard nodes beyond the queue limit.
    pendingRoots.clear();
    pendingRoots.add(document.body);
  } else pendingRoots.add(node);
}

function collectMutations(records) {
  if (!isActive()) return;
  if (globallyPaused || extensionDisabled || !highlightEnabled) return;
  let changed = false;
  for (const record of records) {
    const parent = record.target.nodeType === 3 ? record.target.parentElement : record.target;
    if (parent === uiHost || parent?.closest?.(OWN_UI)) continue;
    if (record.type === 'characterData') {
      processedNodes.delete(record.target);
      forgetNode(record.target);
      queueRoot(record.target);
      changed = true;
    } else {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 && node.nodeType !== 3) continue;
        if (node.nodeType === 1 && (node === uiHost || node.matches(OWN_UI))) continue;
        queueRoot(node);
        changed = true;
      }
      if ([...record.removedNodes].some((node) => node.nodeType !== 1 || !(node === uiHost || node.matches(OWN_UI)))) changed = true;
    }
  }
  // A trailing-only debounce starves on live feeds. Keep one deadline from
  // the first mutation; additions during that second join the same batch.
  if (changed) {
    pendingChanges = true;
    scheduleScan();
  }
}

function scheduleScan() {
  if (!scanTimer) scanTimer = setTimeout(() => {
    scanTimer = null;
    scanPage(false);
  }, 1000);
}

function mutatePage(write) {
  // Preserve site mutations queued before our synchronous writes, but never
  // observe our own replacements. Reconnect before yielding to the page.
  collectMutations(observer?.takeRecords?.() || []);
  observer?.disconnect();
  try { return write(); } finally { observePage(); }
}


async function sendRuntimeMessage(message, fallback = null) {
  if (!isActive()) return fallback;
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (/Extension context invalidated/i.test(error?.message || '')) dispose();
    return fallback;
  }
}

async function openExternal(provider, ioc) {
  const response = await sendRuntimeMessage({ type: 'OPEN_EXTERNAL_PROVIDER', payload: {
    provider, ioc: { ...ioc, sourceContext: ioc?.sourceContext || { pageUrl: location.href, pageTitle: document.title || '' } }
  } });
  if (!response?.ok) {
    const status = panelEl?.querySelector('#mustela-note-status, #mustela-manual-hint');
    if (status) status.textContent = response?.error || 'External lookup unavailable.';
  }
}

function isExternalPivotSupported(providerId, ioc) {
  if (!ioc?.type || isProtectedIoc(ioc)) return false;
  if (providerId === 'virustotal') return [IOC_TYPES.IP, IOC_TYPES.DOMAIN, IOC_TYPES.URL, IOC_TYPES.MD5, IOC_TYPES.SHA1, IOC_TYPES.SHA256].includes(ioc.type);
  if (providerId === 'abuseipdb') return [IOC_TYPES.IP, IOC_TYPES.SUBNET].includes(ioc.type);
  if (providerId === 'shodan') return [IOC_TYPES.IP, IOC_TYPES.ASN].includes(ioc.type);
  return false;
}

function isMispAddSupported(ioc) {
  return [IOC_TYPES.IP, IOC_TYPES.DOMAIN, IOC_TYPES.URL, IOC_TYPES.MD5, IOC_TYPES.SHA1, IOC_TYPES.SHA256].includes(ioc?.type);
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
  const value = String(ioc?.normalized || '').trim();
  const normalized = type === 'email' ? value : value.toLowerCase();
  return type && normalized ? `${type}:${normalized}` : '';
}

function buildInvestigationExport(data, analystNote = '', tlp = null) {
  const providerResults = Array.isArray(data?.providerResults) ? data.providerResults : [];
  return {
    exportedAt: new Date().toISOString(),
    tlp,
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

function highlightNode(node, sourceContext) {
  if (!highlightEnabled) return [];
  const text = node.nodeValue;
  const matches = parseIocsFromText(text.slice(0, MAX_TEXT_LENGTH), { mode: detectionMode })
    .filter((ioc) => !isExcluded(exclusionRules, { pageUrl: sourceContext.pageUrl, ioc }))
    .slice(0, MAX_RETAINED_IOCS - retainedIocCount);
  if (!matches.length) return [];

  const detected = matches.map((match) => ({
    raw: match.raw,
    normalized: match.normalized,
    type: match.type,
    confidence: match.confidence,
    sourceContext
  }));
  detectedByNode.set(node, detected);
  retainedIocCount += detected.length;
  // Links keep their own click behaviour: their IOC are detected, not painted.
  if (!highlightSupported || node.parentElement?.closest('a')) return detected;

  const marks = [];
  let lastIndex = 0;
  matches.forEach((match, index) => {
    if (match.index < lastIndex) return;
    const range = document.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, match.index + match.length);
    iocHighlight.add(range);
    marks.push({ range, ioc: detected[index] });
    lastIndex = match.index + match.length;
  });
  marksByNode.set(node, marks);
  return detected;
}

function forgetNode(node) {
  retainedIocCount -= detectedByNode.get(node)?.length || 0;
  detectedByNode.delete(node);
  const marks = marksByNode.get(node);
  if (!marks) return;
  marksByNode.delete(node);
  for (const mark of marks) {
    iocHighlight.delete(mark.range);
    if (mark === hoveredMark) setHoveredMark(null);
  }
}

// Removing or moving a text node collapses its ranges onto the old parent.
function marksStale(node) {
  return marksByNode.get(node)?.some(({ range }) => range.startContainer !== node) || false;
}

function pruneDisconnected() {
  for (const node of [...detectedByNode.keys(), ...marksByNode.keys()]) if (!node.isConnected) forgetNode(node);
}

function markAtPoint(x, y) {
  if (!marksByNode.size) return null;
  const caret = document.caretPositionFromPoint?.(x, y);
  const node = caret ? caret.offsetNode : document.caretRangeFromPoint?.(x, y)?.startContainer;
  const marks = node && marksByNode.get(node);
  return marks?.find(({ range }) => [...range.getClientRects()]
    .some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) || null;
}

function setHoveredMark(mark) {
  if (mark === hoveredMark) return;
  hoveredMark = mark;
  hoverHighlight?.clear();
  if (!mark) {
    delete document.documentElement.dataset.mustelaIocHover;
    hoverTipEl?.remove();
    hoverTipEl = null;
    return;
  }
  hoverHighlight.add(mark.range);
  document.documentElement.dataset.mustelaIocHover = 'true';
  if (!hoverTipEl) {
    hoverTipEl = document.createElement('div');
    hoverTipEl.className = 'mustela-ioc-tip';
    hoverTipEl.setAttribute('aria-hidden', 'true');
  }
  hoverTipEl.textContent = `${String(mark.ioc.type).toUpperCase()} · click to investigate`;
  const rect = mark.range.getBoundingClientRect();
  hoverTipEl.style.left = `${Math.max(4, rect.left)}px`;
  hoverTipEl.style.top = `${rect.top >= 30 ? rect.top - 26 : rect.bottom + 6}px`;
  // Outside <body>, so the site's own subtree is never touched.
  if (!hoverTipEl.isConnected) ensureUiRoot().append(hoverTipEl);
}

function onPointerMove(event) {
  if (!isActive()) return;
  if (!marksByNode.size && !hoveredMark) return;
  if (event.target === uiHost) { setHoveredMark(null); return; }
  const { clientX, clientY } = event;
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => setHoveredMark(globallyPaused ? null : markAtPoint(clientX, clientY)));
}

function onDocumentClick(event) {
  if (event.target === uiHost) return;
  if (!isActive()) return;
  if (globallyPaused || event.button !== 0 || !window.getSelection()?.isCollapsed) return;
  const mark = markAtPoint(event.clientX, event.clientY);
  if (!mark) return;
  event.preventDefault();
  event.stopPropagation();
  openPanel(mark.ioc, true);
}

function updatePageIndicator(count) {
  if (!count) {
    pageIndicatorEl?.remove();
    pageIndicatorEl = null;
    return;
  }
  if (!pageIndicatorEl?.isConnected) {
    pageIndicatorEl = document.createElement('div');
    pageIndicatorEl.className = 'mustela-page-indicator';
    ensureUiRoot().append(pageIndicatorEl);
  }
  if (pageIndicatorEl.dataset.count === String(count)) return;
  pageIndicatorEl.dataset.count = String(count);
  pageIndicatorEl.innerHTML = `<strong>${count}</strong> IOC${count > 1 ? 's' : ''} detected`;
}

function stripHighlights() {
  setHoveredMark(null);
  iocHighlight?.clear();
  marksByNode.clear();
}

async function publishDetectedIocs(items) {
  if (!isActive()) return;
  lastDetectedIocs = Array.isArray(items) ? items : [];
  const signature = JSON.stringify(lastDetectedIocs.map((ioc) => [ioc.type, ioc.normalized]).sort());
  if (signature === publishedSignature) return;
  publishedSignature = signature;
  await sendRuntimeMessage({ type: 'PAGE_IOCS_DETECTED', payload: lastDetectedIocs });
}

async function scanPage(reset = true) {
  if (!isActive()) return [];
  if (reset) {
    cancelScan();
    mutatePage(stripHighlights);
    pendingRoots.add(document.body);
  } else if (activeScan) {
    return activeScan;
  }
  if (!initialized || globallyPaused || extensionDisabled || !highlightEnabled) {
    cancelScan();
    mutatePage(() => { stripHighlights(); updatePageIndicator(0); });
    await publishDetectedIocs([]);
    return [];
  }
  const generation = scanGeneration;
  const roots = [...pendingRoots];
  pendingRoots.clear();
  pendingChanges = false;
  pruneDisconnected();
  const work = async () => {
    let sliceStart = Date.now();
    const sourceContext = { pageUrl: location.href, pageTitle: document.title || '' };
    for (const root of roots) {
      if (!root || root.isConnected === false) continue;
      if (root.parentElement?.closest(SKIP_ANCESTORS)) continue;
      if (root.nodeType === 1 && skipElement(root)) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.nodeType === 1 && skipElement(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let node = root;
      while (node) {
        if (generation !== scanGeneration) return [];
        if (node.isConnected === false) break;
        if (node.nodeType === 3 && (!processedNodes.has(node) || marksStale(node))) {
          processedNodes.add(node);
          forgetNode(node);
          if (retainedIocCount < MAX_RETAINED_IOCS && node.nodeValue?.slice(0, MAX_TEXT_LENGTH).trim()) highlightNode(node, sourceContext);
        }
        node = walker.nextNode();
        if (Date.now() - sliceStart >= SCAN_SLICE_MS) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (!isActive()) return [];
          sliceStart = Date.now();
        }
      }
    }
    if (generation !== scanGeneration) return [];
    pruneDisconnected();
    // Deduplicate overlapping roots within this batch, but do not retain a
    // page-sized WeakSet of no-IOC text wrappers between incremental scans.
    // Keep detected nodes so moves can reuse valid ranges (or rebuild stale ones).
    processedNodes = new WeakSet(detectedByNode.keys());
    const unique = new Map();
    for (const items of detectedByNode.values()) {
      for (const ioc of items) unique.set(`${ioc.type}:${ioc.normalized}`, ioc);
    }
    const items = [...unique.values()];
    mutatePage(() => updatePageIndicator(items.length));
    await publishDetectedIocs(items);
    return items;
  };
  const promise = work();
  activeScan = promise;
  try { return await promise; } finally {
    if (activeScan === promise) {
      activeScan = null;
      if (pendingChanges) scheduleScan();
    }
  }
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
  const focusTarget = panelEl ? previousFocus : document.activeElement;
  closePanel();
  previousFocus = focusTarget;
  panelEl = document.createElement('div');
  const tone = detectBackdropTone();
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-label', 'Mustela investigation');
  panelEl.className = `mustela-panel ${tone === 'light' ? 'mustela-panel--light' : ''}`.trim();
  panelEl.innerHTML = `
    <header>
      <strong>Mustela</strong>
      <button class="secondary mustela-close-icon" id="mustela-close" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg></button>
    </header>
    <div class="body">
      <div class="mustela-pill-row">
        <span class="mustela-pill mustela-pill--type">${escapeHtml(String(ioc?.type || 'manual').toUpperCase())}</span>
        ${isProtectedIoc(ioc) ? '<span class="mustela-pill">Internal / reserved</span>' : ''}
        <span class="mustela-ioc-value mustela-copyable" data-copy-value="${escapeHtml(String(ioc?.normalized || 'No IOC selected'))}" data-copy-feedback="" aria-label="Copy IOC" title="Copy IOC" role="button" tabindex="0">${escapeHtml(String(ioc?.normalized || 'No IOC selected'))}</span>
      </div>
      <div id="mustela-result" style="margin-top:12px;">Loading…</div>
    </div>
  `;
  ensureUiRoot().append(panelEl);
  panelEl.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closePanel(); }
  });
  panelEl.querySelector('#mustela-close').addEventListener('click', closePanel);
  bindCopyables(panelEl);
  panelEl.querySelector('#mustela-close').focus();
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
  });
  result.querySelector('#mustela-open-abuse').addEventListener('click', () => {
    const ioc = updateHint();
    if (isExternalPivotSupported('abuseipdb', ioc)) return openExternal('abuseipdb', ioc);
  });
  result.querySelector('#mustela-open-shodan').addEventListener('click', () => {
    const ioc = updateHint();
    if (isExternalPivotSupported('shodan', ioc)) return openExternal('shodan', ioc);
  });
  syncManualPivotButtons(result, null);
}

function humanizeError(message) {
  const text = String(message || 'Unknown error');
  if (/excluded|Unable to verify local exclusion rules/i.test(text)) return text;
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
  if (provider.provider === 'MISP') {
    if (meta.matches !== undefined) fields.push(['Matches', String(meta.matches)]);
    if (meta.eventCount !== undefined) fields.push(['Events', String(meta.eventCount)]);
    if (meta.toIdsHits !== undefined) fields.push(['IDS', String(meta.toIdsHits)]);
    if (meta.type) fields.push(['Type', String(meta.type)]);
    if (meta.category) fields.push(['Category', String(meta.category)]);
  }
  if (!fields.length) return '';
  return `<div class="mustela-provider-grid">${fields.map(([k, v]) => `<div class="mustela-provider-field"><strong>${escapeHtml(k)}</strong><span>${copyableText(v, `Copy ${k}`)}</span></div>`).join('')}</div>`;
}

function renderProviderCard(provider) {
  const badge = provider.provider === 'VirusTotal'
    ? 'VT'
    : provider.provider === 'AbuseIPDB'
      ? 'AB'
      : provider.provider === 'Shodan'
        ? 'SH'
        : provider.provider === 'MISP'
          ? 'MI'
          : 'IOC';
  const isContextProvider = provider.provider === 'Shodan';
  const tone = isContextProvider ? 'neutral' : providerTone(provider.confidence);
  const statusText = provider.blocked ? 'Blocked' : provider.success ? (isContextProvider ? '' : `${provider.confidence ?? 0}/100`) : 'Unavailable';
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
      ${provider.externalUrl ? `<div class="mustela-provider-actions"><button type="button" class="mustela-provider-link" data-provider="${escapeHtml(String(provider.provider || '').toLowerCase())}">Open in ${escapeHtml(provider.provider)}</button></div>` : ''}
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
  const mispBtn = panelEl?.querySelector('#mustela-add-misp');
  const tlpField = panelEl?.querySelector('#mustela-tlp');
  const tlpStatus = panelEl?.querySelector('#mustela-tlp-status');
  const rerunBtn = panelEl?.querySelector('#mustela-rerun');
  if (!historyKey || !noteField || !noteStatus || !copyBtn || !exportBtn) return;

  let confirmedTlp = null;
  let ready = false;
  let busy = false;
  let mispAdded = false;
  const setBusy = (value) => {
    busy = value;
    for (const button of [copyBtn, exportBtn, mispBtn]) {
      if (button) button.disabled = !ready || busy || (button === mispBtn && mispAdded);
    }
    tlpField.disabled = !ready || busy;
    rerunBtn.disabled = busy;
  };
  setBusy(false);

  const syncButtons = () => {
    const payload = buildInvestigationExport(data, noteField.value, confirmedTlp);
    copyBtn.dataset.copyPayload = JSON.stringify(payload, null, 2);
    exportBtn.dataset.exportPayload = copyBtn.dataset.copyPayload;
    exportBtn.dataset.exportFilename = `${String(data?.ioc?.normalized || 'ioc').replace(/[^a-z0-9._-]+/gi, '_')}-investigation.json`;
  };

  const noteRes = await sendRuntimeMessage({ type: 'GET_HISTORY_ENTRY', payload: { historyKey } }, { ok: false });
  if (!noteRes?.ok || !noteRes.data) {
    tlpStatus.textContent = 'Local sharing label not loaded. Re-run to retry.';
    return;
  }
  confirmedTlp = ['clear', 'green', 'amber', 'amber+strict', 'red'].includes(noteRes.data.tlp) ? noteRes.data.tlp : null;
  tlpField.value = confirmedTlp || '';
  ready = true;
  setBusy(false);
  tlpStatus.textContent = 'Sharing label loaded locally.';
  const existingNote = noteRes?.data?.analystNote || '';
  noteField.value = existingNote;
  syncButtons();
  noteStatus.textContent = existingNote ? 'Local note loaded.' : 'Local note stays on this browser only.';

  tlpField.addEventListener('change', async () => {
    setBusy(true);
    tlpStatus.textContent = 'Saving sharing label…';
    const response = await sendRuntimeMessage({
      type: 'SAVE_HISTORY_TLP', payload: { historyKey, tlp: tlpField.value || null }
    }, { ok: false });
    if (response?.ok && response.data) {
      confirmedTlp = response.data.tlp;
      tlpStatus.textContent = 'Sharing label saved locally.';
    } else {
      tlpStatus.textContent = 'Sharing label not saved. Previous label kept; select again to retry.';
    }
    tlpField.value = confirmedTlp || '';
    syncButtons();
    setBusy(false);
  });

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

  if (mispBtn) {
    mispBtn.addEventListener('click', async () => {
      if (!ready || busy || mispAdded) return;
      setBusy(true);
      mispBtn.textContent = 'Adding…';
      noteStatus.textContent = 'Submitting IOC to MISP…';
      const response = await sendRuntimeMessage({
        type: 'ADD_IOC_TO_MISP',
        payload: {
          ioc: data?.ioc,
          comment: noteField.value,
          tlp: confirmedTlp
        }
      }, { ok: false, error: 'MISP add failed.' });
      if (response?.ok) {
        mispAdded = true;
        setBusy(false);
        noteStatus.textContent = response.data?.summary || 'IOC added to MISP.';
        mispBtn.textContent = 'Added to MISP';
        return;
      }
      noteStatus.textContent = response?.error || 'MISP add failed.';
      mispBtn.textContent = 'Add to MISP';
      setBusy(false);
    });
  }
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
  const blocked = providerResults.filter((provider) => provider?.blocked).length;
  const degraded = providerResults.length - successful - blocked;
  const tags = Array.isArray(data.tags) ? data.tags.slice(0, 4) : [];
  const llmSummary = data.llmSummary || {};
  const canAddToMisp = isMispAddSupported(data?.ioc);
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
            ${blocked > 0 ? `<span class="mustela-provider-kind context">${copyableText(`${blocked} blocked`, 'Copy blocked source count')}</span>` : ''}
            ${data.cached ? `<span class="mustela-provider-kind context">${copyableText('cached', 'Copy cache status')}</span>` : ''}
          </div>
        </div>
        ${tags.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">${tags.map((tag) => `<span class="mustela-provider-kind context">${copyableText(tag, 'Copy tag')}</span>`).join('')}</div>` : ''}
      </div>
      <div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);">
        <div style="font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.05em;">Threat summary</div>
        ${threatSummary.narrative ? `<div style="margin-top:6px;opacity:.9;font-weight:600;">${copyableText(threatSummary.narrative, 'Copy threat summary narrative')}</div>` : ''}
        ${summaryEvidence.length ? `<div style="margin-top:8px;font-size:12px;opacity:.78;">${summaryEvidence.map((item) => copyableText(item, 'Copy supporting signal')).join(' · ')}</div>` : ''}
      </div>
      ${llmSummary.summary || llmSummary.error ? `
        <div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div style="font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.05em;">Analyst assist</div>
            <span class="mustela-provider-kind context">${escapeHtml(llmSummary.summary ? `LLM · ${llmSummary.model || 'summary'}` : 'Unavailable')}</span>
          </div>
          <div style="margin-top:6px;opacity:.9;font-weight:600;">${llmSummary.summary ? copyableText(llmSummary.summary, 'Copy AI brief') : escapeHtml(llmSummary.error || 'AI summary unavailable.')}</div>
          ${llmSummary.action ? `<div style="margin-top:8px;font-size:12px;opacity:.78;"><strong>Suggested next step:</strong> ${copyableText(llmSummary.action, 'Copy AI next step')}</div>` : ''}
        </div>
      ` : ''}
      <div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);">
        <div>${copyableText(recommendation.title || 'Recommendation unavailable', 'Copy recommendation title')}</div>
        ${recommendation.summary ? `<div style="margin-top:6px;opacity:.9;">${copyableText(recommendation.summary, 'Copy recommendation summary')}</div>` : ''}
        ${recommendation.action ? `<div style="margin-top:8px;font-size:12px;opacity:.78;"><strong>Recommended action:</strong> ${copyableText(recommendation.action, 'Copy recommended action')}</div>` : ''}
        ${factors.length ? `<ul style="margin:10px 0 0 18px;padding:0;opacity:.82;">${factors.map((factor) => `<li>${copyableText(factor, 'Copy factor')}</li>`).join('')}</ul>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="secondary" id="mustela-rerun">Re-run</button>
        ${canAddToMisp ? '<button class="secondary" id="mustela-add-misp" disabled>Add to MISP</button>' : ''}
        <button class="secondary" id="mustela-copy-export" disabled>Copy export</button>
        <button class="secondary" id="mustela-download-export" disabled>Download JSON</button>
      </div>
      <div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);display:grid;gap:8px;">
        <label for="mustela-tlp">TLP</label>
        <select id="mustela-tlp" aria-describedby="mustela-tlp-help mustela-tlp-status" disabled>
          <option value="">Not classified</option>
          <option value="clear">TLP:CLEAR</option>
          <option value="green">TLP:GREEN</option>
          <option value="amber">TLP:AMBER</option>
          <option value="amber+strict">TLP:AMBER+STRICT</option>
          <option value="red">TLP:RED</option>
        </select>
        <div id="mustela-tlp-help">A sharing label, not a network control. Check the recipient before sharing.</div>
        <div id="mustela-tlp-status" role="status" aria-live="polite">Loading sharing label…</div>
        <label for="mustela-analyst-note" style="font-size:12px;font-weight:700;opacity:.86;">Analyst note</label>
        <textarea id="mustela-analyst-note" rows="4" placeholder="Add a local note for this IOC investigation" style="width:100%;resize:vertical;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(15,23,42,.12);color:inherit;padding:10px 12px;font:inherit;"></textarea>
        <div id="mustela-note-status" style="font-size:12px;opacity:.72;">Local note stays on this browser only.</div>
      </div>
      ${data.storageWarning ? `<div style="font-size:12px;opacity:.78;">${copyableText(data.storageWarning, 'Copy storage warning')}</div>` : ''}
      <div>${providers || '<div style="padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);">No provider result yet.</div>'}</div>
    </div>
  `;
  bindCopyables(panelEl);
  panelEl.querySelectorAll('.mustela-provider-link').forEach((button) => {
    button.addEventListener('click', () => openExternal(button.dataset.provider, data.ioc));
  });
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
  const opening = ++panelGeneration;
  // Guard queued opens as well as newly clicked actions against durable state.
  await syncPauseState();
  if (!initialized || globallyPaused || opening !== panelGeneration) return;
  renderPanelSkeleton(ioc || {});
  const generation = panelGeneration;
  if (!ioc || !ioc.normalized || !ioc.type) {
    renderEmptyState();
    return;
  }
  const response = await sendRuntimeMessage({ type: 'LOOKUP_IOC', payload: ioc });
  if (globallyPaused || generation !== panelGeneration) return;
  if (!response?.ok) return renderError(response?.error || 'Lookup failed');
  if (!allowCache && response.data?.cached) {
    const second = await sendRuntimeMessage({ type: 'LOOKUP_IOC', payload: { ...ioc, _rerun: Date.now() } });
    if (globallyPaused || generation !== panelGeneration) return;
    if (!second?.ok) return renderError(second?.error || 'Lookup failed');
    return renderResult(second.data);
  }
  renderResult(response.data);
}

function closePanel() {
  panelGeneration++;
  if (panelEl) panelEl.remove();
  panelEl = null;
  if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
  previousFocus = null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function onRuntimeMessage(message, sender, sendResponse) {
  if (!isActive()) return;
  if (message?.type === 'EXCLUSIONS_UPDATED') {
    // Never re-run an investigation when rules change. Remove stale results.
    closePanel();
    syncExclusions().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'MUSTELA_ACTION_BLOCKED' && ['MUSTELA_EXCLUDED', 'MUSTELA_EXCLUSION_UNAVAILABLE'].includes(message.code)) {
    syncPauseState().then(() => {
      if (!initialized || globallyPaused) return;
      ++panelGeneration;
      renderPanelSkeleton({});
      renderError(message.error);
    });
    return;
  }
  if (message?.type === 'PAUSE_STATE_UPDATED') {
    // Invalidate work immediately, even while an authoritative read is pending.
    if (message.payload?.paused) applyPauseState(true);
    syncPauseState().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'OPEN_INVESTIGATION_PANEL') {
    openPanel(message.payload || null, true);
    return;
  }
  if (message?.type === 'SET_PAGE_DISABLED') {
    syncExclusions().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'SETTINGS_UPDATED') {
    highlightEnabled = message.payload?.highlightEnabled !== false;
    detectionMode = message.payload?.detectionMode === 'strict' ? 'strict' : 'balanced';
    scanPage();
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
}

async function bootstrap() {
  await syncExclusions();
  try {
    const settingsResponse = await sendRuntimeMessage({ type: 'GET_CONTENT_SETTINGS' });
    highlightEnabled = settingsResponse?.data?.highlightEnabled !== false;
    detectionMode = settingsResponse?.data?.detectionMode === 'strict' ? 'strict' : 'balanced';
  } catch {}
  await syncPauseState();
  if (!isActive()) return;
  initialized = true;
  if (highlightSupported) {
    hoverHighlight.priority = 1;
    CSS.highlights.set(HIGHLIGHT_NAME, iocHighlight);
    CSS.highlights.set(HOVER_HIGHLIGHT_NAME, hoverHighlight);
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  }
  observer = new MutationObserver(collectMutations);
  observePage();
  scanPage();
}

// A new extension context asks invalidated predecessors to release shared page
// highlights synchronously before it starts. A page event cannot stop a live instance.
document.dispatchEvent?.(new Event('mustela:context-check'));
document.addEventListener?.('mustela:context-check', onContextCheck);
document.documentElement.dataset.mustelaInjected = instanceId;
chrome.runtime.onMessage.addListener(onRuntimeMessage);
bootstrap();
})();
