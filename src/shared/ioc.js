export const IOC_TYPES = {
  IP: 'ip',
  DOMAIN: 'domain',
  URL: 'url',
  MD5: 'md5',
  SHA1: 'sha1',
  SHA256: 'sha256',
  SUBNET: 'subnet',
  ASN: 'asn'
};

const IPV4_CANDIDATE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SUBNET_CANDIDATE = /\b(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[12][0-9]|3[0-2])\b/g;
const ASN_CANDIDATE = /\bAS(?:[1-9]\d{0,9})\b/gi;
const URL_CANDIDATE = /\bhttps?:\/\/[^\s<>'"`]+/gi;
const HASH_CANDIDATE = /\b[a-fA-F0-9]{32}\b|\b[a-fA-F0-9]{40}\b|\b[a-fA-F0-9]{64}\b/g;
const DOMAIN_CANDIDATE = /\b(?=.{1,253}\b)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:[a-zA-Z]{2,63})\b/g;

const DOMAIN_EXCLUSIONS = new Set(['microsoft.com', 'example.com', 'localhost']);
const DOMAIN_TLD_EXCLUSIONS = new Set(['local', 'internal', 'exe', 'dll', 'bin', 'tmp', 'log', 'conf', 'ps1', 'bat', 'sh', 'js']);
const DETECTION_MODES = new Set(['balanced', 'strict']);
const STRICT_DOMAIN_EXCLUSIONS = new Set(['google.com', 'apple.com', 'amazon.com']);

export function isValidIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

export function isValidSubnet(value) {
  const [ip, prefix] = String(value).split('/');
  if (!isValidIpv4(ip)) return false;
  const p = Number(prefix);
  return Number.isInteger(p) && p >= 0 && p <= 32;
}

export function normalizeIoc(raw, type) {
  const value = String(raw || '').trim();
  switch (type) {
    case IOC_TYPES.URL:
      return value.replace(/[),.;]+$/g, '');
    case IOC_TYPES.DOMAIN:
      return value.toLowerCase().replace(/^\.+|\.+$/g, '');
    case IOC_TYPES.MD5:
    case IOC_TYPES.SHA1:
    case IOC_TYPES.SHA256:
      return value.toLowerCase();
    case IOC_TYPES.ASN:
      return value.toUpperCase();
    default:
      return value;
  }
}

export function detectHashType(value) {
  const length = value.length;
  if (length === 32) return IOC_TYPES.MD5;
  if (length === 40) return IOC_TYPES.SHA1;
  if (length === 64) return IOC_TYPES.SHA256;
  return null;
}

function pushUnique(results, item) {
  if (!results.some((entry) => entry.type === item.type && entry.normalized === item.normalized && entry.index === item.index)) {
    results.push(item);
  }
}

function getDomainTld(value) {
  const parts = String(value || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) : '';
}

function resolveDetectionMode(mode) {
  return DETECTION_MODES.has(mode) ? mode : 'balanced';
}

function readContextWindow(text, index = 0, raw = '') {
  const start = Math.max(0, index - 24);
  const end = Math.min(String(text || '').length, index + String(raw || '').length + 24);
  return String(text || '').slice(start, end).toLowerCase();
}

function looksLikeAssetContext(text, index = 0, raw = '') {
  const windowText = readContextWindow(text, index, raw);
  return /(import\s+|from\s+|src=|href=|filename|file\s+name|attachment|download)/i.test(windowText);
}

function isLikelyExcludedDomain(value, text, index = 0, options = {}) {
  const normalized = normalizeIoc(value, IOC_TYPES.DOMAIN);
  const mode = resolveDetectionMode(options.mode);
  if (DOMAIN_EXCLUSIONS.has(normalized)) return true;
  if (DOMAIN_TLD_EXCLUSIONS.has(getDomainTld(normalized))) return true;
  if (mode === 'strict' && STRICT_DOMAIN_EXCLUSIONS.has(normalized)) return true;
  const before = text[index - 1] || '';
  if (before === '@') return true;
  if (mode === 'strict' && looksLikeAssetContext(text, index, value)) return true;
  return false;
}

