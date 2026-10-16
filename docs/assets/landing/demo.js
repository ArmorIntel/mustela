import { createGuide, exampleInvestigation } from './demo-state.js';

const root = document.querySelector('#demo');
const $ = selector => root.querySelector(selector);
const scene = $('.demo-shell'), panel = $('#investigation'), note = $('#analyst-note');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const notes = new Map();
let kind = 'IP', opener = $('#ioc'), currentStage = 1, copyRevision = 0;
const labels = ['Select a highlighted indicator to begin.', 'Loading fictional evidence.',
  'Read the global verdict and threat summary.', 'Compare the sources. Shodan adds context for IPs.',
  'Add a note or export fictional evidence.'];

function render(state) {
  const previousStage = currentStage;
  currentStage = state.stage;
  scene.dataset.stage = String(state.stage);
  scene.dataset.owner = state.manual ? 'manual' : 'guided';
  scene.dataset.suspended = String(state.suspended);
  panel.hidden = state.stage < 2;
  $('.panel-loading').hidden = state.stage !== 2;
  for (const el of root.querySelectorAll('[data-reveal]')) el.hidden = Number(el.dataset.reveal) > state.stage;
  if (previousStage !== state.stage && !state.manual) {
    if (state.stage <= 3) panel.scrollTop = 0;
    else {
      const target = state.stage === 4 ? $('.provider-stack') : $('.analyst-actions');
      panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 80;
    }
  }
  for (const button of root.querySelectorAll('.example-ioc')) {
    button.setAttribute('aria-expanded', String(state.stage >= 2 && button.dataset.kind === kind));
  }
  for (const button of root.querySelectorAll('button[data-stage]')) button.setAttribute('aria-pressed', String(Number(button.dataset.stage) === state.stage));
  $('#phase').textContent = state.paused ? 'Guide paused. Explore at your own pace.' : state.manual ? 'You are in control. ' + labels[state.stage - 1] : motion.matches ? 'Reduced motion: select an indicator to read the complete example.' : labels[state.stage - 1];
  $('#pause-demo').textContent = state.paused ? 'Resume guide' : 'Pause guide';
  $('#pause-demo').setAttribute('aria-pressed', String(state.paused));
  const pointer = $('.guide-pointer');
  pointer.hidden = !state.cursor;
  if (state.cursor) {
    const bounds = scene.getBoundingClientRect(), target = opener.getBoundingClientRect();
    pointer.style.left = `${target.left - bounds.left + 20}px`;
    pointer.style.top = `${target.top - bounds.top + 20}px`;
  }
}
const guide = createGuide({ render });
function takeControl() { copyRevision++; guide.takeControl(currentStage); }
function refresh() {
  copyRevision++;
  const data = exampleInvestigation(kind, notes.get(kind) || '');
  $('#ioc-kind').textContent = kind;
  $('#copy-ioc').textContent = data.ioc.value;
  $('#verdict').textContent = data.verdict;
  $('#score').textContent = String(data.score);
  $('#source-count').textContent = `${data.sources.length}/${data.sources.length} sources usable`;
  $('#demo-ai').textContent = data.aiBrief;
  $('.provider-stack').replaceChildren(...data.sources.map((source, i) => {
    const card = document.createElement('details'); card.className = 'mustela-provider'; card.open = i === 0;
    const summary = document.createElement('summary');
    const title = document.createElement('strong'); title.textContent = source.name;
    const icon = document.createElement('span'); icon.className = 'provider-badge';
    icon.textContent = { VirusTotal: 'VT', AbuseIPDB: 'AB', Shodan: 'SH', MISP: 'MI' }[source.name];
    const heading = document.createElement('span'); heading.className = 'provider-title'; heading.append(icon, title);
    const badge = document.createElement('span'); badge.className = 'provider-kind';
    badge.textContent = source.score ? `${source.score}/100` : source.kind;
    summary.append(heading, badge);
    const evidence = document.createElement('p'); evidence.textContent = source.evidence;
    card.append(summary, evidence); return card;
  }));
  note.value = data.analystNote;
  $('#note-status').textContent = 'Demo note stays in this session only.';
  $('#fallback-wrap').hidden = true; $('#copy-fallback').value = '';
}
function open(button) {
  notes.set(kind, note.value); kind = button.dataset.kind; opener = button;
  refresh(); guide.takeControl(5); panel.scrollTop = 0;
  // Manual investigation is immediate: no deferred result can overwrite a close or edit.
  $('#copy-ioc').focus();
}
function close() { guide.takeControl(1); copyRevision++; opener.focus(); }
const isPlayback = target => target.closest('#play, #pause-demo');
for (const event of ['pointerdown', 'focusin', 'keydown']) {
  root.addEventListener(event, e => {
    if (!isPlayback(e.target)) takeControl();
    if (e.type === 'keydown' && e.key === 'Escape' && !panel.hidden) { e.preventDefault(); close(); }
  });
}
for (const button of root.querySelectorAll('.example-ioc')) button.addEventListener('click', () => open(button));
$('#close').addEventListener('click', close);
for (const button of root.querySelectorAll('button[data-stage]')) button.addEventListener('click', () => guide.takeControl(Number(button.dataset.stage)));
$('#play').addEventListener('click', () => { copyRevision++; notes.set(kind, note.value); guide.replay(); });
$('#pause-demo').addEventListener('click', () => guide.pause());
$('#rerun').addEventListener('click', () => { notes.set(kind, note.value); refresh(); guide.takeControl(5); });
note.addEventListener('input', () => { takeControl(); copyRevision++; notes.set(kind, note.value); $('#note-status').textContent = 'Demo note retained for this session only.'; });
$('#misp').addEventListener('click', () => { $('#note-status').textContent = 'Demo only: no IOC sent to MISP. The extension requires a configured instance and event.'; });
const payload = () => JSON.stringify(exampleInvestigation(kind, note.value), null, 2);
async function copy(text) {
  takeControl();
  const revision = ++copyRevision;
  try {
    await navigator.clipboard.writeText(text);
    if (revision !== copyRevision) return;
    $('#fallback-wrap').hidden = true; $('#note-status').textContent = 'Copied example data.';
  } catch {
    if (revision !== copyRevision) return;
    $('#note-status').textContent = 'Clipboard unavailable. Select and copy manually or Download JSON.';
    $('#fallback-wrap').hidden = false; $('#copy-fallback').value = text;
    $('#copy-fallback').focus(); $('#copy-fallback').select();
  }
}
$('#copy-ioc').addEventListener('click', () => copy(exampleInvestigation(kind).ioc.value));
$('#copy-export').addEventListener('click', () => copy(payload()));
$('#download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([payload()], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'mustela-example-investigation.json';
  document.body.append(link); link.click(); link.remove();
  // This cleanup timer never changes UI, guide state or analyst choices.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('#note-status').textContent = 'Example JSON downloaded.';
});
const observer = new IntersectionObserver(entries => guide.conditions({ visible: entries[0].isIntersecting }), { threshold: 0 });
observer.observe(scene);
const visibility = () => guide.conditions({ hidden: document.hidden });
const preference = () => guide.conditions({ reduced: motion.matches });
document.addEventListener('visibilitychange', visibility);
motion.addEventListener('change', preference);
function pagehide(event) {
  if (event.persisted) { guide.conditions({ hidden: true }); return; }
  guide.dispose(); observer.disconnect();
  document.removeEventListener('visibilitychange', visibility); motion.removeEventListener('change', preference);
  window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', visibility);
}
window.addEventListener('pagehide', pagehide);
window.addEventListener('pageshow', visibility);
refresh(); guide.conditions({ hidden: document.hidden, reduced: motion.matches });
