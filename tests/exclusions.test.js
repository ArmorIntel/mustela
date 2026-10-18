import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExclusionRules, isExcluded } from '../src/shared/exclusions.js';

const hostRule = (value) => ({ kind: 'host', value });
const pageRule = (value) => ({ kind: 'page-url', value });
const iocRule = (iocType, value) => ({ kind: 'ioc', iocType, value });

test('host patterns match labels, never the bare suffix or a substring', () => {
  const rules = normalizeExclusionRules([hostRule('*.INTRANET.corp')]);
  for (const host of ['a.intranet.corp', 'A.b.INTRANET.corp']) {
    assert.equal(isExcluded(rules, { pageUrl: `https://${host}/case` }), true);
    assert.equal(isExcluded(rules, { ioc: { type: 'domain', normalized: host } }), true);
    assert.equal(isExcluded(rules, { ioc: { type: 'url', raw: `hxxps://${host}/Case` } }), true);
  }
  for (const host of ['intranet.corp', 'intranet.corp.evil', 'notintranet.corp', 'evil.corp']) {
    assert.equal(isExcluded(rules, { pageUrl: `https://${host}/` }), false);
  }
  const exact = normalizeExclusionRules([hostRule('INTRANET.corp')]);
  assert.equal(isExcluded(exact, { pageUrl: 'https://intranet.corp/' }), true);
  assert.equal(isExcluded(exact, { pageUrl: 'https://a.intranet.corp/' }), false);
});

test('page URL rules preserve byte-exact pause semantics, not URL parser equivalence', () => {
  const value = 'https://INTRANET.corp/Case?q=1#A';
  const rules = normalizeExclusionRules([pageRule(value)]);
  assert.equal(isExcluded(rules, { pageUrl: value }), true);
  for (const other of [value.toLowerCase(), `${value}x`, 'https://INTRANET.corp/Case?q=1#B']) {
    assert.equal(isExcluded(rules, { pageUrl: other }), false);
  }
  assert.equal(isExcluded(rules, { ioc: { type: 'url', raw: value } }), false);
});

test('exact IOC rules use existing type-specific normalization and full identities', () => {
  const pairs = [
    ['domain', ' EVIL[.]TEST ', 'evil.test'],
    ['ip', '8[.]8[.]8[.]8', '8.8.8.8'],
    ['ip', '2001:0DB8:0:0:0:0:0:1', '2001:db8::1'],
    ['url', 'hxxps[:]//evil[.]test/Case?q=A', 'https://evil.test/Case?q=A'],
    ['md5', 'A'.repeat(32), 'a'.repeat(32)],
    ['sha1', 'B'.repeat(40), 'b'.repeat(40)],
    ['sha256', 'C'.repeat(64), 'c'.repeat(64)],
    ['asn', 'as123', 'AS123'],
    ['subnet', '8.8.8.0/24', '8.8.8.0/24'],
    ['email', 'First.Last@EVIL.TEST', 'First.Last@evil.test']
  ];
  for (const [type, input, normalized] of pairs) {
    const rules = normalizeExclusionRules([iocRule(type, input)]);
    assert.equal(rules[0].value, normalized);
    assert.equal(isExcluded(rules, { ioc: { type, normalized } }), true);
    assert.equal(isExcluded(rules, { ioc: { type, raw: input } }), true);
    assert.equal(isExcluded(rules, { ioc: { type, normalized: `${normalized}x` } }), false);
  }
  const email = normalizeExclusionRules([iocRule('email', 'First@evil.test')]);
  assert.equal(isExcluded(email, { ioc: { type: 'email', raw: 'first@evil.test' } }), false);
  assert.equal(isExcluded(normalizeExclusionRules([iocRule('domain', 'example.com')]), {
    ioc: { type: 'domain', raw: 'example.com' }
  }), true, 'detection noise filters must not reject explicit exact values');
});

test('validation rejects malformed rules, free regex and partial IOC candidates', () => {
  const invalid = [null, '', {}, { kind: 'allow', value: 'evil.test' },
    hostRule('/evil.*/i'), hostRule('a.*.corp'), hostRule('*corp'), hostRule('*.corp/path'),
    hostRule('-bad.corp'), hostRule('a..corp'), hostRule('a'.repeat(64) + '.corp'),
    pageRule('not a URL'), pageRule('javascript:alert(1)'), pageRule('https://evil.test/\n'),
    pageRule(' https://evil.test/'), pageRule('https://'), pageRule('https://bad\\host/'),
    iocRule('regex', '.*'), iocRule('ip', '999.1.1.1'), iocRule('subnet', '8.8.8.8/24/garbage'),
    iocRule('asn', 'AS0'), iocRule('md5', 'g'.repeat(32)), iocRule('domain', 'evil.test/path'),
    iocRule('url', 'https://'), iocRule('domain', 'prefix evil.test'),
    iocRule('email', 'a..b@evil.test'), iocRule('ip', '8.8.8.8 trailing'),
    { ...hostRule('evil.test'), allow: true }
  ];
  for (const rule of invalid) assert.throws(() => normalizeExclusionRules([rule]), /exclusion/i);
  assert.throws(() => normalizeExclusionRules({}), /exclusion/i);
});

