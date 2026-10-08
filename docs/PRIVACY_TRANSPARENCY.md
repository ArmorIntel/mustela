# Privacy & Transparency

Mustela is a **local-first Chrome extension MVP** for analysts.

This page explains local storage, outgoing requests and their triggers, and what the extension does **not** guarantee.

## Short version

- IOC detection and highlighting happen **inside the browser on the current page**.
- Settings, API keys, recent history, analyst notes, cache, and disabled-page rules are stored in **`chrome.storage.local` in the local browser profile**. Local storage does not mean that those data can never be transmitted: the operations below use configured keys and may send IOC, page context, and selected history data.
- Investigating an IOC can call enabled, configured VirusTotal, AbuseIPDB, Shodan, and **MISP** integrations. MISP sends requests to the instance you choose; adding an attribute is a separate action, not an automatic consequence of lookup.
- **Analyst Assist**, when enabled and fully configured, automatically sends an investigation summary prompt to your chosen OpenAI-compatible endpoint on an investigation not served from cache. There is no separate AI click for this summary. Correlation has its own dedicated action.
- MISP and Analyst Assist are **disabled by default**. Detection, highlighting, and manual pivots work without API keys. Pivots can still disclose the IOC to the destination site without an API key.
- There is **no project backend, telemetry, analytics, extension account system, or project cloud sync**.

## What the extension processes

The extension may process:

- IOC visible on the current page or entered for investigation: IPv4, domains, URLs, MD5/SHA1/SHA256, and subnet/ASN where supported.
- Page URL and title, when available, for investigation context and local history. These may also enter Analyst Assist prompts; the extension does not send the full page to the LLM.
- Provider configuration: enabled flags and API keys; MISP base URL and default event ID.
- Analyst Assist configuration: enabled flag, base URL, API key, and model name.
- Investigation results, provider summaries/verdicts/confidence or errors, aggregate scores, tags, recommendations, and LLM responses.
- Recent investigation history, occurrence counts, pinning metadata, and free-form analyst notes. Notes are not included in the LLM prompts described below; a comment explicitly submitted with **Add to MISP** is sent to MISP.

## What stays local

The following are stored in `chrome.storage.local` in the browser profile:

- Provider settings and API keys, including MISP base URL and default event ID.
- Analyst Assist settings, API key, base URL, and model.
- Highlight/detection preferences, cache TTL, and disabled-page rules.
- Recent investigation history with IOC, page URL/title, verdict, score, occurrence count, pinning, and analyst notes.
- Cached investigation results, including compact provider results and the investigation's LLM summary, action, and raw response text when present.
- Summary/action text copied into history, with its LLM or built-in source recorded.
- Last detected IOC for tab state.

This storage remembers configuration and investigations and reduces repeated calls. It is not a promise of non-transmission: configured credentials authenticate requests, and some locally held context is used in prompts. The correlation response is returned to the UI; that handler does not save it to the investigation cache or history. Free-form analyst notes stay local in the examined LLM flows.

## What leaves the browser

### Operations and destinations

Paths below are relative to the selected instance/endpoint base URL where applicable. API-key validation is itself a network operation, not an investigation prompt.

| Operation | Destination | Method/path | Data sent | Authentication | Trigger |
| --- | --- | --- | --- | --- | --- |
| Public-provider lookup | VirusTotal, AbuseIPDB, or Shodan API | `GET`, provider/type-specific lookup path or query | IOC value (encoded as required by the API) and lookup parameters | VirusTotal `x-apikey` header; AbuseIPDB `Key` header; Shodan `key` query parameter | An investigation not served from cache, for enabled/configured providers supporting the IOC type |
| Public-provider key validation | Respective provider API | `GET` validation/probe endpoints | Key; AbuseIPDB and Shodan also probe the fixed public IP `8.8.8.8` | Same provider-specific authentication as lookup | Configuration test/validation |
| MISP connection test | Your chosen MISP instance | `GET /servers/getVersion` | Connection/version request, no investigation IOC | API key in `Authorization` header (not Bearer) | Test connection with base URL and key |
| MISP lookup | Your chosen MISP instance | `POST /attributes/restSearch` | IOC value and attribute type; IP searches both `ip-src` and `ip-dst`; JSON return format, page 1, limit 10 | API key in `Authorization` header | An investigation not served from cache with MISP enabled, base URL/key configured, and supported IOC type |
| MISP attribute creation | Your chosen MISP instance | `POST /attributes/add/{eventId}` | IOC value, attribute type/category, `to_ids`, comment, and target event ID in the path (explicit or configured default) | API key in `Authorization` header | Dedicated **Add to MISP** action; requires a target event, not performed by lookup |
| Analyst Assist configuration validation | Your chosen OpenAI-compatible endpoint, local or remote | `GET /models` | Model-list request; no investigation prompt (the configured model is checked against the response locally) | API key in `Authorization: Bearer …` header | Configuration validation with base URL and key |
| Analyst Assist investigation summary | Your chosen OpenAI-compatible endpoint, local or remote | `POST /chat/completions` | Configured model and summary prompt described below | API key in `Authorization: Bearer …` header | Automatically during an investigation not served from cache when enabled with base URL, key, and model; no distinct AI click |
| Analyst Assist correlation | Same chosen OpenAI-compatible endpoint | `POST /chat/completions` | Configured model and prompt built from 2–10 selected history entries, plus available current-page context | API key in `Authorization: Bearer …` header | Dedicated correlation action with Analyst Assist enabled/configured and at least 2 history entries |
| Manual external pivot | Destination provider website | Normal browser navigation to the pivot URL | IOC embedded in destination URL | Normal browser/site authentication, if any; no extension API key required | Opening an external pivot |

