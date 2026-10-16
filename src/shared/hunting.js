import { IOC_TYPES, parseIocsFromText } from './ioc.js';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const TEMPLATES = {
  [IOC_TYPES.IP]: ['DeviceNetworkEvents', 'RemoteIP', '=='],
  [IOC_TYPES.DOMAIN]: ['DeviceNetworkEvents', 'RemoteUrl', '=~'],
  [IOC_TYPES.URL]: ['DeviceNetworkEvents', 'RemoteUrl', '=='],
  [IOC_TYPES.MD5]: ['DeviceFileEvents', 'MD5', '=~'],
  [IOC_TYPES.SHA1]: ['DeviceFileEvents', 'SHA1', '=~'],
  [IOC_TYPES.SHA256]: ['DeviceFileEvents', 'SHA256', '=~']
};

export function kqlStringLiteral(value) {
  if (CONTROL_CHARACTERS.test(value)) throw new Error('Control characters are not allowed.');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function generateDefenderQuery(input) {
  const invalid = (reason) => ({ query: null, reason });
  if (typeof input !== 'string' || CONTROL_CHARACTERS.test(input)) {
    return invalid('Control characters are not allowed.');
  }
  const value = input.trim();
  if (!value) return invalid('Enter one IPv4, domain, HTTP(S) URL or file hash.');
  // Match the whole input, not the first candidate. A URL may contain nested
  // IP/hash candidates; its full-span match is the single intended indicator.
  const ioc = parseIocsFromText(value).find((entry) => entry.index === 0 && entry.length === value.length);
  const template = ioc && TEMPLATES[ioc.type];
  if (!template) return invalid('Use exactly one IPv4, domain, HTTP(S) URL or MD5/SHA1/SHA256 hash, without surrounding text.');
  if (ioc.type === IOC_TYPES.URL) {
    try {
      const url = new URL(ioc.normalized);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('Invalid URL');
    } catch {
      return invalid('Enter a valid HTTP(S) URL.');
    }
  }
  const [table, column, operator] = template;
  return {
    query: `// Microsoft Defender XDR Advanced Hunting — requires Defender for Endpoint telemetry\n${table}\n| where Timestamp >= ago(7d)\n| where ${column} ${operator} ${kqlStringLiteral(ioc.normalized)}`,
    reason: ''
  };
}
