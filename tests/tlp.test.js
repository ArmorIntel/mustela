import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTlp, validateTlp } from '../src/shared/tlp.js';
import { normalizeHistoryEntry, mergeHistoryEntries, saveHistoryTlp, saveHistoryNote, addHistory } from '../src/storage/storage.js';
import { addIocToMisp } from '../src/providers/providers.js';
import { generateInvestigationSummary, generateCorrelationAnalysis } from '../src/integrations/assistants.js';

const levels = [null, 'clear', 'green', 'amber', 'amber+strict', 'red'];
const ioc = { type: 'ip', normalized: '8.8.8.8' };

for (const tlp of levels) {
  test(`TLP ${tlp}: canonical storage, preservation and MISP attribute tag`, async () => {
    assert.equal(validateTlp(tlp), tlp);
    assert.equal(normalizeTlp(tlp), tlp);
    const entry = normalizeHistoryEntry({ ioc, tlp, analystNote: 'Keep note', pinned: true });
    assert.equal(entry.tlp, tlp);
    const [merged] = mergeHistoryEntries([entry], { ioc, tlp: 'clear' });
    assert.equal(merged.tlp, tlp, 'lookups cannot overwrite manual classification');
    assert.equal(merged.analystNote, 'Keep note');
    assert.equal(merged.pinned, true);
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ Attribute: { id: '42' } }) };
    };
    try {
      await addIocToMisp(ioc, { baseUrl: 'https://misp.example', defaultEventId: '7' }, { tlp, comment: 'Keep note', toIds: false });
      assert.deepEqual(calls, [{ url: 'https://misp.example/attributes/add/7', body: {
        value: '8.8.8.8', type: 'ip-dst', category: 'Network activity', to_ids: false, comment: 'Keep note',
        ...(tlp === null ? {} : { Tag: [{ name: `tlp:${tlp}` }] })
      } }]);
    } finally { globalThis.fetch = original; }
  });
}

test('legacy and unknown stored markings are unclassified; invalid incoming values never fetch', async () => {
  assert.equal(normalizeHistoryEntry({ ioc }).tlp, null);
  for (const tlp of ['white', 'RED', '', {}, undefined]) {
    assert.equal(normalizeTlp(tlp), null);
    assert.equal(normalizeHistoryEntry({ ioc, tlp }).tlp, null);
    assert.throws(() => validateTlp(tlp), /Invalid TLP/);
  }
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail('must not fetch');
  try {
    const config = { baseUrl: 'https://misp.example', defaultEventId: '7' };
    await assert.rejects(addIocToMisp(ioc, config, { tlp: 'white' }), /Invalid TLP/);
    for (const invalid of [null, {}, { type: 'ip' }, { normalized: '8.8.8.8' }, { type: 'asn', normalized: 'AS42' }, { type: 'subnet', normalized: '8.8.8.0/24' }]) {
      await assert.rejects(addIocToMisp(invalid, config, { tlp: 'red' }));
    }
  } finally { globalThis.fetch = original; }
});

test('dedicated local save validates, preserves metadata, propagates failures and serializes history updates', async () => {
  let data = { mustela_history: [normalizeHistoryEntry({ ioc, analystNote: 'Keep note', pinned: true })] };
  let fail = false;
  const original = globalThis.chrome;
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(data),
    set: async (value) => { if (fail) throw new Error('Storage unavailable'); data = structuredClone(value); }
  } } };
  try {
    for (const tlp of levels) {
      const saved = await saveHistoryTlp('ip:8.8.8.8', tlp);
      assert.equal(saved.tlp, tlp);
      assert.equal(saved.analystNote, 'Keep note');
      assert.equal(saved.pinned, true);
    }
    await assert.rejects(saveHistoryTlp('ip:8.8.8.8', 'white'), /Invalid TLP/);
    await assert.rejects(saveHistoryTlp('', 'red'), /history/i);
    await assert.rejects(saveHistoryTlp('ip:1.1.1.1', 'red'), /history/i);
    fail = true;
    await assert.rejects(saveHistoryTlp('ip:8.8.8.8', 'clear'), /Storage unavailable/);
    assert.equal(data.mustela_history[0].tlp, 'red');
    fail = false;
    await Promise.all([saveHistoryTlp('ip:8.8.8.8', 'red'), saveHistoryNote('ip:8.8.8.8', 'Updated note'), addHistory({ ioc })]);
    assert.equal(data.mustela_history[0].tlp, 'red');
    assert.equal(data.mustela_history[0].analystNote, 'Updated note');
    assert.equal(data.mustela_history[0].pinned, true);
  } finally { globalThis.chrome = original; }
});

test('manual TLP metadata is excluded from summary and correlation prompts', async () => {
  const original = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    prompts.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
  };
  try {
    const config = { baseUrl: 'https://llm.example', apiKey: 'test-only', model: 'test-model' };
    const entry = { ioc, tlp: 'amber+strict', analystNote: 'Local note' };
    await generateInvestigationSummary(entry, config);
    await generateCorrelationAnalysis([entry, { ...entry, ioc: { type: 'ip', normalized: '1.1.1.1' } }], config);
    assert.equal(prompts.length, 2);
    for (const prompt of prompts) assert.doesNotMatch(JSON.stringify(prompt), /tlp|amber\+strict|Local note/i);
  } finally { globalThis.fetch = original; }
});

for (const status of [403, 429, 500, 'timeout']) {
  test(`MISP ${status} fails once without an untagged retry`, async () => {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      calls++;
      assert.deepEqual(JSON.parse(options.body).Tag, [{ name: 'tlp:red' }]);
      if (status === 'timeout') throw new DOMException('Timed out', 'AbortError');
      return { ok: false, status };
    };
    try {
      await assert.rejects(addIocToMisp(ioc, { baseUrl: 'https://misp.example', defaultEventId: '7' }, { tlp: 'red' }));
      assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
  });
}
