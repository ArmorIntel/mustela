# Mustela product foundations

## Platform

web

Chrome Manifest V3 extension; vanilla HTML/CSS/JavaScript and a static public site. This records current capabilities, not a roadmap.

## Users and operating context

The primary user is a SOC analyst, at any experience level, investigating IOC values in SIEM consoles and logs, often dense and dark. Secondary contexts are browser pages, browser-based webmail and support tickets. No analyst-level segmentation or separate CTI/IR audience is established.

## Product purpose

Accompany investigations and save analyst time through contextual pivots and, when evidence permits, recommendations. Success is qualitative today, not a measured productivity claim.

The loop is **detect → investigate → keep a trace**:

| Step | Existing behavior and evidence |
| --- | --- |
| Detect | Local IPv4, subnet, ASN, domain, URL and MD5/SHA1/SHA256 parsing; balanced/strict noise filtering. [IOC helpers](src/shared/ioc.js): `parseIocsFromText`; [content script](src/content/content.js): `scanPage`, `highlightNode`. |
| Investigate | Click a highlight, paste an IOC, reopen history or investigate selected text through the context menu. Panel combines provider evidence, score, built-in recommendations and optional Analyst Assist. [Background](src/background/background.js): `lookupIoc`, context-menu handlers; [popup](src/popup/popup.js): `mountManualLookup`. |
| Keep a trace | Local history, pinning, notes, cache, copied export and downloaded JSON. [Storage](src/storage/storage.js): `addHistory`, `saveHistoryNote`, `setCachedResult`; content: `bindAnalystActions`. Detection alone does not create investigation history. |

## Capabilities and constraints

- Detection, highlighting and supported external pivots need no API key. Enrichment does: VirusTotal supports IP/domain/URL/hashes; AbuseIPDB IP/subnet; Shodan IP/ASN; MISP IP/domain/URL/hashes. [Providers](src/providers/providers.js): `PROVIDERS`, `isProviderSupportedForIoc`.
- Analyst Assist requires an enabled OpenAI-compatible endpoint, key and model. Summaries and correlation are optional, not authoritative decisions. Correlation selects at most ten recent investigations; at least two are required. [Assistants](src/integrations/assistants.js); background: `selectCorrelationEntries`.
- No result is not a benign verdict: the popup calls `clean` “Low signal”; absent usable providers produce “Unknown”. Provider errors, access limits and timeouts can degrade evidence.
- Content scanning processes at most 1,500 text nodes; skips form/editable content and avoids replacing text inside links. Restricted browser pages and host-page styling constrain coverage. “Any page” marketing is not a compatibility guarantee.
- Storage caps cache at 30 and history at 50 entries. Popup history examines eight recent entries and displays five filtered entries. Page exceptions match exact URLs. No unlimited archive or cross-device sync is implemented.

## Product principles and data boundaries

1. Local-first, without a project backend, telemetry, analytics, extension accounts or cloud sync. Settings, keys, history, notes and cache use `chrome.storage.local`, not a secret vault.
2. Preserve useful keyless investigation; distinguish local detection from external enrichment.
3. Keep permissions justified and minimal as a contribution principle, not a claim of narrow current access. The [manifest](manifest/chrome.manifest.json) includes storage, activeTab, contextMenus, tabs and scripting, plus broad HTTP/HTTPS host access.
4. Local-first is not zero disclosure. Configured providers receive investigated IOC values; external pivots navigate to provider sites with IOC-bearing URLs. Service validation also contacts configured destinations.
5. Explicit “Add to MISP” writes a supported attribute to the configured event, including the analyst note as a comment. Analyst Assist sends structured evidence and available page URL/title context; correlation sends selected investigations and page context. See providers: `addIocToMisp`; assistants: `buildPrompt`, `buildCorrelationPrompt`.

Current [privacy transparency](docs/PRIVACY_TRANSPARENCY.md) documents MISP, Analyst Assist and pivots; this reference changes no flows.

## Current voice and evidence

Action labels are literal: “Copy IOC”, “Copy export”, “Suggested next step” (content script); “Settings saved locally.” ([welcome](src/welcome/welcome.js): `save`). Popup history also uses conversational phrases: “keep it warm”, “less déjà vu”, “redoing the whole dance”. The [site](docs/index.html) says “Small, fast, and very good at hunting.” These are descriptive examples, not a newly approved voice.

Source code, synthetic [fixtures](tests/fixtures/iocs.html) and [tests](tests/e2e/extension.e2e.spec.js) are evidence. Site verdicts are illustrations, not benchmarks.

## Accessibility and open questions

WCAG 2.2 AA is the contribution target; [the audit](docs/design-audit.md) records current gaps, not global conformance.

Open questions: define non-telemetry success measures using local test scenarios, such as actions/time between an IOC in a console and an analyst verdict; establish a future voice/identity direction separately; validate compatibility in representative SIEM log tables. No quantitative target, customer claim or competitive positioning is established.
