// AUTO-GENERATED from src/shared/ioc.js and src/shared/exclusions.js
// Do not edit directly. Run: node scripts/generate-content-ioc-runtime.mjs

(() => {
  if (globalThis.MUSTELA_SHARED) return;

const IOC_TYPES = {
  EMAIL: 'email',
  IP: 'ip',
  DOMAIN: 'domain',
  URL: 'url',
  MD5: 'md5',
  SHA1: 'sha1',
  SHA256: 'sha256',
  SUBNET: 'subnet',
  ASN: 'asn'
};

const IPV4_CANDIDATE = /\b(?:\d{1,3}(?:\.|\[\.\]|\(\.\))){3}\d{1,3}\b/g;
const SUBNET_CANDIDATE = /\b(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[12][0-9]|3[0-2])\b/g;
const ASN_CANDIDATE = /\bAS(?:[1-9]\d{0,9})\b/gi;
const URL_CANDIDATE = /\b(?:https?|hxxps?)(?::|\[:\])\/\/[^\s<>'"`]+/gi;
const HASH_CANDIDATE = /\b[a-fA-F0-9]{32}\b|\b[a-fA-F0-9]{40}\b|\b[a-fA-F0-9]{64}\b/g;
const DOMAIN_LABEL_CANDIDATE = /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.|\[\.\]|\(\.\))/g;

const DOMAIN_EXCLUSIONS = new Set(['microsoft.com', 'example.com', 'localhost']);
const DOMAIN_TLD_EXCLUSIONS = new Set(['local', 'internal', 'exe', 'dll', 'bin', 'tmp', 'log', 'conf', 'ps1', 'bat', 'sh', 'js']);
const DETECTION_MODES = new Set(['balanced', 'strict']);
const STRICT_DOMAIN_EXCLUSIONS = new Set(['google.com', 'apple.com', 'amazon.com']);

function isValidIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

// Validate the whole literal before canonicalizing; no URL/DNS parser or network.
function canonicalIpv6(value) {
  if (value.length > 45 || !/^[0-9a-f:.]+$/i.test(value) || !value.includes(':')) return null;
  let address = value.toLowerCase();
  if (address.includes('.')) {
    const tail = address.slice(address.lastIndexOf(':') + 1);
    if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(tail) || !isValidIpv4(tail)) return null;
    const [a, b, c, d] = tail.split('.').map(Number);
    address = `${address.slice(0, address.lastIndexOf(':') + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const count = left.length + right.length;
  if (halves.length === 1 ? count !== 8 : count >= 8) return null;
  if (![...left, ...right].every((part) => /^[0-9a-f]{1,4}$/.test(part))) return null;
  const groups = [...left, ...Array(8 - count).fill('0'), ...right].map((part) => Number.parseInt(part, 16).toString(16));
  let bestStart = -1;
  let bestLength = 1; // Never compress a single zero; retain the first tied run.
  for (let start = 0; start < groups.length;) {
    if (groups[start] !== '0') { start += 1; continue; }
    let end = start;
    while (end < groups.length && groups[end] === '0') end += 1;
    if (end - start > bestLength) { bestStart = start; bestLength = end - start; }
    start = end;
  }
  if (bestStart < 0) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLength).join(':')}`;
}

// Deliberately limited to these literal IPv4 ranges, not DNS, URLs or CIDRs.
function classifyIpv4(value) {
  if (typeof value !== 'string' || !isValidIpv4(value)) return null;
  const [a, b, c] = value.split('.').map(Number);
  const protectedRange = a === 10 || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127)
    || (a >= 224 && a <= 239)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
  return protectedRange ? 'internal-reserved' : 'public';
}

function isProtectedIoc(ioc) {
  return ioc?.type === IOC_TYPES.IP && classifyIpv4(ioc.normalized) === 'internal-reserved';
}

const PUBLIC_LOOKUP_BLOCK_REASON = 'Public lookups blocked for internal/reserved IPv4';
const PROTECTED_IPV4_EXPLANATION = `${PUBLIC_LOOKUP_BLOCK_REASON}. Analyst Assist summaries and correlation are also blocked, even with a local endpoint. Configured MISP lookups and explicit Add to MISP remain available: the IOC leaves the browser for MISP. Blocking is not a clean verdict.`;

function isValidSubnet(value) {
  const [ip, prefix] = String(value).split('/');
  if (!isValidIpv4(ip)) return false;
  const p = Number(prefix);
  return Number.isInteger(p) && p >= 0 && p <= 32;
}

function refangDots(value) {
  return value.replace(/\[\.\]|\(\.\)/g, '.');
}

function trimUrlPunctuation(value) {
  let trimmed = value.replace(/[,.;]+$/g, '');
  while (trimmed.endsWith(')') && (trimmed.match(/\)/g) || []).length > (trimmed.match(/\(/g) || []).length) {
    trimmed = trimmed.slice(0, -1).replace(/[,.;]+$/g, '');
  }
  return trimmed;
}

function normalizeIoc(raw, type) {
  const value = String(raw || '').trim();
  switch (type) {
    case IOC_TYPES.EMAIL: {
      const at = value.lastIndexOf('@');
      return at < 0 ? value : value.slice(0, at + 1) + value.slice(at + 1).toLowerCase();
    }
    case IOC_TYPES.URL:
      // Refang only the scheme and authority, never path/query/fragment text.
      return trimUrlPunctuation(value).replace(/^(https?|hxxps?)(?::|\[:\])\/\/((?:[^/?#@]*@)?)([^/?#:]+)(:\d+)?/i,
        (_, scheme, userInfo, host, port = '') => `${scheme.toLowerCase().replace('xx', 'tt')}://${userInfo}${refangDots(host)}${port}`);
    case IOC_TYPES.DOMAIN:
      return refangDots(value).toLowerCase().replace(/^\.+|\.+$/g, '');
    case IOC_TYPES.IP:
      return canonicalIpv6(value) ?? refangDots(value);
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

function detectHashType(value) {
  const length = value.length;
  if (length === 32) return IOC_TYPES.MD5;
  if (length === 40) return IOC_TYPES.SHA1;
  if (length === 64) return IOC_TYPES.SHA256;
  return null;
}

function* domainCandidates(text) {
  // Find bounded labels once, retaining the last valid TLD in each contiguous
  // chain. This is the same leftmost/greedy match as (LABEL DOT)+ TLD, without
  // retrying every suffix when thousands of labels have no valid TLD.
  // Invalid labels split chains, so a valid domain after one is still found.
  const tld = /[a-zA-Z]{2,63}\b/y;
  let start = -1;
  let chainEnd = -1;
  let matchEnd = -1;
  for (const label of text.matchAll(DOMAIN_LABEL_CANDIDATE)) {
    if (label.index !== chainEnd) {
      if (matchEnd >= 0) yield Object.assign([text.slice(start, matchEnd)], { index: start });
      start = label.index;
      matchEnd = -1;
    }
    chainEnd = label.index + label[0].length;
    tld.lastIndex = chainEnd;
    const suffix = tld.exec(text);
    if (suffix) matchEnd = chainEnd + suffix[0].length;
  }
  if (matchEnd >= 0) yield Object.assign([text.slice(start, matchEnd)], { index: start });
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
  const tld = getDomainTld(normalized);
  if (DOMAIN_TLD_EXCLUSIONS.has(tld)) return true;
  // "word.longword" where "longword" exceeds realistic TLD length is likely a name or identifier, not a domain.
  // Real ASCII TLDs top out around 11 chars (e.g. "international" is 13 but nearly never seen as a 2-label IOC).
  if (tld.length > 11 && normalized.split('.').length <= 2) return true;
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

function parseIocsFromText(text, options = {}) {
  const results = [];
  if (!text) return results;
  const mode = resolveDetectionMode(options.mode);
  // Byte occupancy preserves source-range precedence without pairwise scans.
  const occupied = new Uint8Array(text.length);
  const colonOccupied = new Uint8Array(text.length);
  const emailOccupied = new Uint8Array(text.length);
  const overlaps = (table, index, length) => {
    for (let i = index; i < index + length; i++) if (table[i]) return true;
    return false;
  };
  const pushUnique = (target, item) => {
    if (overlaps(occupied, item.index, item.length)) return;
    occupied.fill(1, item.index, item.index + item.length);
    target.push(item);
  };

  // Reserve whole address-like tokens, including invalid or unsupported ones.
  // Never promote their local identifiers or domain suffixes independently.
  // Consume escaped characters together so an escaped quote cannot end the
  // unsupported quoted local part and expose nested provider-compatible IOCs.
  const emailTokens = [...text.matchAll(/"(?:\\[^\r\n]|[^"\\\r\n])*"@[^\s<>,;:]*|(?:\(\.\)|[^\s<>(),;:])+/g)]
    .filter(([raw]) => raw.includes('@'));
  for (const token of emailTokens) emailOccupied.fill(1, token.index, token.index + token[0].length);
  const emails = [];
  for (const token of emailTokens) {
    const raw = token[0].replace(/\.+$/, '');
    const parts = raw.split('@');
    const [local, domain = ''] = parts;
    const atom = /^[a-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[a-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/i;
    const labels = domain.split('.');
    if (parts.length !== 2 || !atom.test(local) || local.length > 64 || domain.length > 253
      || labels.length < 2 || !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) continue;
    emails.push({ type: IOC_TYPES.EMAIL, raw, normalized: normalizeIoc(raw, IOC_TYPES.EMAIL), index: token.index, length: raw.length, confidence: 0.95 });
  }

  for (const match of text.matchAll(URL_CANDIDATE)) {
    const raw = trimUrlPunctuation(match[0]);
    const normalized = normalizeIoc(raw, IOC_TYPES.URL);
    pushUnique(results, { type: IOC_TYPES.URL, raw, normalized, index: match.index ?? 0, length: raw.length, confidence: scoreDetectionConfidence(IOC_TYPES.URL, normalized) });
  }

  for (const email of emails) pushUnique(results, email);

  // Consume maximal colon-bearing tokens, including invalid/unsupported forms.
  // Reserving their ranges prevents accepting a suffix or a nested IPv4/CIDR.
  // Log labels/ports are not IPv6 prefixes. For dotted tokens, reserve only
  // compressed forms or a hexadecimal group prefix before the first IPv4 octet.
  const colonTokens = [...text.matchAll(/[a-z0-9_.:%/\-]+/gi)].filter(([raw]) => {
    if (raw.indexOf(':') === raw.lastIndexOf(':')) return false;
    if (!raw.includes('.') || raw.includes('::')) return true;
    const prefix = raw.slice(0, raw.lastIndexOf(':', raw.indexOf('.')) + 1);
    return /^[0-9a-f:]+:$/i.test(prefix);
  });
  for (const token of colonTokens) colonOccupied.fill(1, token.index, token.index + token[0].length);
  const insideColonToken = (match) => !!colonOccupied[match.index];
  for (const token of colonTokens) {
    const raw = token[0].replace(/\.+$/, '');
    const normalized = canonicalIpv6(raw);
    const before = text.slice(Math.max(0, token.index - 3), token.index);
    const end = token.index + token[0].length;
    const after = text.slice(end, end + 3);
    if (!normalized || /^\][/%]/.test(after)
      || /(?:\[:\]|\[\.\]|\(\.\))$/.test(before)
      || /^(?:\[:\]|\[\.\]|\(\.\))/.test(after)) continue;
    pushUnique(results, { type: IOC_TYPES.IP, raw, normalized, index: token.index, length: raw.length, confidence: scoreDetectionConfidence(IOC_TYPES.IP, normalized) });
  }

  for (const match of text.matchAll(SUBNET_CANDIDATE)) {
    if (insideColonToken(match)) continue;
    const raw = match[0];
    if (!isValidSubnet(raw)) continue;
    const normalized = normalizeIoc(raw, IOC_TYPES.SUBNET);
    pushUnique(results, { type: IOC_TYPES.SUBNET, raw, normalized, index: match.index ?? 0, length: raw.length, confidence: scoreDetectionConfidence(IOC_TYPES.SUBNET, normalized) });
  }

  for (const match of text.matchAll(IPV4_CANDIDATE)) {
    if (insideColonToken(match)) continue;
    const raw = match[0];
    if (!isValidIpv4(normalizeIoc(raw, IOC_TYPES.IP))) continue;
    if (occupied[match.index]) continue;
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

  for (const match of domainCandidates(text)) {
    const raw = match[0];
    const normalized = normalizeIoc(raw, IOC_TYPES.DOMAIN);
    if (occupied[match.index]) continue;
    if (normalized.length > 253 || isLikelyExcludedDomain(raw, text, match.index ?? 0, { mode })) continue;
    pushUnique(results, { type: IOC_TYPES.DOMAIN, raw, normalized, index: match.index ?? 0, length: raw.length, confidence: scoreDetectionConfidence(IOC_TYPES.DOMAIN, normalized) });
  }

  return results.filter((ioc) => [IOC_TYPES.EMAIL, IOC_TYPES.URL].includes(ioc.type)
    || !overlaps(emailOccupied, ioc.index, ioc.length))
    .sort((a, b) => a.index - b.index);
}

function detectSingleIoc(text, options = {}) {
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
      continue;
    }
    if (result.provider === 'MISP') {
      const matches = Number(result.meta?.matches || 0);
      const toIdsHits = Number(result.meta?.toIdsHits || 0);
      if (matches > 0) {
        evidence.push(`MISP already knows ${matches} matching attribute${matches > 1 ? 's' : ''}${toIdsHits > 0 ? `, ${toIdsHits} marked for IDS` : ''}.`);
      }
    }
  }
  return evidence.slice(0, 2);
}

function buildThreatSummary(investigation = {}) {
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

function summarizeProviderVerdict(results) {
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
    if (result.provider === 'MISP') {
      const matches = Number(result.meta?.matches || 0);
      const toIdsHits = Number(result.meta?.toIdsHits || 0);
      if (matches > 0) {
        tags.push('known-in-misp');
        scoreFactors.push(`MISP already contains ${matches} matching attribute${matches > 1 ? 's' : ''}.`);
      }
      if (toIdsHits > 0) {
        tags.push('misp-to-ids');
        scoreFactors.push(`MISP marks ${toIdsHits} matching attribute${toIdsHits > 1 ? 's' : ''} for IDS correlation.`);
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


const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function validHost(value) {
  return value.length <= 253 && value.split('.').every((label) => HOST_LABEL.test(label));
}

function validHttpUrl(value) {
  if (!/^https?:\/\//i.test(value) || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname;
  } catch {
    return false;
  }
}

function validIoc(value, type) {
  // Explicit exclusions must not inherit the detector's noise filters (for
  // example example.com or internal host suffixes). Validate their full syntax.
  if (type === IOC_TYPES.DOMAIN) return value.includes('.') && validHost(value);
  if (type === IOC_TYPES.URL) return validHttpUrl(value);
  return Object.values(IOC_TYPES).includes(type) && parseIocsFromText(value).some((ioc) =>
    ioc.type === type && ioc.index === 0 && ioc.length === value.length);
}

function normalizeExclusionRules(rules) {
  if (!Array.isArray(rules)) throw new Error('Exclusion rules must be a list.');
  const normalized = rules.map((rule) => {
    const invalid = () => { throw new Error('Invalid exclusion rule.'); };
    if (!rule || typeof rule !== 'object' || typeof rule.value !== 'string'
      || !rule.value.trim() || CONTROL_CHARACTERS.test(rule.value)) return invalid();
    const keys = rule.kind === 'ioc' ? ['kind', 'iocType', 'value'] : ['kind', 'value'];
    if (Object.keys(rule).some((key) => !keys.includes(key))) return invalid();
    if (rule.kind === 'page-url') {
      // Do not canonicalize exact page URLs: the existing pause uses includes().
      if (!validHttpUrl(rule.value)) return invalid();
      return { kind: rule.kind, value: rule.value };
    }
    if (rule.kind === 'host') {
      const value = rule.value.trim().toLowerCase();
      const host = value.startsWith('*.') ? value.slice(2) : value;
      if (!validHost(host)) return invalid();
      return { kind: rule.kind, value };
    }
    if (rule.kind === 'ioc') {
      const value = normalizeIoc(rule.value, rule.iocType);
      if (!validIoc(value, rule.iocType)) return invalid();
      return { kind: rule.kind, iocType: rule.iocType, value };
    }
    return invalid();
  });
  return [...new Map(normalized.map((rule) => [JSON.stringify(rule), rule])).values()];
}

function urlHost(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

// Pure shared decision helper. Accept normalized rules from validation/storage.
function findExclusion(rules, { pageUrl, ioc } = {}) {
  const iocValue = ioc ? normalizeIoc(ioc.normalized ?? ioc.raw, ioc.type) : '';
  const hosts = [urlHost(pageUrl)];
  if (ioc?.type === IOC_TYPES.DOMAIN) hosts.push(iocValue);
  if (ioc?.type === IOC_TYPES.URL) hosts.push(urlHost(iocValue));
  return rules.find((rule) => {
    if (rule.kind === 'page-url') return typeof pageUrl === 'string' && pageUrl === rule.value;
    if (rule.kind === 'ioc') return ioc?.type === rule.iocType && iocValue === rule.value;
    if (rule.kind === 'host') {
      const wildcard = rule.value.startsWith('*.');
      const suffix = wildcard ? rule.value.slice(2) : rule.value;
      return hosts.some((host) => host && (wildcard ? host.endsWith(`.${suffix}`) : host === suffix));
    }
    return false;
  });
}

function isExcluded(rules, context) {
  return !!findExclusion(rules, context);
}

function exclusionReason(rule) {
  return `Excluded by ${rule.kind}${rule.iocType ? ` (${rule.iocType})` : ''} rule: ${rule.value}. Remove this rule explicitly in settings before retrying. Previously shared data is not withdrawn from recipients.`;
}


  globalThis.MUSTELA_SHARED = {
    IOC_TYPES,
    isExcluded,
    isValidIpv4,
    classifyIpv4,
    isProtectedIoc,
    PUBLIC_LOOKUP_BLOCK_REASON,
    PROTECTED_IPV4_EXPLANATION,
    isValidSubnet,
    normalizeIoc,
    detectHashType,
    parseIocsFromText,
    detectSingleIoc,
    buildThreatSummary,
    summarizeProviderVerdict
  };
})();
