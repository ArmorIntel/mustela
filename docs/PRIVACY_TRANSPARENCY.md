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
- A manual TLP 2.0 sharing label per history entry (IOC type + normalized value), shared across pages investigating the same IOC. New/legacy entries are unclassified (`null`), never CLEAR by default. Unknown stored values are treated as unclassified. Clearing history or eviction beyond 50 entries removes the label and note locally; it does not delete exports or remote MISP attributes.
- Cached investigation results, including compact provider results and the investigation's LLM summary, action, and raw response text when present.
- Summary/action text copied into history, with its LLM or built-in source recorded.
- Last detected IOC for tab state.

This storage remembers configuration and investigations and reduces repeated calls. It is not a promise of non-transmission: configured credentials authenticate requests, and some locally held context is used in prompts. The correlation response is returned to the UI; that handler does not save it to the investigation cache or history. Free-form analyst notes stay local in the examined LLM flows.

## What leaves the browser

### Global transmission pause

The background owns a global pause state stored separately as `mustela_paused` in `chrome.storage.local`; absence means ON (`paused: false`). It is independent of highlighting, URL rules, keys, and provider/Analyst Assist preferences. This is the background contract, not a popup control or visual propagation feature.

- `GET_PAUSE_STATE` returns the last confirmed state. `SET_PAUSE_STATE` accepts `payload: { paused: boolean }`, serializes transitions, and confirms `{ ok: true, data: { paused } }` only after storage succeeds. A failed write returns an explicit error asking for a retry; no OFF success is announced. Ordinary settings saves cannot change pause.
- After OFF is confirmed, `LOOKUP_IOC` (including reruns/cache paths), `OPEN_EXTERNAL_PROVIDER`, `CORRELATE_IOCS`, `ADD_IOC_TO_MISP`, `TEST_API_KEY`, and investigation/pivot context menus are refused before any new API call or external navigation. This applies with or without keys, to MISP and local LLM endpoints too, and to already-open interfaces. Message refusals have `ok: false`, `code: 'MUSTELA_PAUSED'`, and an explanation; blocked menus notify the originating tab with `MUSTELA_ACTION_BLOCKED`.
- Each new provider/LLM call and pivot is guarded. If pause is confirmed during an outstanding request, later providers and the automatic summary do not start. Shodan key validation also checks before its second (host-probe) request. Provider errors/timeouts do not bypass pause.
- ON preserves previous preferences and existing policies; it never replays blocked actions or restarts interrupted investigations. A fresh analyst action is required, even if ON was confirmed before an old response arrived.

Pause does **not** cancel or recall requests already started, promise remote deletion, purge local data, or stop autonomous traffic from a website already opened. Detection/highlighting and local storage are not disabled by this network contract. No recipient, Chrome permission, telemetry, or cloud storage is added. The operations below describe ON behavior, subject to this pause and the protected IPv4 policy.

### Protected IPv4 policy

The following literal IPv4 ranges are protected: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `100.64.0.0/10`, `224.0.0.0/4`, `192.0.2.0/24`, `198.51.100.0/24`, and `203.0.113.0/24`.

- These IOC remain detected/highlighted and show **Internal / reserved** in the panel and manual lookup. Blocking does not imply a clean verdict.
- VirusTotal, AbuseIPDB, and Shodan API lookups and website pivots are blocked for these IOC, including highlight, manual input, context menu, panel reopening, and Re-run paths. The policy precedes cache reuse: old public results, links, and LLM briefs are not reused.
- Analyst Assist never generates a summary for these IOC, even after provider errors or with a local endpoint. Correlation excludes their history entries (including older entries without classification) **before** priority selection and the 10-entry limit. Fewer than two remaining eligible entries means no LLM request and an explanation in the UI. No endpoint URL grants an exception.
- **MISP is an exception, not browser confinement.** Enabled/configured MISP lookup can still send the IOC to the chosen instance. Explicit **Add to MISP** can also send it; lookup never adds automatically. Existing configuration and permission errors still apply. Protected lookups bypass the investigation cache, so a configured MISP lookup may run again on reopening.
- With all integrations disabled, detection, the badge/explanation, analyst notes, copy, and local exports need no network provider.

This is a policy for those literal IPv4 IOC and their investigation entries, **not** general text redaction. It does not classify IPv6, subnets/CIDRs, DNS resolutions, addresses inside URLs, other special ranges, or arbitrary page/provider text and metadata. An eligible public IOC's free text/page context may still contain sensitive information. It does not undo disclosures made before this policy. Configuration tests still contact their configured destinations as described below; public probe addresses are not protected.

The operations below apply subject to this policy.

### Operations and destinations

Paths below are relative to the selected instance/endpoint base URL where applicable. API-key validation is itself a network operation, not an investigation prompt.

