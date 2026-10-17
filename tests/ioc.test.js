import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThreatSummary, detectSingleIoc, isValidIpv4, isValidSubnet, normalizeIoc, parseIocsFromText, summarizeProviderVerdict, IOC_TYPES } from '../src/shared/ioc.js';

test('email detection preserves local case, exact ranges and excludes nested identifiers', () => {
  for (const mode of ['balanced', 'strict']) {
    const raws = ['analyst+tag@evil.test', 'First.Last@EVIL.TEST', 'AS123@sub.evil.test', 'd41d8cd98f00b204e9800998ecf8427e@evil.test', "a!#$%&'*+-/=?^_`{|}~@sub.evil.test", 'analyst+tag@evil.test'];
    const text = raws.join(' ; ');
    const results = parseIocsFromText(text, { mode });
    assert.equal(results.length, raws.length);
    results.forEach((ioc, index) => {
      const raw = raws[index];
      assert.equal(ioc.type, 'email');
      assert.equal(ioc.raw, raw);
      assert.equal(ioc.normalized, raw.slice(0, raw.indexOf('@') + 1) + raw.slice(raw.indexOf('@') + 1).toLowerCase());
      assert.equal(ioc.index, text.indexOf(raw, index ? results[index - 1].index + results[index - 1].length : 0));
      assert.equal(ioc.length, raw.length);
    });
    for (const raw of ['a@@evil.test', 'a..b@sub.evil.test', '@sub.evil.test', '.a@evil.test', 'a.@evil.test', 'éa@sub.evil.test', 'a@évil.test', '"a b"@sub.evil.test', '"First.Last"@evil.test', 'a@evil-.test', 'a@evil[.]test', 'a@evil(.)sub.test', `${'a'.repeat(65)}@evil.test`]) {
      assert.deepEqual(parseIocsFromText(raw, { mode }), [], raw);
      assert.deepEqual(parseIocsFromText(`${raw} standalone.test`, { mode }).map((ioc) => ioc.normalized), ['standalone.test'], raw);
    }
    assert.equal(parseIocsFromText('https://evil.test/a@evil.test')[0].type, 'url');
    assert.equal(normalizeIoc('First.Last@EVIL.TEST', IOC_TYPES.EMAIL), 'First.Last@evil.test');
  }
});

for (const mode of ['balanced', 'strict']) {
  test(`unsupported quoted email tokens reserve escaped quotes in ${mode} mode`, () => {
    const addresses = [
      String.raw`"foo.test\" bar"@evil.test`,
      String.raw`"foo.test\\\" bar"@evil.test`,
      String.raw`"foo.test\\"@evil.test`,
      String.raw`"foo.test\" AS123 8.8.8.8"@evil.test`
    ];
    for (const address of addresses) {
      assert.deepEqual(parseIocsFromText(address, { mode }), [], address);
      const text = `${address} standalone.test analyst+tag@EVIL.TEST`;
      const results = parseIocsFromText(text, { mode });
      assert.deepEqual(results.map(({ type, normalized }) => ({ type, normalized })), [
        { type: 'domain', normalized: 'standalone.test' },
        { type: 'email', normalized: 'analyst+tag@evil.test' }
      ], address);
      for (const result of results) {
        assert.equal(result.index, text.indexOf(result.raw));
        assert.equal(text.slice(result.index, result.index + result.length), result.raw);
      }
    }
  });
}

test('IPv6 uses the IP type, canonical values and exact original source ranges', () => {
  const cases = [
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'], ['::1', '::1'], ['::', '::'],
    ['::ffff:192.0.2.1', '::ffff:c000:201'],
    ['1:2:3:4:5:6:192.0.2.1', '1:2:3:4:5:6:c000:201'],
    ['2001:0:0:1:0:0:1:1', '2001::1:0:0:1:1'],
    ['2001:0:1:0:0:0:1:1', '2001:0:1::1:1'],
    ['2001:db8:0:1:2:3:4:5', '2001:db8:0:1:2:3:4:5']
  ];
  for (const mode of ['balanced', 'strict']) {
    for (const [raw, normalized] of cases) {
      for (const text of [raw, `Before [${raw}], after.`, `(${raw}).`]) {
        const results = parseIocsFromText(text, { mode });
        assert.equal(results.length, 1, text);
        assert.deepEqual({ ...results[0], confidence: undefined }, {
          type: 'ip', raw, normalized, index: text.indexOf(raw), length: raw.length, confidence: undefined
        });
        assert.equal(normalizeIoc(raw, IOC_TYPES.IP), normalized);
      }
    }
  }
  const repeated = parseIocsFromText(`${cases[0][0]} 2001:db8::1`);
  assert.equal(repeated.length, 2);
  assert.equal(repeated[0].normalized, repeated[1].normalized);
});

