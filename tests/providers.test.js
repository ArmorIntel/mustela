import test from 'node:test';
import assert from 'node:assert/strict';
import { getSupportedExternalProviders, isProviderSupportedForIoc, PROVIDERS } from '../src/providers/providers.js';
import { IOC_TYPES } from '../src/shared/ioc.js';

function withMockFetch(handler, run) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.fetch = originalFetch;
    });
}

test('provider external URLs keep IOC values encoded and aligned with supported pivots', () => {
  assert.equal(
    PROVIDERS.virustotal.buildExternalUrl({ type: IOC_TYPES.DOMAIN, normalized: 'evil.example/path?x=1' }),
    'https://www.virustotal.com/gui/search/evil.example%2Fpath%3Fx%3D1'
  );
  assert.equal(
    PROVIDERS.abuseipdb.buildExternalUrl({ type: IOC_TYPES.SUBNET, normalized: '10.0.0.0/24' }),
    'https://www.abuseipdb.com/check-block/10.0.0.0%2F24'
  );
  assert.equal(
    PROVIDERS.shodan.buildExternalUrl({ type: IOC_TYPES.ASN, normalized: 'AS13335' }),
    'https://www.shodan.io/search?query=AS13335'
  );
  assert.equal(isProviderSupportedForIoc('abuseipdb', { type: IOC_TYPES.SUBNET, normalized: '10.0.0.0/24' }), true);
  assert.equal(isProviderSupportedForIoc('shodan', { type: IOC_TYPES.ASN, normalized: 'AS13335' }), true);
  assert.equal(isProviderSupportedForIoc('virustotal', { type: IOC_TYPES.ASN, normalized: 'AS13335' }), false);
  assert.deepEqual(getSupportedExternalProviders({ type: IOC_TYPES.IP, normalized: '8.8.8.8' }), ['virustotal', 'abuseipdb', 'shodan']);
});

test('VirusTotal lookup uses hardened fetch options and strips raw payloads from returned result', async () => {
  await withMockFetch(async (url, options = {}) => {
    assert.equal(url, 'https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers['x-apikey'], 'vt-key');
    assert.ok(options.signal, 'expected AbortSignal on provider fetch');
    return {
      ok: true,
      json: async () => ({
        data: {
          attributes: {
            last_analysis_stats: {
              malicious: 2,
              suspicious: 1,
              harmless: 70
            }
          }
        }
      })
    };
  }, async () => {
    const result = await PROVIDERS.virustotal.lookup({ type: IOC_TYPES.IP, normalized: '8.8.8.8' }, 'vt-key');
    assert.equal(result.provider, 'VirusTotal');
    assert.equal(result.success, true);
    assert.equal(result.meta.malicious, 3);
    assert.equal(result.meta.stats.harmless, 70);
    assert.equal('raw' in result, false);
  });
});

test('AbuseIPDB subnet lookup uses hardened fetch options and compact analyst-facing metadata', async () => {
  await withMockFetch(async (url, options = {}) => {
    assert.match(url, /^https:\/\/api\.abuseipdb\.com\/api\/v2\/check-block\?network=10\.0\.0\.0%2F24&maxAgeInDays=90$/);
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers.Key, 'ab-key');
    assert.equal(options.headers.Accept, 'application/json');
    assert.ok(options.signal, 'expected AbortSignal on provider fetch');
    return {
      ok: true,
      json: async () => ({
        data: {
          networkAddress: '10.0.0.0/24',
          abuseConfidenceScore: 61,
          numReports: 4,
          usageType: 'ISP',
          isp: 'Example ISP'
        }
      })
    };
  }, async () => {
    const result = await PROVIDERS.abuseipdb.lookup({ type: IOC_TYPES.SUBNET, normalized: '10.0.0.0/24' }, 'ab-key');
    assert.equal(result.provider, 'AbuseIPDB');
    assert.equal(result.meta.networkAddress, '10.0.0.0/24');
    assert.equal(result.meta.totalReports, 4);
    assert.equal('raw' in result, false);
  });
});

test('Shodan validation reports limited access without leaking query data into the response shape', async () => {
  const calls = [];
  await withMockFetch(async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.referrerPolicy, 'no-referrer');
    if (String(url).includes('/api-info?')) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: false, status: 403, json: async () => ({}) };
  }, async () => {
    const result = await PROVIDERS.shodan.validateApiKey('sh-key');
    assert.equal(result.ok, true);
    assert.equal(result.limited, true);
    assert.match(result.message, /limited/i);
  });
  assert.equal(calls.length, 2);
});