function scoreDetectionConfidence(type, normalized) {
  switch (type) {
    case IOC_TYPES.URL:
      return 0.98;
    case IOC_TYPES.SUBNET:
      return 0.97;
    case IOC_TYPES.IP:
      return 0.95;
    case IOC_TYPES.ASN:
      return 0.92;
    case IOC_TYPES.MD5:
    case IOC_TYPES.SHA1:
    case IOC_TYPES.SHA256:
      return 0.94;
    case IOC_TYPES.DOMAIN:
      return DOMAIN_EXCLUSIONS.has(normalized) || DOMAIN_TLD_EXCLUSIONS.has(getDomainTld(normalized)) ? 0.2 : 0.88;
    default:
      return 0.75;
  }
}

export function parseIocsFromText(text, options = {}) {
  const results = [];
  if (!text) return results;
  const mode = resolveDetectionMode(options.mode);

  for (const match of text.matchAll(URL_CANDIDATE)) {
    const raw = match[0];
    const normalized = normalizeIoc(raw, IOC_TYPES.URL);
    pushUnique(results, { type: IOC_TYPES.URL, raw, normalized, index: match.index ?? 0, length: raw.length, confidence: scoreDetectionConfidence(IOC_TYPES.URL, normalized) });
  }

  for (const match of text.matchAll(SUBNET_CANDIDATE)) {
    const raw = match[0];
    if (!isValidSubnet(raw)) continue;
    const normalized = normalizeIoc(raw, IOC_TYPES.SUBNET);
    pushUnique(results, { type: IOC_TYPES.SUBNET, raw, normalized, index: match.index ?? 0, length: raw.length, confidence: scoreDetectionConfidence(IOC_TYPES.SUBNET, normalized) });
  }

  for (const match of text.matchAll(IPV4_CANDIDATE)) {
    const raw = match[0];
    if (!isValidIpv4(raw)) continue;
    const insideSubnet = results.some((entry) => entry.type === IOC_TYPES.SUBNET && (match.index ?? 0) >= entry.index && (match.index ?? 0) < entry.index + entry.length);
    if (insideSubnet) continue;
    const normalized = normalizeIoc(raw, IOC_TYPES.IP);
    pushUnique(results, { type: IOC_TYPES.IP, raw, normalized, index: match.index ?? 0, length: raw.length, confidence: scoreDetectionConfidence(IOC_TYPES.IP, normalized) });
  }

  for (const match of text.matchAll(ASN_CANDIDATE)) {
    const raw = match[0];
    const normalized = normalizeIoc(raw, IOC_TYPES.ASN);
    pushUnique(results, { type: IOC_TYPES.ASN, raw, normalized, index: match.index ?? 0, length: raw.length, confidence: scoreDetectionConfidence(IOC_TYPES.ASN, normalized) });
  }

  for (const match of text.matchAll(HASH_CANDIDATE)) {
    const raw = match[0];
    const type = detectHashType(raw);
    if (!type) continue;
    const normalized = normalizeIoc(raw, type);
    pushUnique(results, { type, raw, normalized, index: match.index ?? 0, length: raw.length, confidence: scoreDetectionConfidence(type, normalized) });
  }

  for (const match of text.matchAll(DOMAIN_CANDIDATE)) {
    const raw = match[0];
    const normalized = normalizeIoc(raw, IOC_TYPES.DOMAIN);
    const insideUrl = results.some((entry) => entry.type === IOC_TYPES.URL && (match.index ?? 0) >= entry.index && (match.index ?? 0) < entry.index + entry.length);
    if (insideUrl) continue;
    if (isLikelyExcludedDomain(normalized, text, match.index ?? 0, { mode })) continue;
    pushUnique(results, { type: IOC_TYPES.DOMAIN, raw, normalized, index: match.index ?? 0, length: raw.length, confidence: scoreDetectionConfidence(IOC_TYPES.DOMAIN, normalized) });
  }

  return results.sort((a, b) => a.index - b.index);
}