test('IPv6 rejects whole malformed and unsupported tokens without nested IPv4 fragments', () => {
  for (const raw of [
    '2001::db8::1', '12345::1', '12:34:56', 'aa:bb:cc:dd:ee:ff',
    '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8::',
    ':::1', '2001:db8::g', 'x2001:db8::1', '2001:db8::1x',
    '::ffff:999.0.2.1', '::ffff:192.00.2.1', '::ffff:192.0.2.1:2',
    '::ffff:192.0.2.1/120', '2001:db8::1/64', 'fe80::1%eth0',
    '[2001:db8::1]/64', '[fe80::1%eth0]', '2001[:]db8::1', '::ffff:192[.]0[.]2[.]1', `${'abcd:'.repeat(10000)}1`
  ]) {
    assert.deepEqual(parseIocsFromText(raw), [], raw.slice(0, 100));
  }
  const results = parseIocsFromText('https://[2001:db8::1]/a ::ffff:192.0.2.1 d41d8cd98f00b204e9800998ecf8427e');
  assert.deepEqual(results.map((r) => r.type), ['url', 'ip', 'md5']);
  assert.equal(results[0].raw, 'https://[2001:db8::1]/a');
});

test('ordinary colon labels retain IPv4 and subnet detection', () => {
  assert.equal(detectSingleIoc('IP:8.8.8.8').normalized, '8.8.8.8');
  assert.equal(detectSingleIoc('network:8.8.8.0/24').type, 'subnet');
  for (const mode of ['balanced', 'strict']) {
    for (const [text, values, type] of [
      ['IP:192.0.2.1:443', ['192.0.2.1'], 'ip'],
      ['src:192.0.2.1:dst:198.51.100.2', ['192.0.2.1', '198.51.100.2'], 'ip'],
      ['network:192.0.2.0/24:port:443', ['192.0.2.0/24'], 'subnet']
    ]) {
      const results = parseIocsFromText(text, { mode });
      assert.deepEqual(results.map((r) => r.normalized), values, text);
      for (const result of results) {
        assert.equal(result.type, type);
        assert.equal(result.index, text.indexOf(result.raw));
        assert.equal(text.slice(result.index, result.index + result.length), result.raw);
      }
    }
  }
});

test('normalizeIoc trims URL punctuation and lowercases domains/hashes', () => {
  assert.equal(normalizeIoc('https://example.com/path);', IOC_TYPES.URL), 'https://example.com/path');
  assert.equal(normalizeIoc('Example.COM', IOC_TYPES.DOMAIN), 'example.com');
  assert.equal(normalizeIoc('ABCDEF0123456789ABCDEF0123456789', IOC_TYPES.MD5), 'abcdef0123456789abcdef0123456789');
});

test('defanged separators preserve original ranges and URL precedence', () => {
  for (const scheme of ['http', 'https', 'hxxp', 'HXXPS']) {
    for (const colon of [':', '[:]']) {
      for (const dot of ['.', '[.]', '(.)']) {
        for (const host of [`evil${dot}test`, `8${dot}8${dot}8${dot}8`]) {
          const raw = `${scheme}${colon}//${host}/a[.]b?q=(.)`;
          const text = `Before (${raw}); after evil[.]test and 8[.]8(.)8[.]8.`;
          const results = parseIocsFromText(text);
          assert.deepEqual(results.map((r) => r.type), ['url', 'domain', 'ip']);
          assert.equal(results[0].raw, raw);
          assert.equal(results[0].normalized, `${scheme.toLowerCase().replace('xx', 'tt')}://${host.replace(/\[\.\]|\(\.\)/g, '.')}/a[.]b?q=(.)`);
          for (const result of results) {
            assert.equal(text.slice(result.index, result.index + result.length), result.raw);
            assert.equal(result.index, result.type === 'url' ? text.indexOf(raw) : text.lastIndexOf(result.raw));
          }
          assert.equal(detectSingleIoc(raw).normalized, results[0].normalized);
        }
      }
    }
  }
});

