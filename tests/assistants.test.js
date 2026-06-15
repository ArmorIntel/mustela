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
