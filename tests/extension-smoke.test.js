import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'manifest', 'chrome.manifest.json');
const contentPath = path.join(root, 'src', 'content', 'content.js');
const popupHtmlPath = path.join(root, 'src', 'popup', 'popup.html');
const popupJsPath = path.join(root, 'src', 'popup', 'popup.js');
const backgroundPath = path.join(root, 'src', 'background', 'background.js');
const welcomeHtmlPath = path.join(root, 'src', 'welcome', 'welcome.html');
const welcomeJsPath = path.join(root, 'src', 'welcome', 'welcome.js');

test('content scripts referenced by manifest stay non-module and preload shared IOC helpers', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.content_scripts[0].js, ['src/shared/ioc.content-runtime.js', 'src/content/content.js']);
  for (const relativePath of manifest.content_scripts[0].js) {
    const scriptPath = path.join(root, relativePath);
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert.equal(/^\s*import\s/m.test(content), false, `${relativePath} must not contain top-level import`);
    assert.equal(/^\s*export\s/m.test(content), false, `${relativePath} must not contain top-level export`);
  }
});

test('content script still exposes critical runtime hooks', () => {
  const content = fs.readFileSync(contentPath, 'utf8');
  assert.match(content, /MUSTELA_SHARED/);
  assert.match(content, /PAGE_IOCS_DETECTED/);
  assert.match(content, /OPEN_INVESTIGATION_PANEL/);
  assert.match(content, /GET_PAGE_IOCS/);
  assert.match(content, /RESCAN_PAGE_IOCS/);
  assert.match(content, /detectSingleIoc/);
  assert.match(content, /parseIocsFromText/);
  assert.match(content, /detectionMode/);
  assert.match(content, /sendRuntimeMessage/);
  assert.match(content, /publishDetectedIocs/);
  assert.match(content, /mustela-fragment/);
});

