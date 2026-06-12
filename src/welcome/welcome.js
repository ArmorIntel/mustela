let hasUnsavedChanges = false;
let toastTimer;

async function send(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

function setStatus(text, isError = false) {
  const ids = ['statusTop', 'statusStorage'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
      el.style.color = isError ? '#fda4af' : 'rgba(226,232,240,.82)';
    }
  }
}

async function load() {
  const response = await send('GET_SETTINGS');
  const s = response.data;
  document.getElementById('highlightEnabled').checked = !!s.highlightEnabled;
  document.getElementById('detectionMode').value = s.detectionMode === 'strict' ? 'strict' : 'balanced';
  document.getElementById('cacheTtlMinutes').value = s.cacheTtlMinutes || 30;
  document.getElementById('virustotalEnabled').checked = !!s.providers.virustotal.enabled;
  document.getElementById('virustotalKey').value = s.providers.virustotal.apiKey || '';
  document.getElementById('abuseipdbEnabled').checked = !!s.providers.abuseipdb.enabled;
  document.getElementById('abuseipdbKey').value = s.providers.abuseipdb.apiKey || '';
  document.getElementById('shodanEnabled').checked = !!s.providers.shodan.enabled;
  document.getElementById('shodanKey').value = s.providers.shodan.apiKey || '';
}

async function save() {
  const payload = {
    highlightEnabled: document.getElementById('highlightEnabled').checked,
    detectionMode: document.getElementById('detectionMode').value === 'strict' ? 'strict' : 'balanced',
    cacheTtlMinutes: Number(document.getElementById('cacheTtlMinutes').value || 30),
    providers: {
      virustotal: { enabled: document.getElementById('virustotalEnabled').checked, apiKey: document.getElementById('virustotalKey').value.trim() },
      abuseipdb: { enabled: document.getElementById('abuseipdbEnabled').checked, apiKey: document.getElementById('abuseipdbKey').value.trim() },
      shodan: { enabled: document.getElementById('shodanEnabled').checked, apiKey: document.getElementById('shodanKey').value.trim() }
    }
  };
  const response = await send('SAVE_SETTINGS', payload);
  setStatus(response.ok ? 'Settings saved locally.' : `Error: ${response.error}`, !response.ok);
  if (response.ok) {
    setDirtyState(false);
    showToast('Settings saved locally.');
  } else {
    showToast('Save failed.', true);
  }
}


document.getElementById('saveStickyBtn')?.addEventListener('click', save);

document.getElementById('clearCacheBtn')?.addEventListener('click', async () => {
  const response = await send('CLEAR_CACHE');
  setStatus(response.ok ? 'Cache cleared.' : `Error: ${response.error}`, !response.ok);
  showToast(response.ok ? 'Cache cleared.' : 'Action failed.', !response.ok);
});

document.getElementById('clearHistoryBtn')?.addEventListener('click', async () => {
  const response = await send('CLEAR_HISTORY');
  setStatus(response.ok ? 'History cleared.' : `Error: ${response.error}`, !response.ok);
  showToast(response.ok ? 'History cleared.' : 'Action failed.', !response.ok);
});

document.getElementById('resetDisabledPagesBtn')?.addEventListener('click', async () => {
  const response = await send('CLEAR_DISABLED_PAGES');
  setStatus(response.ok ? 'Paused-page list reset.' : `Error: ${response.error}`, !response.ok);
  showToast(response.ok ? 'Paused-page list reset.' : 'Action failed.', !response.ok);
});

bindDirtyTracking();
setDirtyState(false);
load();


function setProviderStatus(provider, state, message) {
  const el = document.getElementById(`${provider}TestStatus`);
  if (!el) return;
  el.classList.remove('valid', 'invalid', 'limited');
  if (state === 'valid') el.classList.add('valid');
  if (state === 'invalid') el.classList.add('invalid');
  if (state === 'limited') el.classList.add('limited');
  const text = el.querySelector('span:last-child');
  if (text) text.textContent = message;
}

async function testProvider(provider, inputId) {
  const apiKey = document.getElementById(inputId)?.value?.trim() || '';
  setProviderStatus(provider, null, 'Testing…');
  const response = await send('TEST_API_KEY', { provider, apiKey });
  if (!response.ok) {
    setProviderStatus(provider, 'invalid', 'Validation failed');
    showToast('API key test failed.', true);
    return;
  }
  const valid = !!response.data?.valid;
  const limited = !!response.data?.limited;
  const message = response.data?.message || (valid ? 'API key valid' : 'Invalid API key');
  setProviderStatus(provider, valid ? (limited ? 'limited' : 'valid') : 'invalid', message);
  showToast(valid ? message : 'Invalid API key.', !valid);
}

document.getElementById('testVirusTotalBtn')?.addEventListener('click', () => testProvider('virustotal', 'virustotalKey'));
document.getElementById('testAbuseIPDBBtn')?.addEventListener('click', () => testProvider('abuseipdb', 'abuseipdbKey'));
document.getElementById('testShodanBtn')?.addEventListener('click', () => testProvider('shodan', 'shodanKey'));


function setDirtyState(isDirty) {
  hasUnsavedChanges = isDirty;
  const bar = document.getElementById('stickySavebar');
  const text = document.getElementById('stickySaveText');
  if (!bar || !text) return;
  bar.classList.toggle('hidden', !isDirty);
  text.textContent = isDirty ? 'Unsaved settings changes' : 'All settings saved';
}

function showToast(message, isError = false) {
  const toast = document.getElementById('saveToast');
  const text = document.getElementById('saveToastText');
  const icon = toast?.querySelector('.toast-icon');
  if (!toast || !text || !icon) return;
  text.textContent = message;
  icon.textContent = isError ? '!' : '✓';
  icon.style.background = isError ? 'rgba(239,68,68,.18)' : 'rgba(34,197,94,.18)';
  icon.style.color = isError ? '#fca5a5' : '#86efac';
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function bindDirtyTracking() {
  const selectors = ['highlightEnabled', 'detectionMode', 'cacheTtlMinutes', 'virustotalEnabled', 'virustotalKey', 'abuseipdbEnabled', 'abuseipdbKey', 'shodanEnabled', 'shodanKey'];
  selectors.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventName, () => setDirtyState(true));
  });
}