export function detectSingleIoc(text, options = {}) {
  const candidates = parseIocsFromText(text || '', options);
  return candidates[0] || null;
}

function scoreFromResult(result) {
  if (!result?.success) return 0;
  if (result.provider === 'AbuseIPDB') {
    return Math.max(0, Math.min(100, Number(result.meta?.abuseConfidenceScore || result.confidence || 0)));
  }
  if (result.provider === 'VirusTotal') {
    const malicious = Number(result.meta?.malicious || 0);
    return Math.max(0, Math.min(100, malicious >= 10 ? 100 : malicious * 10));
  }
  if (result.provider === 'Shodan') {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(result.confidence || 0)));
}

function buildRecommendation(overallVerdict, score, tags, successful) {
  const hasContextOnly = successful.length > 0 && successful.every((result) => result.provider === 'Shodan');
  if (overallVerdict === 'malicious') {
    return {
      level: 'high',
      title: 'Escalate and contain',
      summary: 'Multiple strong signals indicate this IOC is likely malicious. Treat it as actionable and pivot immediately.',
      action: 'Escalate, contain if relevant, and capture supporting evidence.'
    };
  }
  if (overallVerdict === 'suspicious') {
    return {
      level: 'medium',
      title: 'Investigate before trusting',
      summary: 'The IOC has meaningful risk signals, but still needs analyst validation and local context.',
      action: 'Correlate with telemetry and keep external pivots open before making a disposition.'
    };
  }
  if (score > 0 || tags.length || hasContextOnly) {
    return {
      level: 'low',
      title: 'Low-confidence signal',
      summary: hasContextOnly ? 'Only contextual data is available right now, without a clear reputation verdict.' : 'Weak or partial signals were found, but they do not justify a strong verdict yet.',
      action: 'Use this as supporting context and validate against your environment before escalating.'
    };
  }
  return {
    level: 'info',
    title: 'No decision yet',
    summary: 'No successful provider result is available, so the extension cannot recommend a disposition.',
    action: 'Configure providers or retry later to gather enough signal.'
  };
}


function threatHeadline(overallVerdict, successfulCount, score) {
  if (overallVerdict === 'malicious') return 'High-confidence malicious signal';
  if (overallVerdict === 'suspicious') return 'Suspicious signal requiring validation';
  if (overallVerdict === 'clean' && successfulCount > 0) return 'No strong malicious signal';
  if (score > 0) return 'Weak signal, insufficient for a verdict';
  return 'Insufficient provider signal';
}

function buildThreatEvidence(successful) {
  const evidence = [];
  for (const result of successful) {
    if (result.provider === 'VirusTotal') {
      const malicious = Number(result.meta?.malicious || 0);
      if (malicious > 0) evidence.push(`VirusTotal flagged ${malicious} engine${malicious > 1 ? 's' : ''}.`);
      continue;
    }
    if (result.provider === 'AbuseIPDB') {
      const confidence = Number(result.meta?.abuseConfidenceScore || 0);
      const reports = Number(result.meta?.totalReports || 0);
      if (confidence > 0) {
        evidence.push(`AbuseIPDB scored it ${confidence}/100${reports > 0 ? ` with ${reports} report${reports > 1 ? 's' : ''}` : ''}.`);
      }
      continue;
    }
    if (result.provider === 'Shodan') {
      const ports = Array.isArray(result.meta?.ports) ? result.meta.ports.filter(Boolean) : [];
      if (ports.length) evidence.push(`Shodan exposed ports ${ports.slice(0, 3).join(', ')}.`);
    }
  }
  return evidence.slice(0, 2);
}