test('an exclusion suffices across page and IOC inputs; empty rules exclude nothing', () => {
  const rules = normalizeExclusionRules([hostRule('*.intranet.corp'), iocRule('ip', '8.8.8.8')]);
  assert.equal(isExcluded(rules, { pageUrl: 'https://public.test/', ioc: { type: 'ip', raw: '8.8.8.8' } }), true);
  assert.equal(isExcluded(rules, { pageUrl: 'https://a.intranet.corp/', ioc: { type: 'ip', raw: '1.1.1.1' } }), true);
  assert.equal(isExcluded([], { pageUrl: 'https://a.intranet.corp/', ioc: { type: 'ip', raw: '8.8.8.8' } }), false);
  assert.equal(isExcluded(rules, {}), false);
  assert.deepEqual(normalizeExclusionRules([hostRule('EVIL.test'), hostRule('evil.test')]), [hostRule('evil.test')]);
});

function storageMock(initial = {}) {
  const data = structuredClone(initial);
  globalThis.chrome = { storage: { local: {
    async get(keys) {
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(data[key])]));
    },
    async set(values) { Object.assign(data, structuredClone(values)); }
  } } };
  return data;
}

const storageUrl = new URL('../src/storage/storage.js', import.meta.url);

test('rules persist locally and are recognized after a fresh module load without API keys', async () => {
  const data = storageMock();
  const first = await import(`${storageUrl}?first`);
  const rules = [pageRule('https://console.corp/Case'), iocRule('domain', 'EVIL[.]TEST')];
  await first.saveExclusionRules(rules);
  assert.deepEqual(data.mustela_exclusions, { version: 1, rules: normalizeExclusionRules(rules) });
  const restarted = await import(`${storageUrl}?restarted`);
  const restored = await restarted.getExclusionRules();
  assert.equal(isExcluded(restored, { pageUrl: rules[0].value }), true);
  assert.equal(isExcluded(restored, { ioc: { type: 'domain', raw: 'evil.test' } }), true);
  assert.equal(Object.keys(data).some((key) => /settings|cache|history/.test(key)), false);
});

test('legacy exact pauses migrate without loss, normalization or stale duplicates', async () => {
  const legacy = ['https://INTRANET.corp/Case#A', 'file:///private/case.txt'];
  const data = storageMock({ mustela_disabled_pages: legacy });
  const storage = await import(`${storageUrl}?migration`);
  const rules = await storage.getExclusionRules();
  assert.deepEqual(rules, legacy.map(pageRule));
  assert.deepEqual(data.mustela_disabled_pages, legacy);
  assert.deepEqual(data.mustela_exclusions, { version: 1, rules: [] });
  assert.deepEqual(await storage.getExclusionRules(), rules);
  assert.equal(await storage.isPageDisabled(legacy[0]), true);
  assert.equal(isExcluded(rules, { pageUrl: legacy[0].toLowerCase() }), false);
  await storage.setPageDisabled(legacy[0], false);
  assert.equal(isExcluded(await storage.getExclusionRules(), { pageUrl: legacy[0] }), false);
  await storage.saveExclusionRules([hostRule('*.intranet.corp')]);
  assert.equal(isExcluded(await storage.getExclusionRules(), { pageUrl: legacy[1] }), true);
  await storage.clearDisabledPages();
  assert.deepEqual(await storage.getExclusionRules(), [hostRule('*.intranet.corp')]);
});

test('first-read migration and overlapping replacements cannot lose a saved list', async () => {
  const data = storageMock();
  const storage = await import(`${storageUrl}?concurrent`);
  const first = storage.getExclusionRules();
  const save = storage.saveExclusionRules([hostRule('saved.corp')]);
  await Promise.all([first, save]);
  assert.deepEqual(await storage.getExclusionRules(), [hostRule('saved.corp')]);
  assert.deepEqual(data.mustela_exclusions.rules, [hostRule('saved.corp')]);
  await Promise.all([
    storage.saveExclusionRules([hostRule('earlier.corp')]),
    storage.saveExclusionRules([hostRule('last.corp')])
  ]);
  assert.deepEqual(await storage.getExclusionRules(), [hostRule('last.corp')]);
});

test('new rules do not activate existing pause checks; storage errors propagate without false saves', async () => {
  const data = storageMock();
  const storage = await import(`${storageUrl}?failure`);
  const page = 'https://console.corp/';
  await storage.saveExclusionRules([pageRule(page)]);
  assert.equal(await storage.isPageDisabled(page), false);
  const before = structuredClone(data);
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(storage.saveExclusionRules([hostRule('other.corp')]), /Storage unavailable/);
  assert.deepEqual(data, before);
  chrome.storage.local.set = set;
  await storage.saveExclusionRules([]);
  assert.deepEqual(await storage.getExclusionRules(), []);
});

test('invalid saves are atomic; empty rules add nothing; unknown versions are not overwritten', async () => {
  const data = storageMock();
  const storage = await import(`${storageUrl}?atomic`);
  await storage.saveExclusionRules([hostRule('valid.corp')]);
  const before = structuredClone(data);
  await assert.rejects(storage.saveExclusionRules([hostRule('other.corp'), hostRule('/.*/')]), /exclusion/i);
  assert.deepEqual(data, before);
  await storage.saveExclusionRules([]);
  assert.deepEqual(await storage.getExclusionRules(), []);
  data.mustela_exclusions = { version: 99, rules: [] };
  await assert.rejects(storage.getExclusionRules(), /version/i);
  await assert.rejects(storage.saveExclusionRules([]), /version/i);
  assert.equal(data.mustela_exclusions.version, 99);
});
