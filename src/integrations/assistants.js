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

function detectProviderConflict(providers = []) {
  const successful = providers.filter((p) => p.success);
  if (successful.length < 2) return null;
  const threat = successful.filter((p) => p.verdict === 'malicious' || p.verdict === 'suspicious').map((p) => p.provider);
  const clean = successful.filter((p) => p.verdict === 'clean').map((p) => p.provider);
  return threat.length > 0 && clean.length > 0 ? { threat, clean } : null;
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

  const sourceContext = investigation?.ioc?.sourceContext || {};
  const pageUrl = String(sourceContext.pageUrl || '').trim();
  const pageTitle = String(sourceContext.pageTitle || '').trim();
  const conflict = detectProviderConflict(providers);

  const actionInstruction = [
    'One concise next step.',
    pageUrl && `The analyst found this IOC on: ${pageTitle ? `"${pageTitle}" (${pageUrl})` : pageUrl} — tailor the recommended action to that context.`,
    conflict
      ? `Providers disagree: ${conflict.threat.join(', ')} flagged it as a threat while ${conflict.clean.join(', ')} found it clean — the action must address this discrepancy and suggest how to resolve it.`
      : 'If evidence is weak, say to validate against local telemetry.'
  ].filter(Boolean).join(' ');

  const investigationBlock = {
    ioc: investigation?.ioc?.normalized || '',
    type: investigation?.ioc?.type || '',
    overallVerdict: investigation?.overallVerdict || 'unknown',
    score: Number(investigation?.score || 0),
    tags: Array.isArray(investigation?.tags) ? investigation.tags : [],
    scoreFactors: Array.isArray(investigation?.scoreFactors) ? investigation.scoreFactors.slice(0, 4) : [],
    threatSummary: investigation?.threatSummary?.narrative || '',
    recommendation: investigation?.recommendation || {},
    ...(pageUrl || pageTitle ? { pageContext: { ...(pageUrl && { url: pageUrl }), ...(pageTitle && { title: pageTitle }) } } : {}),
    ...(conflict ? { providerConflict: conflict } : {}),
    providers
  };

  return JSON.stringify({
    task: 'Summarize this IOC investigation for a SOC analyst.',
    instructions: {
      summary: 'One concise sentence explaining what the score means.',
      action: actionInstruction,
      output: 'Return strict JSON with keys "summary" and "action".'
    },
    investigation: investigationBlock
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

function buildCorrelationPrompt(entries = [], options = {}) {
  const iocs = entries.map((e) => {
    const obj = {
      ioc: e.normalized || e.ioc?.normalized || '',
      type: e.type || e.ioc?.type || '',
      verdict: e.overallVerdict || 'unknown',
      score: Number(e.score || 0),
      tags: Array.isArray(e.tags) ? e.tags : [],
      seenCount: Number(e.seenCount || 1)
    };
    const pageTitle = e.pageTitle || e.ioc?.sourceContext?.pageTitle || '';
    const pageUrl = e.pageUrl || e.ioc?.sourceContext?.pageUrl || '';
    if (pageTitle || pageUrl) obj.pageContext = { ...(pageTitle && { title: pageTitle }), ...(pageUrl && { url: pageUrl }) };
    return obj;
  });

  const analystPage = {};
  if (options.pageUrl) analystPage.url = String(options.pageUrl).trim();
  if (options.pageTitle) analystPage.title = String(options.pageTitle).trim();

  return JSON.stringify({
    task: 'Cross-IOC correlation analysis for a SOC analyst.',
    instructions: {
      patterns: 'Identify 1-3 meaningful patterns across these IOCs (shared infrastructure, ASN clustering, similar threat profiles, potential campaign indicators, common page context). Only report patterns with real signal — skip obvious or trivial ones.',
      verdict: 'One short phrase: are these IOCs "likely related", "possibly related", or "independent"? Optionally add a brief reason.',
      action: 'The single most important next investigative step given the patterns found.',
      output: 'Return strict JSON with keys: "patterns" (array of 1-3 strings), "verdict" (string), "action" (string).'
    },
    correlationSet: {
      totalIocs: iocs.length,
      ...(analystPage.url || analystPage.title ? { analystCurrentPage: analystPage } : {}),
      iocs
    }
  }, null, 2);
}

function normalizeCorrelationOutput(text = '') {
  const parsed = parseJsonCandidate(text);
  if (parsed && typeof parsed === 'object') {
    const patterns = Array.isArray(parsed.patterns)
      ? parsed.patterns.map((p) => clipText(p, 120)).filter(Boolean).slice(0, 3)
      : [];
    return {
      patterns,
      verdict: clipText(parsed.verdict || '', 80),
      action: clipText(parsed.action || parsed.next_step || '', 180),
      rawText: String(text || '').trim()
    };
  }
  return {
    patterns: [],
    verdict: '',
    action: clipText(text, 180),
    rawText: String(text || '').trim()
  };
}

export async function generateCorrelationAnalysis(entries = [], config = {}, options = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const apiKey = String(config.apiKey || '').trim();
  const model = String(config.model || '').trim();
  if (!baseUrl || !apiKey || !model) throw new Error('LLM configuration incomplete');
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('At least 2 IOCs required for correlation');

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
      max_tokens: 450,
      messages: [
        {
          role: 'system',
          content: 'You are a SOC analyst assistant specializing in threat intelligence correlation. Return strict JSON only.'
        },
        {
          role: 'user',
          content: buildCorrelationPrompt(entries, options)
        }
      ]
    })
  });
  if (!response.ok) throw assistantHttpError(response.status, 'correlation');

  const json = await response.json();
  const content = extractChatMessageText(json);
  const normalized = normalizeCorrelationOutput(content);
  return {
    provider: 'OpenAI-compatible',
    model,
    iocCount: entries.length,
    ...normalized
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
      max_tokens: 300,
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