test('content panel keeps links intact and adds copyable non-link values', () => {
  const content = fs.readFileSync(contentPath, 'utf8');
  assert.match(content, /mustela-copyable/);
  assert.match(content, /bindCopyables\(root = panelEl\)/);
  assert.match(content, /querySelectorAll\('\.mustela-copyable'\)/);
  assert.match(content, /role="button" tabindex="0"/);
  assert.match(content, /event.key === 'Enter' \|\| event.key === ' '/);
  assert.match(content, /provider.externalUrl \? `<div class="mustela-provider-actions"><a class="mustela-provider-link" target="_blank" rel="noopener noreferrer"/);
});

test('popup html contains the analyst-facing sections and no raw broken tag text', () => {
  const html = fs.readFileSync(popupHtmlPath, 'utf8');
  const htmlTags = html.match(/<html/gi) || [];
  const bodyTags = html.match(/<body/gi) || [];
  const scriptTags = html.match(/<script type="module" src="\.\/popup\.js"><\/script>/g) || [];
  assert.equal(htmlTags.length, 1);
  assert.equal(bodyTags.length, 1);
  assert.equal(scriptTags.length, 1);
  assert.equal(/>\s*div>\s*</i.test(html), false, 'popup must not leak raw div> text');
  assert.match(html, /id="summaryBadge"/);
  assert.match(html, /id="iocList"/);
  assert.match(html, /id="iocListFooter"/);
  assert.match(html, /id="iocListToggleBtn"/);
  assert.match(html, /id="manualInput"/);
  assert.match(html, /id="manualInvestigateBtn"/);
  assert.match(html, /id="insightBadge"/);
  assert.match(html, /id="insightText"/);
  assert.match(html, /id="historyBadge"/);
  assert.match(html, /id="historyList"/);
});

test('popup script wires manual lookup, current-page actions and history behaviors', () => {
  const popup = fs.readFileSync(popupJsPath, 'utf8');
  assert.match(popup, /mountManualLookup/);
  assert.match(popup, /renderCurrentPageList/);
  assert.match(popup, /CURRENT_PAGE_PREVIEW_LIMIT = 5/);
  assert.match(popup, /iocListToggleBtn/);
  assert.match(popup, /createIconActionButton/);
  assert.match(popup, /armCopyFeedback/);
  assert.match(popup, /Investigate IOC/);
  assert.match(popup, /Copy IOC value/);
  assert.match(popup, /role', 'button'/);
  assert.match(popup, /event.key === 'Enter' \|\| event.key === ' '/);
  assert.match(popup, /Copied/);
  assert.match(popup, /In history · \$\{verdict\} · \$\{seen\}/);
  assert.match(popup, /main\.classList\.add\('stacked'\)/);
  assert.match(popup, /statusRow\.className = 'ioc-status-row'/);
  assert.match(popup, /reopenBtn\.textContent = 'Open details'/);
  assert.match(popup, /else \{\s+const investigateBtn = createIconActionButton/s);
  assert.match(popup, /mapCurrentIocsToHistory/);
  assert.match(popup, /renderInsight/);
  assert.match(popup, /summarySource === 'llm'/);
  assert.match(popup, /OPEN_EXTERNAL_PROVIDER/);
  assert.match(popup, /TOGGLE_HISTORY_PIN/);
  assert.match(popup, /OPEN_INVESTIGATION_PANEL/);
  assert.doesNotMatch(popup, /choosePrimaryInvestigationTarget/);
});

test('popup html styles compact clickable IOC values with discreet feedback', () => {
  const html = fs.readFileSync(popupHtmlPath, 'utf8');
  assert.match(html, /\.ioc-value:hover/);
  assert.match(html, /\.ioc-value:focus-visible/);
  assert.match(html, /\.ioc-value\.is-copied/);
  assert.match(html, /\.ioc-main\.stacked/);
  assert.match(html, /\.ioc-status-row/);
  assert.match(html, /\.ioc-item\.investigated \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(html, /data-copy-feedback/);
});

test('welcome/settings expose detection mode minimally and persist through save path', () => {
  const html = fs.readFileSync(welcomeHtmlPath, 'utf8');
  const js = fs.readFileSync(welcomeJsPath, 'utf8');
  const background = fs.readFileSync(backgroundPath, 'utf8');
  assert.match(html, /id="detectionMode"/);
  assert.match(html, /id="mispEnabled"/);
  assert.match(html, /id="mispBaseUrl"/);
  assert.match(html, /id="llmEnabled"/);
  assert.match(html, /id="llmModel"/);
  assert.match(html, /value="balanced"/);
  assert.match(html, /value="strict"/);
  assert.match(js, /getElementById\('detectionMode'\)/);
  assert.match(js, /getElementById\('mispBaseUrl'\)/);
  assert.match(js, /getElementById\('llmModel'\)/);
  assert.match(js, /detectionMode: document\.getElementById\('detectionMode'\)\.value === 'strict' \? 'strict' : 'balanced'/);
  assert.match(js, /analystAssist:/);
  assert.match(background, /detectionMode: saved\.detectionMode/);
});

test('background remembers investigations for fresh and cached lookups', () => {
  const background = fs.readFileSync(backgroundPath, 'utf8');
  assert.match(background, /toggleHistoryPin/);
  assert.match(background, /getHistory/);
  assert.doesNotMatch(background, /await import\('\.\.\/storage\/storage\.js'\)/);
  assert.match(background, /case 'GET_HISTORY':\s*return \{ ok: true, data: await getHistory\(\) \}/);
  assert.match(background, /async function rememberInvestigation/);
  assert.match(background, /if \(cached\) \{/);
  assert.match(background, /await rememberInvestigation\(ioc, cachedInvestigation, sender\)/);
  assert.match(background, /await rememberInvestigation\(ioc, enrichedInvestigation, sender\)/);
  assert.match(background, /generateInvestigationSummary/);
  assert.match(background, /ADD_IOC_TO_MISP/);
  assert.match(background, /isProviderSupportedForIoc\('abuseipdb', detected\)/);
  assert.match(background, /isProviderSupportedForIoc\('shodan', detected\)/);
});
