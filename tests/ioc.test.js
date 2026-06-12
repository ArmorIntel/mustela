import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThreatSummary, detectSingleIoc, isValidIpv4, isValidSubnet, normalizeIoc, parseIocsFromText, summarizeProviderVerdict, IOC_TYPES } from '../src/shared/ioc.js';

test('normalizeIoc trims URL punctuation and lowercases domains/hashes', () => {
  assert.equal(normalizeIoc('https://example.com/path);', IOC_TYPES.URL), 'https://example.com/path');
  assert.equal(normalizeIoc('Example.COM', IOC_TYPES.DOMAIN), 'example.com');
  assert.equal(normalizeIoc('ABCDEF0123456789ABCDEF0123456789', IOC_TYPES.MD5), 'abcdef0123456789abcdef0123456789');
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
