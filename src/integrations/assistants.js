const ASSISTANT_FETCH_TIMEOUT_MS = 15000;

function assistantHttpError(status, context = 'lookup') {
  const err = new Error(`LLM HTTP ${status}`);
  err.provider = 'LLM';
  err.status = status;
  err.context = context;
  return err;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/g, '');
}

function assistantFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSISTANT_FETCH_TIMEOUT_MS);
  return fetch(url, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

function extractChatMessageText(payload = {}) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => typeof item?.text === 'string' ? item.text : '')
      .join('\n')
      .trim();
  }
  return '';
}

function parseJsonCandidate(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const candidates = [
    fenced?.[1] || '',
    trimmed,
    (() => {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      return start >= 0 && end > start ? trimmed.slice(start, end + 1) : '';
    })()
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function clipText(value, limit = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trim()}…` : text;
}

function buildPrompt(investigation = {}) {
  const providers = (Array.isArray(investigation.providerResults) ? investigation.providerResults : [])
    .map((result) => ({
      provider: result?.provider || 'Unknown',
      success: !!result?.success,
      verdict: result?.verdict || 'unknown',
      confidence: Number(result?.confidence || 0),
      summary: result?.summary || result?.error || ''
    }));

  return JSON.stringify({
    task: 'Summarize this IOC investigation for a SOC analyst.',
    instructions: {
      summary: 'One concise sentence explaining what the score means.',
      action: 'One concise next step. If evidence is weak, say to validate against local telemetry.',
      output: 'Return strict JSON with keys "summary" and "action".'
    },
    investigation: {
      ioc: investigation?.ioc?.normalized || '',
      type: investigation?.ioc?.type || '',
      overallVerdict: investigation?.overallVerdict || 'unknown',
      score: Number(investigation?.score || 0),
      tags: Array.isArray(investigation?.tags) ? investigation.tags : [],
      scoreFactors: Array.isArray(investigation?.scoreFactors) ? investigation.scoreFactors.slice(0, 4) : [],
      threatSummary: investigation?.threatSummary?.narrative || '',
      recommendation: investigation?.recommendation || {},
      providers
    }
  }, null, 2);
}

function normalizeAssistantOutput(text = '') {
  const parsed = parseJsonCandidate(text);
  if (parsed && typeof parsed === 'object') {
    return {
      summary: clipText(parsed.summary || parsed.brief || parsed.message || '', 240),
      action: clipText(parsed.action || parsed.next_step || parsed.recommendation || '', 180),
      rawText: String(text || '').trim()
    };
  }

  const fallback = clipText(text, 240);
  return {
    summary: fallback,
    action: '',
    rawText: String(text || '').trim()
  };
}

export async function validateOpenAiCompatibleConfig(config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const apiKey = String(config.apiKey || '').trim();
  const model = String(config.model || '').trim();
  if (!baseUrl) return { ok: false, message: 'Missing base URL', limited: false };
  if (!apiKey) return { ok: false, message: 'Missing API key', limited: false };

  const response = await assistantFetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    }
  });
  if (response.status === 401 || response.status === 403) return { ok: false, message: 'Invalid API key', limited: false };
  if (!response.ok) return { ok: false, message: `Validation failed (${response.status})`, limited: false };

  if (!model) return { ok: true, message: 'Connection valid', limited: false };

  const json = await response.json();
  const models = Array.isArray(json?.data) ? json.data : [];
  const found = models.some((item) => String(item?.id || '').trim() === model);
  return {
    ok: true,
    limited: !found,
    message: found ? 'Connection valid' : 'Connection valid, but the configured model was not listed'
  };
}

export async function generateInvestigationSummary(investigation = {}, config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const apiKey = String(config.apiKey || '').trim();
  const model = String(config.model || '').trim();
  if (!baseUrl || !apiKey || !model) {
    throw new Error('LLM configuration incomplete');
  }

  const response = await assistantFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        {
          role: 'system',
          content: 'You are a SOC analyst assistant. Return strict JSON only.'
        },
        {
          role: 'user',
          content: buildPrompt(investigation)
        }
      ]
    })
  });
  if (!response.ok) throw assistantHttpError(response.status, 'summary');

  const json = await response.json();
  const content = extractChatMessageText(json);
  const normalized = normalizeAssistantOutput(content);
  return {
    provider: 'OpenAI-compatible',
    model,
    summary: normalized.summary,
    action: normalized.action,
    rawText: normalized.rawText
  };
}
