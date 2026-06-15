import test from 'node:test';
import assert from 'node:assert/strict';
import { addIocToMisp, getSupportedExternalProviders, isProviderSupportedForIoc, PROVIDERS } from '../src/providers/providers.js';
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

test('MISP lookup uses restSearch and returns compact event metadata', async () => {
  await withMockFetch(async (url, options = {}) => {
    assert.equal(url, 'https://misp.example.org/attributes/restSearch');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers.Authorization, 'misp-key');
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(options.body);
    assert.equal(body.value, 'evil.example');
    assert.deepEqual(body.type, ['domain', 'hostname']);
    return {
      ok: true,
      json: async () => ({
        response: {
          Attribute: [
            { id: 7, event_id: 42, value: 'evil.example', type: 'domain', category: 'Network activity', to_ids: true },
            { id: 8, event_id: 42, value: 'evil.example', type: 'hostname', category: 'Network activity', to_ids: false }
          ]
        }
      })
    };
  }, async () => {
    const result = await PROVIDERS.misp.lookup({ type: IOC_TYPES.DOMAIN, normalized: 'evil.example' }, {
      baseUrl: 'https://misp.example.org',
      apiKey: 'misp-key'
    });
    assert.equal(result.provider, 'MISP');
    assert.equal(result.success, true);
    assert.equal(result.meta.matches, 2);
    assert.equal(result.meta.eventCount, 1);
    assert.equal(result.meta.toIdsHits, 1);
    assert.equal(result.externalUrl, 'https://misp.example.org/attributes/view/7');
  });
});

test('MISP add posts a supported attribute into the configured event', async () => {
  await withMockFetch(async (url, options = {}) => {
    assert.equal(url, 'https://misp.example.org/attributes/add/1337');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'misp-key');
    const body = JSON.parse(options.body);
    assert.equal(body.value, '8.8.8.8');
    assert.equal(body.type, 'ip-dst');
    assert.equal(body.category, 'Network activity');
    assert.equal(body.to_ids, true);
    assert.match(body.comment, /Added from Mustela/);
    return {
      ok: true,
      json: async () => ({
        response: {
          Attribute: {
            id: 99,
            event_id: 1337,
            value: '8.8.8.8',
            type: 'ip-dst'
          }
        }
      })
    };
  }, async () => {
    const result = await addIocToMisp({ type: IOC_TYPES.IP, normalized: '8.8.8.8' }, {
      baseUrl: 'https://misp.example.org',
      apiKey: 'misp-key',
      defaultEventId: '1337'
    }, {
      comment: 'Added from Mustela'
    });
    assert.equal(result.ok, true);
    assert.equal(result.attributeId, '99');
    assert.equal(result.attributeUrl, 'https://misp.example.org/attributes/view/99');
  });
});

test('MISP add falls back to event URL when the response contains no attribute id', async () => {
  await withMockFetch(async () => ({
    ok: true,
    json: async () => ({ response: {} })
  }), async () => {
    const result = await addIocToMisp({ type: IOC_TYPES.SHA256, normalized: 'abc123' }, {
      baseUrl: 'https://misp.example.org',
      apiKey: 'misp-key',
      defaultEventId: '42'
    }, {});
    assert.equal(result.ok, true);
    assert.equal(result.attributeId, '');
    assert.equal(result.attributeUrl, 'https://misp.example.org/events/view/42');
  });
});

test('MISP add throws on HTTP error from the MISP server', async () => {
  await withMockFetch(async () => ({ ok: false, status: 403 }), async () => {
    await assert.rejects(
      () => addIocToMisp({ type: IOC_TYPES.IP, normalized: '1.2.3.4' }, {
        baseUrl: 'https://misp.example.org',
        apiKey: 'bad-key',
        defaultEventId: '1'
      }, {}),
      (err) => {
        assert.equal(err.provider, 'MISP');
        assert.equal(err.status, 403);
        assert.equal(err.context, 'add');
        return true;
      }
    );
  });
});

test('MISP add throws when eventId is missing from both options and config', async () => {
  await assert.rejects(
    () => addIocToMisp({ type: IOC_TYPES.DOMAIN, normalized: 'evil.example' }, {
      baseUrl: 'https://misp.example.org',
      apiKey: 'misp-key'
    }, {}),
    /event ID not configured/i
  );
});

test('MISP add throws when baseUrl is missing', async () => {
  await assert.rejects(
    () => addIocToMisp({ type: IOC_TYPES.IP, normalized: '1.2.3.4' }, { apiKey: 'key' }, { eventId: '1' }),
    /base URL not configured/i
  );
});

test('MISP add throws for IOC types that have no attribute template (ASN, subnet)', async () => {
  await assert.rejects(
    () => addIocToMisp({ type: IOC_TYPES.ASN, normalized: 'AS13335' }, {
      baseUrl: 'https://misp.example.org',
      apiKey: 'misp-key',
      defaultEventId: '1'
    }, {}),
    /not supported for MISP add/i
  );
});