| Operation | Destination | Method/path | Data sent | Authentication | Trigger |
| --- | --- | --- | --- | --- | --- |
| Public-provider lookup | VirusTotal, AbuseIPDB, or Shodan API | `GET`, provider/type-specific lookup path or query | IOC value (encoded as required by the API) and lookup parameters | VirusTotal `x-apikey` header; AbuseIPDB `Key` header; Shodan `key` query parameter | An investigation not served from cache, for enabled/configured providers supporting the IOC type |
| Public-provider key validation | Respective provider API | `GET` validation/probe endpoints | Key; AbuseIPDB and Shodan also probe the fixed public IP `8.8.8.8` | Same provider-specific authentication as lookup | Configuration test/validation |
| MISP connection test | Your chosen MISP instance | `GET /servers/getVersion` | Connection/version request, no investigation IOC | API key in `Authorization` header (not Bearer) | Test connection with base URL and key |
| MISP lookup | Your chosen MISP instance | `POST /attributes/restSearch` | IOC value and attribute type; IP searches both `ip-src` and `ip-dst`; JSON return format, page 1, limit 10 | API key in `Authorization` header | An investigation not served from cache with MISP enabled, base URL/key configured, and supported IOC type |
| MISP attribute creation | Your chosen MISP instance | `POST /attributes/add/{eventId}` | IOC value, attribute type/category, `to_ids`, comment, confirmed TLP attribute tag when classified, and target event ID in the path (explicit or configured default) | API key in `Authorization` header | Dedicated **Add to MISP** action; requires a target event, not performed by lookup |
| Analyst Assist configuration validation | Your chosen OpenAI-compatible endpoint, local or remote | `GET /models` | Model-list request; no investigation prompt (the configured model is checked against the response locally) | API key in `Authorization: Bearer …` header | Configuration validation with base URL and key |
| Analyst Assist investigation summary | Your chosen OpenAI-compatible endpoint, local or remote | `POST /chat/completions` | Configured model and summary prompt described below | API key in `Authorization: Bearer …` header | Automatically during an investigation not served from cache when enabled with base URL, key, and model; no distinct AI click |
| Analyst Assist correlation | Same chosen OpenAI-compatible endpoint | `POST /chat/completions` | Configured model and prompt built from 2–10 selected history entries, plus available current-page context | API key in `Authorization: Bearer …` header | Dedicated correlation action with Analyst Assist enabled/configured and at least 2 history entries |
| Manual external pivot | Destination provider website | Normal browser navigation to the pivot URL | IOC embedded in destination URL | Normal browser/site authentication, if any; no extension API key required | Opening an external pivot |

MISP uses `POST` for both searching and adding: **POST does not always mean a write**. Lookup searches existing attributes; only the dedicated add action creates an attribute. MISP supports IP, domain, URL, MD5, SHA1, and SHA256, not ASN/subnet. Its label as an internal provider does not keep data inside the browser: requests go to the chosen instance.

### Defender query clipboard

**Copy Defender KQL** in popup manual lookup generates a deterministic query locally and writes it to the system clipboard only on an explicit click or keyboard activation. This action does not call providers or Microsoft, open tabs, execute a query, collect the page URL/title, or create investigation/history/cache/note records, including on sensitive pages. It works without API keys or Analyst Assist and while transmissions are paused; it adds no Chrome permissions.

The clipboard contains the normalized IOC inside a Defender XDR query and may be accessible to other applications. The analyst chooses where to paste and execute it; any subsequent disclosure or execution is outside this copy action. Other investigation and pivot actions still make the outgoing requests described above.

### Manual TLP labels and exports

Changing the TLP selector only writes local history; it adds no provider request. Copy export and Download JSON include the canonical root `tlp` field (or `null` for Not classified), together with IOC, note and results, without provider configuration/API keys. Whoever receives that file or copied text receives the sharing label too.

Only the explicit **Add to MISP** action sends the selected label to an integration, as `Tag: [{name: 'tlp:clear'}]`, `tlp:green`, `tlp:amber`, `tlp:amber+strict`, or `tlp:red` on the created attribute. Unclassified adds have no TLP tag. No event distribution or publication is changed, and failed adds are not retried without a tag or automatically. Saving/loading must finish before copy/export/add becomes available; a failed save retains the last confirmed label and permits a manual retry.

A sharing label, not a network control. Check the recipient before sharing. These labels do not authorize sharing or filter existing provider lookups, external pivots, or Analyst Assist. Selecting RED cannot reverse earlier disclosures. TLP is separate from reputation tags and is not included in summary or correlation LLM prompts. No new recipient, telemetry, or Chrome permission is introduced.

### Analyst Assist prompt contents and automatic summaries

The summary prompt includes:

- IOC value/type, overall verdict, score, tags, and up to four score factors.
- Threat-summary narrative and recommendation.
- Provider names, success flags, verdicts, confidence, and summaries or errors, **including MISP** when present.
- A provider-conflict description when successful providers disagree.
- Page URL and title when present in the IOC's source context.

Provider API keys are **not added to the LLM prompt**. The LLM key authenticates the request to the selected endpoint, and the model name is sent in the request body. The prompt does not contain the entire page or all raw MISP data. Nevertheless, provider summaries and page URL/title can reveal internal investigation context.

For eligible IOC, provider errors do not suppress the automatic summary: a configured Analyst Assist request can run even if some provider enrichments fail. Without its required configuration, or when disabled, this automatic summary does not run. Likewise, automatic MISP lookup requires enablement, base URL, and API key. Missing keys do not prevent manual pivots or configuration tests supplied with credentials.

### Correlation selection

The dedicated correlation action first excludes protected IPv4 entries, then selects up to **10 eligible history entries**, prioritized by threat verdict and then recency, with at least **2** eligible entries required. It sends IOC/type, verdict, score, tags, `seenCount`, and associated page URL/title when available, plus current-page URL/title if supplied. It does **not** send the entire history or free-form analyst notes.

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