export function buildThreatSummary(investigation = {}) {
  const providerResults = Array.isArray(investigation.providerResults) ? investigation.providerResults : [];
  const successful = providerResults.filter((result) => result?.success);
  const degraded = providerResults.length - successful.length;
  const score = Math.max(0, Math.min(100, Number(investigation.score || 0)));
  const overallVerdict = investigation.overallVerdict || 'unknown';
  const headline = threatHeadline(overallVerdict, successful.length, score);

  const sourceLine = successful.length
    ? `${successful.length}/${providerResults.length || successful.length} provider${successful.length > 1 ? 's' : ''} returned usable data${degraded > 0 ? `, ${degraded} degraded` : ''}.`
    : providerResults.length
      ? `No provider returned usable data out of ${providerResults.length}.`
      : 'No provider result is available yet.';

  const signals = buildThreatEvidence(successful);
  const narrativeParts = [sourceLine, ...signals].filter(Boolean);
  const narrative = narrativeParts.join(' ').trim();

  return {
    headline,
    narrative,
    evidence: signals
  };
}

export function summarizeProviderVerdict(results) {
  const successful = results.filter((r) => r?.success);
  const tags = [];
  const scoreFactors = [];
  if (!successful.length) {
    return {
      score: 0,
      overallVerdict: 'unknown',
      tags,
      scoreFactors,
      explanation: 'No provider returned a usable result.',
      recommendation: buildRecommendation('unknown', 0, tags, successful),
      threatSummary: buildThreatSummary({ overallVerdict: 'unknown', score: 0, providerResults: results, scoreFactors, recommendation: buildRecommendation('unknown', 0, tags, successful), explanation: 'No provider returned a usable result.' })
    };
  }

  for (const result of successful) {
    if (result.provider === 'Shodan') {
      const ports = Array.isArray(result.meta?.ports) ? result.meta.ports : [];
      if (ports.some((port) => [22, 3389, 445, 5900].includes(port))) {
        tags.push('sensitive-service');
        scoreFactors.push('Shodan exposed a sensitive service.');
      }
    }
    if (result.provider === 'AbuseIPDB') {
      const abuseScore = Number(result.meta?.abuseConfidenceScore || 0);
      if (abuseScore >= 90) {
        tags.push('abusive-ip');
        scoreFactors.push(`AbuseIPDB confidence is very high (${abuseScore}/100).`);
      } else if (abuseScore >= 40) {
        scoreFactors.push(`AbuseIPDB reports notable abuse confidence (${abuseScore}/100).`);
      }
      if (result.meta?.usageType) tags.push(String(result.meta.usageType).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    }
    if (result.provider === 'VirusTotal') {
      const malicious = Number(result.meta?.malicious || 0);
      if (malicious > 0) {
        tags.push('community-detection');
        scoreFactors.push(`VirusTotal reported ${malicious} malicious or suspicious engine detections.`);
      }
    }
  }

  const scores = successful.map(scoreFromResult);
  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const score = Math.round(successful.length === 1 ? maxScore : Math.max(maxScore, avgScore * 0.9));

  let overallVerdict = 'clean';
  if (score >= 80) overallVerdict = 'malicious';
  else if (score >= 40) overallVerdict = 'suspicious';
  else if (score > 0) overallVerdict = 'unknown';

  if (!scoreFactors.length && overallVerdict === 'clean') scoreFactors.push('Providers returned no strong malicious signal.');
  if (!scoreFactors.length && overallVerdict === 'unknown') scoreFactors.push('Signals are present, but they are too weak or incomplete for a firm verdict.');

  const uniqueTags = [...new Set(tags)];
  const explanation = scoreFactors.slice(0, 3).join(' ');
  const recommendation = buildRecommendation(overallVerdict, score, uniqueTags, successful);
  return {
    score: Math.min(score, 100),
    overallVerdict,
    tags: uniqueTags,
    scoreFactors,
    explanation,
    recommendation,
    threatSummary: buildThreatSummary({ overallVerdict, score, providerResults: results, scoreFactors, recommendation, explanation })
  };
}
