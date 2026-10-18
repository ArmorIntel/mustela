import { IOC_TYPES, normalizeIoc, parseIocsFromText } from './ioc.js';

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

export function normalizeExclusionRules(rules) {
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

// Pure decision helper for future guards. No traffic, settings, UI or outputs
// are wired here. Accept normalized rules from validation/the storage reader.
export function isExcluded(rules, { pageUrl, ioc } = {}) {
  const iocValue = ioc ? normalizeIoc(ioc.normalized ?? ioc.raw, ioc.type) : '';
  const hosts = [urlHost(pageUrl)];
  if (ioc?.type === IOC_TYPES.DOMAIN) hosts.push(iocValue);
  if (ioc?.type === IOC_TYPES.URL) hosts.push(urlHost(iocValue));
  return rules.some((rule) => {
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
