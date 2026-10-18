import { normalizeExclusionRules } from '../shared/exclusions.js';
import { IOC_TYPES } from '../shared/ioc.js';

export async function mountExclusionsEditor() {
  const list = document.getElementById('exclusionRules');
  const status = document.getElementById('exclusionStatus');
  const save = document.getElementById('saveExclusions');
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });
  function addRow(rule = { kind: 'page-url', value: '' }) {
    const row = document.createElement('div');
    row.className = 'exclusion-row';
    const kind = document.createElement('select');
    kind.setAttribute('aria-label', 'Rule kind');
    for (const [value, label] of [['page-url', 'Exact page URL'], ['ioc', 'Exact IOC'], ['host', 'Host pattern']]) {
      kind.add(new Option(label, value));
    }
    kind.value = rule.kind;
    const type = document.createElement('select');
    type.setAttribute('aria-label', 'IOC type');
    for (const value of Object.values(IOC_TYPES)) type.add(new Option(value.toUpperCase(), value));
    type.value = rule.iocType || 'ip';
    type.hidden = kind.value !== 'ioc';
    kind.addEventListener('change', () => { type.hidden = kind.value !== 'ioc'; });
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'Rule value');
    input.value = rule.value;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => { row.remove(); status.textContent = 'Unsaved exclusion changes.'; });
    row.append(kind, type, input, remove);
    row.addEventListener('input', () => { status.textContent = 'Unsaved exclusion changes.'; });
    list.append(row);
  }
  async function load() {
    save.disabled = true;
    const response = await send('GET_EXCLUSIONS');
    if (!response?.ok) throw new Error(response?.error || 'Unable to load exclusion rules.');
    list.replaceChildren();
    response.data.rules.forEach(addRow);
    const legacy = document.getElementById('legacyExclusions');
    legacy.replaceChildren();
    for (const url of response.data.pausedPages) {
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = `Paused page: ${url} `;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove page pause';
      remove.addEventListener('click', async () => {
        const result = await send('SET_PAGE_DISABLED', { url, disabled: false });
        if (result?.ok) row.remove();
        status.textContent = result?.ok ? 'Page pause removed. You can retry explicitly.' : result?.error || 'Removal failed.';
      });
      row.append(label, remove);
      legacy.append(row);
    }
    save.disabled = false;
    status.textContent = 'Local exclusions loaded.';
  }
  document.getElementById('addExclusion').addEventListener('click', () => {
    addRow();
    status.textContent = 'Unsaved exclusion changes.';
    list.lastElementChild.querySelector('input').focus();
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const rules = [...list.children].map((row, index) => {
        const [kind, type] = row.querySelectorAll('select');
        const rule = { kind: kind.value, value: row.querySelector('input').value };
        if (rule.kind === 'ioc') rule.iocType = type.value;
        try { return normalizeExclusionRules([rule])[0]; }
        catch { throw new Error(`Rule ${index + 1} is invalid. Use an exact HTTP(S) page URL, exact typed IOC, or host / *.host pattern; regex is not supported. Saved rules were not changed.`); }
      });
      const response = await send('SAVE_EXCLUSIONS', rules);
      if (!response?.ok) throw new Error(response?.error || 'Save failed.');
      list.replaceChildren();
      response.data.forEach(addRow);
      status.textContent = 'Exclusions saved locally. Open pages updated; no investigation started.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      save.disabled = false;
    }
  });
  try { await load(); }
  catch (error) { status.textContent = error.message; }
}