MISP uses `POST` for both searching and adding: **POST does not always mean a write**. Lookup searches existing attributes; only the dedicated add action creates an attribute. MISP supports IP, domain, URL, MD5, SHA1, and SHA256, not ASN/subnet. Its label as an internal provider does not keep data inside the browser: requests go to the chosen instance.

### Analyst Assist prompt contents and automatic summaries

The summary prompt includes:

- IOC value/type, overall verdict, score, tags, and up to four score factors.
- Threat-summary narrative and recommendation.
- Provider names, success flags, verdicts, confidence, and summaries or errors, **including MISP** when present.
- A provider-conflict description when successful providers disagree.
- Page URL and title when present in the IOC's source context.

Provider API keys are **not added to the LLM prompt**. The LLM key authenticates the request to the selected endpoint, and the model name is sent in the request body. The prompt does not contain the entire page or all raw MISP data. Nevertheless, provider summaries and page URL/title can reveal internal investigation context.

Provider errors do not suppress the automatic summary: a configured Analyst Assist request can run even if some provider enrichments fail. Without its required configuration, or when disabled, this automatic summary does not run. Likewise, automatic MISP lookup requires enablement, base URL, and API key. Missing keys do not prevent manual pivots or configuration tests supplied with credentials.

### Correlation selection

The dedicated correlation action selects up to **10 history entries**, prioritized by threat verdict and then recency, with at least **2** required. It sends IOC/type, verdict, score, tags, `seenCount`, and associated page URL/title when available, plus current-page URL/title if supplied. It does **not** send the entire history or free-form analyst notes.

### Cache, failures, and recipient policies

A result served from the investigation cache avoids new provider lookup and LLM summary calls on that path. It still updates local history. A rerun bypasses this cache; separate validation, MISP add, correlation, and pivot actions are not covered by that cache shortcut. Cache reuse does not undo prior disclosures.

A failed, timed-out, or cancelled request may already have transmitted its data. Neither a failure nor clearing local cache/history guarantees deletion at the recipient. Mustela does not control the hosting, access, retention, analysis, or reuse policies of public providers, your MISP instance, or your LLM endpoint. A local LLM endpoint does not prevent other configured providers or external pivots from receiving data.

## Network behavior and current safeguards

Extension API fetches use `GET` and `POST` as listed above. In `providers.js` and `assistants.js`, these fetches use:

- `credentials: 'omit'` (no browser cookies sent by these fetches; explicit API authentication still applies).
- `cache: 'no-store'` for the browser's HTTP cache, distinct from Mustela's local investigation cache.
- `referrerPolicy: 'no-referrer'` (does not remove page URL/title explicitly included in a prompt).
- AbortController timeouts: **12 seconds per provider fetch**, **15 seconds per LLM fetch**.

These safeguards apply to the extension's API fetches, **not to pages opened by pivots**, their normal browser behavior, or recipient retention policies. They are not a blanket confidentiality guarantee or proof that an aborted request transmitted nothing.

## What is not claimed

This repository does **not** claim:

- Zero disclosure, anonymity, or remote deletion of submitted data.
- End-to-end encryption beyond what the selected connection normally uses.
- Enterprise-grade secret management or cross-device secure sync.
- Backend-side anonymization or proxying.
- Legal compliance coverage for every environment.
- Support for Firefox or non-Chrome browsers.

## Operational guidance for users

Before investigating sensitive pages or IOC:

- Disable integrations not authorized by your policy, including MISP and Analyst Assist. Detection/highlighting do not require them.
- Evaluate IOC, page URL/title, and internal provider summaries as potentially sensitive before enabling automatic LLM summaries or requesting correlation.
- Check hosting, access controls, retention, and terms for the exact MISP instance and LLM endpoint you choose, as well as public providers.
- Use only authorized MISP events and review the comment before adding an attribute.
- Remember that external pivots can disclose an IOC even without API keys.
- Clear local cache/history when appropriate, without assuming this deletes previously transmitted data remotely.

## Chrome Web Store / public-release wording guidance

Any future Store listing and privacy answers should match the implemented flows:

- Identify public intelligence providers, the chosen MISP instance, and the chosen local or remote LLM endpoint as possible recipients.
- Describe IOC lookup, dedicated MISP writes/comments, automatic LLM summaries with page URL/title and provider context, and correlation with selected history/current-page context.
- Mention authenticated configuration tests, manual external pivots, and local storage of settings, keys, cache, history, notes, and investigation LLM responses.
- Do not equate local-first, a local model, or missing API keys with zero outbound traffic.
- Do not imply a project backend or overclaim anonymity, remote deletion, confidentiality, or compliance.

This guidance does not publish or certify a Store listing.

## Current maturity statement

This is a **public-facing MVP**, not a fully hardened enterprise product. The goal is honest utility for analysts with transparent trade-offs. Update this document alongside implementation changes.