test('defanged domains retain exclusions and IP validation in both detection modes', () => {
  for (const mode of ['balanced', 'strict']) {
    const results = parseIocsFromText('evil[.]test evil(.)test 8[.]8(.)8[.]8 999[.]8[.]8[.]8 microsoft[.]com malware(.)exe printer[.]local admin@evil[.]org', { mode });
    assert.deepEqual(results.map((r) => r.normalized), ['evil.test', 'evil.test', '8.8.8.8']);
  }
  assert.equal(parseIocsFromText('google[.]com', { mode: 'strict' }).length, 0);
  assert.equal(parseIocsFromText('import from cdn[.]test', { mode: 'strict' }).length, 0);
  assert.equal(normalizeIoc('HXXPS[:]//evil[.]test/a[.]b?q=(.)', 'url'), 'https://evil.test/a[.]b?q=(.)');
});

test('IPv4 and subnet validation reject invalid values', () => {
  assert.equal(isValidIpv4('1.2.3.4'), true);
  assert.equal(isValidIpv4('999.2.3.4'), false);
  assert.equal(isValidSubnet('1.2.3.4/24'), true);
  assert.equal(isValidSubnet('1.2.3.4/99'), false);
});

test('parseIocsFromText detects unique IOCs and avoids domain duplicates inside URLs', () => {
  const text = 'See https://evil.example/path and 8.8.8.8 plus AS13335 and evil.example again';
  const results = parseIocsFromText(text);
  assert.equal(results.some((r) => r.type === IOC_TYPES.URL && r.normalized === 'https://evil.example/path'), true);
  assert.equal(results.some((r) => r.type === IOC_TYPES.IP && r.normalized === '8.8.8.8'), true);
  assert.equal(results.some((r) => r.type === IOC_TYPES.ASN && r.normalized === 'AS13335'), true);
  const domains = results.filter((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'evil.example');
  assert.equal(domains.length, 1);
});

test('detectSingleIoc returns first detected IOC', () => {
  const detected = detectSingleIoc('IOC 8.8.4.4 and domain example.org');
  assert.ok(detected);
  assert.equal(detected.type, IOC_TYPES.IP);
  assert.equal(detected.normalized, '8.8.4.4');
  assert.ok(detected.confidence >= 0.9);
});

test('parseIocsFromText excludes obvious noise like .local, file-like domains and email domains', () => {
  const text = 'Ignore printer.local malware.exe admin@example.org but keep evil.example and https://good.test/path';
  const results = parseIocsFromText(text);
  assert.equal(results.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'printer.local'), false);
  assert.equal(results.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'malware.exe'), false);
  assert.equal(results.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'example.org'), false);
  assert.equal(results.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'evil.example'), true);
});

test('strict mode reduces asset and documentation noise while balanced mode stays permissive', () => {
  const text = 'Import from cdn.jsdelivr.net and keep evil.example plus portal.amazon.com for investigation';
  const balanced = parseIocsFromText(text, { mode: 'balanced' });
  const strict = parseIocsFromText(text, { mode: 'strict' });

  assert.equal(balanced.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'cdn.jsdelivr.net'), true);
  assert.equal(strict.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'cdn.jsdelivr.net'), false);
  assert.equal(balanced.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'portal.amazon.com'), true);
  assert.equal(strict.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'portal.amazon.com'), true);
  assert.equal(strict.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'evil.example'), true);
});

test('detectSingleIoc honors detection mode when the first match is noise', () => {
  const text = 'import from cdn.jsdelivr.net then review evil.example';
  assert.equal(detectSingleIoc(text, { mode: 'balanced' })?.normalized, 'cdn.jsdelivr.net');
  assert.equal(detectSingleIoc(text, { mode: 'strict' })?.normalized, 'evil.example');
});

