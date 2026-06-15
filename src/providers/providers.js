import { IOC_TYPES } from '../shared/ioc.js';

const PROVIDER_FETCH_TIMEOUT_MS = 12000;
const MISP_SUPPORTED_TYPES = [IOC_TYPES.IP, IOC_TYPES.DOMAIN, IOC_TYPES.URL, IOC_TYPES.MD5, IOC_TYPES.SHA1, IOC_TYPES.SHA256];

function providerHttpError(provider, status, context = 'lookup') {
  const err = new Error(`${provider} HTTP ${status}`);
  err.provider = provider;
  err.status = status;
  err.context = context;
  return err;
}

function readApiKey(configOrKey) {
  return typeof configOrKey === 'string'
    ? configOrKey
    : String(configOrKey?.apiKey || '').trim();
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/g, '');
}

function buildVirusTotalUrl(ioc) {
  return `https://www.virustotal.com/gui/search/${encodeURIComponent(ioc.normalized)}`;
}

function buildAbuseIpDbUrl(ioc) {
  if (ioc.type === IOC_TYPES.SUBNET) {
    return `https://www.abuseipdb.com/check-block/${encodeURIComponent(ioc.normalized)}`;
  }
  return `https://www.abuseipdb.com/check/${encodeURIComponent(ioc.normalized)}`;
}

function buildShodanUrl(ioc) {
  if (ioc.type === IOC_TYPES.ASN) {
    return `https://www.shodan.io/search?query=${encodeURIComponent(ioc.normalized)}`;
  }
  return `https://www.shodan.io/host/${encodeURIComponent(ioc.normalized)}`;
}

function buildMispUrl(ioc, config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) return '';
  return `${baseUrl}/attributes/search`;
}

function providerFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_FETCH_TIMEOUT_MS);
  return fetch(url, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

function mispHeaders(config = {}) {
  return {
    Authorization: readApiKey(config),
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

function getMispLookupTypes(ioc) {
  switch (ioc?.type) {
    case IOC_TYPES.IP:
      return ['ip-src', 'ip-dst'];
    case IOC_TYPES.DOMAIN:
      return ['domain', 'hostname'];
    case IOC_TYPES.URL:
      return ['url', 'uri'];
    case IOC_TYPES.MD5:
      return ['md5'];
    case IOC_TYPES.SHA1:
      return ['sha1'];
    case IOC_TYPES.SHA256:
      return ['sha256'];
    default:
      return [];
  }
}

function getMispAttributeTemplate(ioc) {
  switch (ioc?.type) {
    case IOC_TYPES.IP:
      return { type: 'ip-dst', category: 'Network activity' };
    case IOC_TYPES.DOMAIN:
      return { type: 'domain', category: 'Network activity' };
    case IOC_TYPES.URL:
      return { type: 'url', category: 'Network activity' };
    case IOC_TYPES.MD5:
      return { type: 'md5', category: 'Payload delivery' };
    case IOC_TYPES.SHA1:
      return { type: 'sha1', category: 'Payload delivery' };
    case IOC_TYPES.SHA256:
      return { type: 'sha256', category: 'Payload delivery' };
    default:
      return null;
  }
}

function extractMispAttributes(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => extractMispAttributes(item));
  }
  if (Array.isArray(payload.Attribute)) return payload.Attribute;
  if (Array.isArray(payload.attributes)) return payload.attributes;
  if (payload.Event) return extractMispAttributes(payload.Event);
  if (Array.isArray(payload.response)) return extractMispAttributes(payload.response);
  if (payload.response) return extractMispAttributes(payload.response);
  if (payload.id && payload.value && payload.type) return [payload];
  return [];
}

function extractMispAddedAttribute(payload) {
  if (!payload) return null;
  if (payload.Attribute && !Array.isArray(payload.Attribute)) return payload.Attribute;
  if (payload.response) return extractMispAddedAttribute(payload.response);
  if (payload.id && payload.value && payload.type) return payload;
  return null;
}

async function vtLookup(ioc, configOrKey) {
  const headers = { 'x-apikey': readApiKey(configOrKey) };
  let url;
  if (ioc.type === IOC_TYPES.IP) url = `https://www.virustotal.com/api/v3/ip_addresses/${encodeURIComponent(ioc.normalized)}`;
  else if (ioc.type === IOC_TYPES.DOMAIN) url = `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(ioc.normalized)}`;
  else if (ioc.type === IOC_TYPES.URL) url = `https://www.virustotal.com/api/v3/urls/${btoa(ioc.normalized).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
  else url = `https://www.virustotal.com/api/v3/files/${encodeURIComponent(ioc.normalized)}`;
  const response = await providerFetch(url, { headers });
  if (!response.ok) throw providerHttpError('VirusTotal', response.status, 'lookup');
  const json = await response.json();
  const stats = json.data?.attributes?.last_analysis_stats || {};
  const malicious = Number(stats.malicious || 0) + Number(stats.suspicious || 0);
  return {
    provider: 'VirusTotal',
    success: true,
    verdict: malicious > 0 ? 'suspicious' : 'unknown',
    confidence: Math.min(malicious * 10, 100),
    summary: `Detections: malicious=${stats.malicious || 0}, suspicious=${stats.suspicious || 0}`,
    externalUrl: buildVirusTotalUrl(ioc),
    meta: { malicious, stats }
  };
}

async function abuseLookup(ioc, configOrKey) {
  const apiKey = readApiKey(configOrKey);
  let url;
  if (ioc.type === IOC_TYPES.SUBNET) {
    url = `https://api.abuseipdb.com/api/v2/check-block?network=${encodeURIComponent(ioc.normalized)}&maxAgeInDays=90`;
  } else {
    url = `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ioc.normalized)}&maxAgeInDays=90&verbose=true`;
  }
  const response = await providerFetch(url, { headers: { Key: apiKey, Accept: 'application/json' } });
  if (!response.ok) throw providerHttpError('AbuseIPDB', response.status, 'lookup');
  const json = await response.json();
  const data = json.data || {};

  if (ioc.type === IOC_TYPES.SUBNET) {
    const confidence = Number(data.abuseConfidenceScore || 0);
    return {
      provider: 'AbuseIPDB',
      success: true,
      verdict: confidence >= 75 ? 'malicious' : 'unknown',
      confidence,
      summary: `Network ${data.networkAddress || ioc.normalized} | score ${confidence} | reports ${data.numReports || data.totalReports || 0}`,
      externalUrl: buildAbuseIpDbUrl(ioc),
      meta: {
        abuseConfidenceScore: confidence,
        totalReports: data.numReports || data.totalReports || 0,
        networkAddress: data.networkAddress || ioc.normalized,
        usageType: data.usageType,
        isp: data.isp
      }
    };
  }

  const confidence = Number(data.abuseConfidenceScore || 0);
  const contextBits = [
    data.usageType ? `usage ${data.usageType}` : null,
    data.isp ? `ISP ${data.isp}` : null,
    data.domain ? `domain ${data.domain}` : null,
    Array.isArray(data.hostnames) && data.hostnames.length ? `hostnames ${data.hostnames.slice(0, 2).join(', ')}` : null
  ].filter(Boolean);

  return {
    provider: 'AbuseIPDB',
    success: true,
    verdict: confidence >= 75 ? 'malicious' : 'unknown',
    confidence,
    summary: `Abuse confidence ${confidence}, reports ${data.totalReports || 0}${contextBits.length ? ' | ' + contextBits.join(' | ') : ''}`,
    externalUrl: buildAbuseIpDbUrl(ioc),
    meta: {
      abuseConfidenceScore: confidence,
      totalReports: data.totalReports || 0,
      usageType: data.usageType,
      isp: data.isp,
      domain: data.domain,
      hostnames: data.hostnames || [],
      countryCode: data.countryCode,
      isTor: data.isTor,
      lastReportedAt: data.lastReportedAt
    }
  };
}

async function shodanLookup(ioc, configOrKey) {
  const apiKey = readApiKey(configOrKey);
  const url = ioc.type === IOC_TYPES.ASN
    ? `https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(ioc.normalized)}`
    : `https://api.shodan.io/shodan/host/${encodeURIComponent(ioc.normalized)}?key=${encodeURIComponent(apiKey)}`;
  const response = await providerFetch(url);
  if (!response.ok) throw providerHttpError('Shodan', response.status, 'lookup');
  const json = await response.json();
  if (ioc.type === IOC_TYPES.ASN) {
    return {
      provider: 'Shodan',
      success: true,
      verdict: Number(json.total || 0) > 0 ? 'unknown' : 'clean',
      confidence: undefined,
      summary: `Matches for ${ioc.normalized}: ${json.total || 0}`,
      externalUrl: buildShodanUrl(ioc),
      meta: { total: json.total || 0 }
    };
  }
  const ports = Array.isArray(json.ports) ? json.ports : [];
  return {
    provider: 'Shodan',
    success: true,
    verdict: ports.length ? 'unknown' : 'clean',
    confidence: undefined,
    summary: `Ports: ${ports.slice(0, 10).join(', ') || 'none'} | Org: ${json.org || 'n/a'} | ASN: ${json.asn || 'n/a'}`,
    externalUrl: buildShodanUrl(ioc),
    meta: { ports, org: json.org, asn: json.asn }
  };
}

async function mispLookup(ioc, config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) throw new Error('MISP base URL not configured');

  const lookupTypes = getMispLookupTypes(ioc);
  const payload = {
    returnFormat: 'json',
    value: ioc.normalized,
    page: 1,
    limit: 10
  };
  if (lookupTypes.length === 1) payload.type = lookupTypes[0];
  else if (lookupTypes.length > 1) payload.type = lookupTypes;

  const response = await providerFetch(`${baseUrl}/attributes/restSearch`, {
    method: 'POST',
    headers: mispHeaders(config),
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw providerHttpError('MISP', response.status, 'lookup');

  const json = await response.json();
  const attributes = extractMispAttributes(json);
  const matches = attributes.length;
  const eventIds = [...new Set(attributes.map((item) => String(item?.event_id || item?.Event?.id || '')).filter(Boolean))];
  const toIdsHits = attributes.filter((item) => item?.to_ids === true || String(item?.to_ids || '') === '1').length;
  const first = attributes[0] || null;
  const confidence = matches
    ? Math.min(85, 35 + Math.min(matches, 4) * 8 + (toIdsHits > 0 ? 18 : 0))
    : 0;

  return {
    provider: 'MISP',
    success: true,
    verdict: matches > 0 ? 'suspicious' : 'clean',
    confidence,
    summary: matches > 0
      ? `Matches ${matches} attribute${matches > 1 ? 's' : ''} across ${eventIds.length || 1} event${eventIds.length === 1 ? '' : 's'}${toIdsHits > 0 ? ` | ${toIdsHits} marked for IDS` : ''}`
      : 'No matching attribute found in MISP.',
    externalUrl: first?.id
      ? `${baseUrl}/attributes/view/${encodeURIComponent(first.id)}`
      : buildMispUrl(ioc, config),
    meta: {
      matches,
      eventCount: eventIds.length,
      toIdsHits,
      attributeId: String(first?.id || ''),
      attributeIds: attributes.map((item) => String(item?.id || '')).filter(Boolean).slice(0, 10),
      eventIds,
      category: first?.category || '',
      type: first?.type || '',
      value: first?.value || ioc.normalized,
      baseUrl
    }
  };
}

export async function addIocToMisp(ioc, config = {}, options = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const eventId = String(options.eventId || config.defaultEventId || '').trim();
  if (!baseUrl) throw new Error('MISP base URL not configured');
  if (!eventId) throw new Error('MISP default event ID not configured');

  const template = getMispAttributeTemplate(ioc);
  if (!template) throw new Error('This IOC type is not supported for MISP add');

  const body = {
    value: ioc.normalized,
    type: template.type,
    category: template.category,
    to_ids: options.toIds !== false,
    comment: String(options.comment || '').trim()
  };

  const response = await providerFetch(`${baseUrl}/attributes/add/${encodeURIComponent(eventId)}`, {
    method: 'POST',
    headers: mispHeaders(config),
    body: JSON.stringify(body)
  });
  if (!response.ok) throw providerHttpError('MISP', response.status, 'add');

  const json = await response.json();
  const attribute = extractMispAddedAttribute(json) || {};
  const attributeId = String(attribute.id || '');
  return {
    ok: true,
    eventId,
    attributeId,
    attributeUrl: attributeId
      ? `${baseUrl}/attributes/view/${encodeURIComponent(attributeId)}`
      : `${baseUrl}/events/view/${encodeURIComponent(eventId)}`,
    summary: `IOC added to MISP event ${eventId} as ${template.type}.`
  };
}

async function vtValidate(configOrKey) {
  const response = await providerFetch('https://www.virustotal.com/api/v3/users/current', { headers: { 'x-apikey': readApiKey(configOrKey) } });
  if (response.ok) return { ok: true, message: 'API key valid', limited: false };
  if (response.status === 401 || response.status === 403) return { ok: false, message: 'Invalid API key', limited: false };
  if (response.status === 429) return { ok: false, message: 'Rate limit reached', limited: true };
  return { ok: false, message: `Validation failed (${response.status})`, limited: false };
}

async function abuseValidate(configOrKey) {
  const apiKey = readApiKey(configOrKey);
  const response = await providerFetch('https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8&maxAgeInDays=30', {
    headers: { Key: apiKey, Accept: 'application/json' }
  });
  if (response.ok) return { ok: true, message: 'API key valid', limited: false };
  if (response.status === 401 || response.status === 403) return { ok: false, message: 'Invalid API key', limited: false };
  if (response.status === 429) return { ok: false, message: 'Rate limit reached', limited: true };
  return { ok: false, message: `Validation failed (${response.status})`, limited: false };
}

async function shodanValidate(configOrKey) {
  const apiKey = readApiKey(configOrKey);
  const info = await providerFetch(`https://api.shodan.io/api-info?key=${encodeURIComponent(apiKey)}`);
  if (info.status === 401 || info.status === 403) return { ok: false, message: 'Invalid API key', limited: false };
  if (!info.ok) return { ok: false, message: `Validation failed (${info.status})`, limited: false };
  const hostProbe = await providerFetch(`https://api.shodan.io/shodan/host/8.8.8.8?key=${encodeURIComponent(apiKey)}`);
  if (hostProbe.ok) return { ok: true, message: 'API key valid', limited: false };
  if (hostProbe.status === 401 || hostProbe.status === 403) return { ok: true, message: 'API key valid, but host lookup access is limited', limited: true };
  if (hostProbe.status === 429) return { ok: true, message: 'API key valid, but lookup is currently rate limited', limited: true };
  return { ok: true, message: 'API key valid', limited: false };
}

async function mispValidate(config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) return { ok: false, message: 'Missing MISP base URL', limited: false };
  if (!readApiKey(config)) return { ok: false, message: 'Missing API key', limited: false };

  const response = await providerFetch(`${baseUrl}/servers/getVersion`, {
    headers: {
      Authorization: readApiKey(config),
      Accept: 'application/json'
    }
  });
  if (response.ok) return { ok: true, message: 'MISP connection valid', limited: false };
  if (response.status === 401 || response.status === 403) return { ok: false, message: 'Invalid API key or insufficient access', limited: false };
  return { ok: false, message: `Validation failed (${response.status})`, limited: false };
}

export function getProviderById(providerId) {
  const key = String(providerId || '').trim().toLowerCase();
  return key ? PROVIDERS[key] || null : null;
}

export function isProviderSupportedForIoc(providerId, ioc) {
  const provider = getProviderById(providerId);
  return !!(provider && ioc?.type && provider.supportedTypes.includes(ioc.type));
}

export function getSupportedExternalProviders(ioc) {
  return Object.values(PROVIDERS)
    .filter((provider) => provider.external !== false && isProviderSupportedForIoc(provider.id, ioc))
    .map((provider) => provider.id);
}

export const PROVIDERS = {
  virustotal: {
    id: 'virustotal',
    name: 'VirusTotal',
    supportedTypes: [IOC_TYPES.IP, IOC_TYPES.DOMAIN, IOC_TYPES.URL, IOC_TYPES.MD5, IOC_TYPES.SHA1, IOC_TYPES.SHA256],
    buildExternalUrl: buildVirusTotalUrl,
    lookup: vtLookup,
    validateApiKey: vtValidate
  },
  abuseipdb: {
    id: 'abuseipdb',
    name: 'AbuseIPDB',
    supportedTypes: [IOC_TYPES.IP, IOC_TYPES.SUBNET],
    buildExternalUrl: buildAbuseIpDbUrl,
    lookup: abuseLookup,
    validateApiKey: abuseValidate
  },
  shodan: {
    id: 'shodan',
    name: 'Shodan',
    supportedTypes: [IOC_TYPES.IP, IOC_TYPES.ASN],
    buildExternalUrl: buildShodanUrl,
    lookup: shodanLookup,
    validateApiKey: shodanValidate
  },
  misp: {
    id: 'misp',
    name: 'MISP',
    external: false,
    supportedTypes: MISP_SUPPORTED_TYPES,
    buildExternalUrl: buildMispUrl,
    lookup: mispLookup,
    validateApiKey: mispValidate,
    addAttribute: addIocToMisp,
    isConfigured(config = {}) {
      return !!(readApiKey(config) && normalizeBaseUrl(config.baseUrl));
    }
  }
};