test('MISP lookup returns clean verdict with zero confidence when no attributes are found', async () => {
  await withMockFetch(async () => ({
    ok: true,
    json: async () => ({ response: { Attribute: [] } })
  }), async () => {
    const result = await PROVIDERS.misp.lookup({ type: IOC_TYPES.IP, normalized: '1.2.3.4' }, {
      baseUrl: 'https://misp.example.org',
      apiKey: 'misp-key'
    });
    assert.equal(result.verdict, 'clean');
    assert.equal(result.confidence, 0);
    assert.equal(result.meta.matches, 0);
    assert.match(result.summary, /No matching attribute/i);
  });
});

test('MISP lookup for IP sends both ip-src and ip-dst types', async () => {
  let capturedBody;
  await withMockFetch(async (url, options = {}) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ response: { Attribute: [] } }) };
  }, async () => {
    await PROVIDERS.misp.lookup({ type: IOC_TYPES.IP, normalized: '8.8.8.8' }, {
      baseUrl: 'https://misp.example.org',
      apiKey: 'misp-key'
    });
    assert.deepEqual(capturedBody.type, ['ip-src', 'ip-dst']);
    assert.equal(capturedBody.value, '8.8.8.8');
  });
});

test('MISP lookup for SHA256 sends a single attribute type', async () => {
  let capturedBody;
  await withMockFetch(async (url, options = {}) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ response: { Attribute: [] } }) };
  }, async () => {
    await PROVIDERS.misp.lookup({ type: IOC_TYPES.SHA256, normalized: 'a'.repeat(64) }, {
      baseUrl: 'https://misp.example.org',
      apiKey: 'misp-key'
    });
    assert.equal(capturedBody.type, 'sha256');
  });
});

test('MISP lookup throws a structured error on HTTP failure', async () => {
  await withMockFetch(async () => ({ ok: false, status: 401 }), async () => {
    await assert.rejects(
      () => PROVIDERS.misp.lookup({ type: IOC_TYPES.DOMAIN, normalized: 'evil.example' }, {
        baseUrl: 'https://misp.example.org',
        apiKey: 'bad-key'
      }),
      (err) => {
        assert.equal(err.provider, 'MISP');
        assert.equal(err.status, 401);
        return true;
      }
    );
  });
});

test('MISP validate returns ok when the server version endpoint is reachable', async () => {
  await withMockFetch(async (url, options = {}) => {
    assert.match(url, /\/servers\/getVersion$/);
    assert.equal(options.headers.Authorization, 'misp-key');
    return { ok: true, status: 200, json: async () => ({ version: '2.4.170' }) };
  }, async () => {
    const result = await PROVIDERS.misp.validateApiKey({ baseUrl: 'https://misp.example.org', apiKey: 'misp-key' });
    assert.equal(result.ok, true);
    assert.match(result.message, /valid/i);
  });
});

test('MISP validate reports invalid key on 401', async () => {
  await withMockFetch(async () => ({ ok: false, status: 401 }), async () => {
    const result = await PROVIDERS.misp.validateApiKey({ baseUrl: 'https://misp.example.org', apiKey: 'bad' });
    assert.equal(result.ok, false);
    assert.match(result.message, /Invalid API key/i);
  });
});

test('MISP validate fails fast when baseUrl is missing', async () => {
  const result = await PROVIDERS.misp.validateApiKey({ apiKey: 'misp-key' });
  assert.equal(result.ok, false);
  assert.match(result.message, /base URL/i);
});

test('MISP validate fails fast when apiKey is missing', async () => {
  const result = await PROVIDERS.misp.validateApiKey({ baseUrl: 'https://misp.example.org' });
  assert.equal(result.ok, false);
  assert.match(result.message, /API key/i);
});

test('MISP isConfigured returns true only when both baseUrl and apiKey are present', () => {
  assert.equal(PROVIDERS.misp.isConfigured({ baseUrl: 'https://misp.example.org', apiKey: 'key' }), true);
  assert.equal(PROVIDERS.misp.isConfigured({ baseUrl: 'https://misp.example.org', apiKey: '' }), false);
  assert.equal(PROVIDERS.misp.isConfigured({ baseUrl: '', apiKey: 'key' }), false);
  assert.equal(PROVIDERS.misp.isConfigured({}), false);
});

test('MISP is excluded from getSupportedExternalProviders because it is an internal provider', () => {
  const external = getSupportedExternalProviders({ type: IOC_TYPES.DOMAIN, normalized: 'evil.example' });
  assert.equal(external.includes('misp'), false);
});

test('MISP is supported for IP, DOMAIN, URL, MD5, SHA1 and SHA256 but not ASN or SUBNET', () => {
  const supported = [IOC_TYPES.IP, IOC_TYPES.DOMAIN, IOC_TYPES.URL, IOC_TYPES.MD5, IOC_TYPES.SHA1, IOC_TYPES.SHA256];
  const unsupported = [IOC_TYPES.ASN, IOC_TYPES.SUBNET];
  for (const type of supported) {
    assert.equal(isProviderSupportedForIoc('misp', { type }), true, `expected MISP to support ${type}`);
  }
  for (const type of unsupported) {
    assert.equal(isProviderSupportedForIoc('misp', { type }), false, `expected MISP to not support ${type}`);
  }
});