test('summarizeProviderVerdict produces suspicious/malicious verdicts and tags', () => {
  const suspicious = summarizeProviderVerdict([
    { provider: 'AbuseIPDB', success: true, meta: { abuseConfidenceScore: 75, usageType: 'Data Center/Web Hosting/Transit' } },
    { provider: 'Shodan', success: true, meta: { ports: [22, 443] } }
  ]);
  assert.equal(suspicious.overallVerdict, 'suspicious');
  assert.ok(suspicious.tags.includes('sensitive-service'));
  assert.equal(suspicious.recommendation.level, 'medium');
  assert.match(suspicious.explanation, /AbuseIPDB|Shodan/);

  const malicious = summarizeProviderVerdict([
    { provider: 'VirusTotal', success: true, meta: { malicious: 11 } }
  ]);
  assert.equal(malicious.overallVerdict, 'malicious');
  assert.equal(malicious.recommendation.level, 'high');
});

test('summarizeProviderVerdict explains low-signal and no-signal outcomes', () => {
  const lowSignal = summarizeProviderVerdict([
    { provider: 'Shodan', success: true, meta: { ports: [443] } }
  ]);
  assert.equal(lowSignal.overallVerdict, 'clean');
  assert.equal(lowSignal.recommendation.level, 'low');
  assert.match(lowSignal.recommendation.summary, /contextual data|Weak or partial signals/i);

  const noSignal = summarizeProviderVerdict([]);
  assert.equal(noSignal.overallVerdict, 'unknown');
  assert.equal(noSignal.score, 0);
  assert.equal(noSignal.recommendation.level, 'info');
  assert.match(noSignal.explanation, /No provider returned/i);
});


test('buildThreatSummary produces a concise analyst narrative from existing provider data', () => {
  const summary = buildThreatSummary({
    overallVerdict: 'malicious',
    score: 92,
    providerResults: [
      { provider: 'VirusTotal', success: true, meta: { malicious: 11 } },
      { provider: 'AbuseIPDB', success: true, meta: { abuseConfidenceScore: 95, totalReports: 12 } },
      { provider: 'Shodan', success: false }
    ],
    scoreFactors: [
      'VirusTotal reported 11 malicious or suspicious engine detections.',
      'AbuseIPDB confidence is very high (95/100).'
    ],
    recommendation: { summary: 'Multiple strong signals indicate this IOC is likely malicious.' }
  });

  assert.equal(summary.headline, 'High-confidence malicious signal');
  assert.match(summary.narrative, /2\/3 providers returned usable data, 1 degraded\./i);
  assert.match(summary.narrative, /VirusTotal flagged 11 engines\./i);
  assert.deepEqual(summary.evidence, [
    'VirusTotal flagged 11 engines.',
    'AbuseIPDB scored it 95/100 with 12 reports.'
  ]);
});

test('parseIocsFromText does not flag firstname.lastname style strings as domains when the TLD-like part is too long', () => {
  // "nomdefamille" (12 chars) and similar long last names are not valid TLDs
  const text = 'Assigned to prenom.nomdefamille for review, contact jean.bernardmuche directly';
  const results = parseIocsFromText(text);
  assert.equal(results.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'prenom.nomdefamille'), false);
  assert.equal(results.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'jean.bernardmuche'), false);
});

test('parseIocsFromText still detects real domains with long but valid TLDs', () => {
  const text = 'Connecting to evil.solutions and backdoor.international for C2';
  const results = parseIocsFromText(text);
  assert.equal(results.some((r) => r.type === IOC_TYPES.DOMAIN && r.normalized === 'evil.solutions'), true);
});

test('buildThreatSummary handles no-signal outcomes without inventing confidence', () => {
  const summary = buildThreatSummary({
    overallVerdict: 'unknown',
    score: 0,
    providerResults: [
      { provider: 'VirusTotal', success: false },
      { provider: 'Shodan', success: false }
    ],
    recommendation: { summary: 'No successful provider result is available, so the extension cannot recommend a disposition.' },
    explanation: 'No provider returned a usable result.'
  });

  assert.equal(summary.headline, 'Insufficient provider signal');
  assert.match(summary.narrative, /No provider returned usable data out of 2\./i);
  assert.equal(summary.evidence.length, 0);
});
