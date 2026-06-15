import test from 'node:test';
import assert from 'node:assert/strict';
import { generateInvestigationSummary, validateOpenAiCompatibleConfig } from '../src/integrations/assistants.js';

function withMockFetch(handler, run) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.fetch = originalFetch;
    });
}

test('OpenAI-compatible validation checks the models endpoint with bearer auth', async () => {
  await withMockFetch(async (url, options = {}) => {
    assert.equal(url, 'https://api.example.com/v1/models');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers.Authorization, 'Bearer llm-key');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'soc-mini' }]
      })
    };
  }, async () => {
    const result = await validateOpenAiCompatibleConfig({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'llm-key',
      model: 'soc-mini'
    });
    assert.equal(result.ok, true);
    assert.equal(result.limited, false);
  });
});

test('OpenAI-compatible summary posts a chat completion request and normalizes JSON output', async () => {
  await withMockFetch(async (url, options = {}) => {
    assert.equal(url, 'https://api.example.com/v1/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer llm-key');
    assert.equal(options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'soc-mini');
    assert.equal(body.temperature, 0.2);
    assert.equal(body.max_tokens, 220);
    assert.equal(Array.isArray(body.messages), true);
    assert.equal(body.messages.length, 2);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"summary":"The IOC already has meaningful external signal and should be treated as suspicious.","action":"Pivot to endpoint and proxy telemetry before blocking."}'
            }
          }
        ]
      })
    };
  }, async () => {
    const result = await generateInvestigationSummary({
      ioc: { normalized: 'evil.example', type: 'domain' },
      overallVerdict: 'suspicious',
      score: 58,
      scoreFactors: ['VirusTotal reported 3 detections.'],
      threatSummary: { narrative: '1/2 providers returned usable data.' },
      recommendation: { action: 'Correlate with telemetry.' },
      providerResults: [{ provider: 'VirusTotal', success: true, verdict: 'suspicious', confidence: 30, summary: '3 detections' }]
    }, {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'llm-key',
      model: 'soc-mini'
    });
    assert.match(result.summary, /suspicious/i);
    assert.match(result.action, /telemetry/i);
    assert.equal(result.provider, 'OpenAI-compatible');
  });
});

test('OpenAI-compatible summary accepts JSON wrapped in a fenced code block', async () => {
  await withMockFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '```json\n{"summary":"Suspicious domain flagged by VT.","action":"Block at DNS."}\n```' } }]
    })
  }), async () => {
    const result = await generateInvestigationSummary({
      ioc: { normalized: 'evil.example', type: 'domain' },
      providerResults: []
    }, { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'gpt-4o' });
    assert.match(result.summary, /Suspicious domain/i);
    assert.match(result.action, /Block/i);
  });
});

test('OpenAI-compatible summary falls back gracefully when the LLM returns plain text instead of JSON', async () => {
  await withMockFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'This IP has been observed in multiple phishing campaigns.' } }]
    })
  }), async () => {
    const result = await generateInvestigationSummary({
      ioc: { normalized: '1.2.3.4', type: 'ip' },
      providerResults: []
    }, { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'gpt-4o' });
    assert.match(result.summary, /phishing/i);
    assert.equal(result.action, '');
  });
});

test('OpenAI-compatible summary accepts array content format from the API', async () => {
  await withMockFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: [
            { type: 'text', text: '{"summary":"Malicious hash.","action":"Quarantine the file."}' }
          ]
        }
      }]
    })
  }), async () => {
    const result = await generateInvestigationSummary({
      ioc: { normalized: 'abc123', type: 'md5' },
      providerResults: []
    }, { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'gpt-4o' });
    assert.match(result.summary, /Malicious/i);
    assert.match(result.action, /Quarantine/i);
  });
});

test('OpenAI-compatible summary throws a structured error on HTTP failure', async () => {
  await withMockFetch(async () => ({ ok: false, status: 429 }), async () => {
    await assert.rejects(
      () => generateInvestigationSummary({ ioc: { normalized: '1.2.3.4', type: 'ip' }, providerResults: [] }, {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'key',
        model: 'gpt-4o'
      }),
      (err) => {
        assert.equal(err.provider, 'LLM');
        assert.equal(err.status, 429);
        assert.equal(err.context, 'summary');
        return true;
      }
    );
  });
});

test('OpenAI-compatible summary throws when config is incomplete', async () => {
  await assert.rejects(
    () => generateInvestigationSummary({ ioc: { normalized: '1.2.3.4', type: 'ip' }, providerResults: [] }, {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key'
    }),
    /LLM configuration incomplete/i
  );
  await assert.rejects(
    () => generateInvestigationSummary({ ioc: { normalized: '1.2.3.4', type: 'ip' }, providerResults: [] }, {
      apiKey: 'key',
      model: 'gpt-4o'
    }),
    /LLM configuration incomplete/i
  );
});

test('OpenAI-compatible validation reports model not listed as limited without rejecting the key', async () => {
  await withMockFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: 'other-model' }] })
  }), async () => {
    const result = await validateOpenAiCompatibleConfig({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'llm-key',
      model: 'missing-model'
    });
    assert.equal(result.ok, true);
    assert.equal(result.limited, true);
    assert.match(result.message, /not listed/i);
  });
});

test('OpenAI-compatible validation reports invalid key on 401', async () => {
  await withMockFetch(async () => ({ ok: false, status: 401 }), async () => {
    const result = await validateOpenAiCompatibleConfig({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'bad-key',
      model: 'gpt-4o'
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /Invalid API key/i);
  });
});

test('OpenAI-compatible validation fails fast when baseUrl or apiKey is missing', async () => {
  const noUrl = await validateOpenAiCompatibleConfig({ apiKey: 'key', model: 'gpt-4o' });
  assert.equal(noUrl.ok, false);
  assert.match(noUrl.message, /base URL/i);

  const noKey = await validateOpenAiCompatibleConfig({ baseUrl: 'https://api.example.com/v1', model: 'gpt-4o' });
  assert.equal(noKey.ok, false);
  assert.match(noKey.message, /API key/i);
});

test('OpenAI-compatible validation succeeds without model check when model is omitted', async () => {
  await withMockFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: 'gpt-4o' }] })
  }), async () => {
    const result = await validateOpenAiCompatibleConfig({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key'
    });
    assert.equal(result.ok, true);
    assert.equal(result.limited, false);
    assert.match(result.message, /Connection valid/i);
  });
});
