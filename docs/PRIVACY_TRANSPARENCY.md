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

- IOC visible on the current page or entered for investigation: IPv4 and IPv6, ASCII email addresses, domains, URLs, MD5/SHA1/SHA256, and subnet/ASN where supported.
- Page URL and title, when available, for investigation context and local history. These may also enter Analyst Assist prompts; the extension does not send the full page to the LLM.
- Provider configuration: enabled flags and API keys; MISP base URL and default event ID.
- Analyst Assist configuration: enabled flag, base URL, API key, and model name.
- Investigation results, provider summaries/verdicts/confidence or errors, aggregate scores, tags, recommendations, and LLM responses.
- Recent investigation history, occurrence counts, pinning metadata, and free-form analyst notes. Notes are not included in the LLM prompts described below; a comment explicitly submitted with **Add to MISP** is sent to MISP.

### Defanged investigation values

Supported defanged URLs, domains and IPv4 keep their source spelling and positions on the page. The investigation value refangs `hxxp`/`hxxps`, scheme `[:]`, and host `[.]`/`(.)` separators only; path/query text is not refanged. For example, `hxxps[:]//evil[.]test/a[.]b` becomes `https://evil.test/a[.]b`. Scanning is local and neither activates a target link nor requests the IOC target/provider. Existing investigation actions use the normalized value in the panel, cache, local history, configured provider/Analyst Assist flows and supported explicit pivots. Those actions can transmit that value under the existing rules below; this is not a promise to keep refanged values local. No recipient or permission is added.

### IPv6 investigation values

Full/compressed IPv6 and valid IPv4 tails use the existing `ip` type. Source spelling and offsets remain local; normalized investigation values are lowercase, compress the longest zero run (first tie, never a single zero), and convert dotted tails to hexadecimal (`::ffff:192.0.2.1` → `::ffff:c000:201`). Surrounding brackets are not part of a standalone IP; HTTP(S) URLs with bracketed IPv6 stay single URL indicators. IPv6 CIDR, zone IDs and refang are not supported.

Detection/highlighting makes no target or provider request and never automatically navigates to the address. Existing explicit investigation, copy/export, local history, configured provider/MISP requests, Analyst Assist and website pivots use the normalized value with the same recipients and triggers documented below. MISP IP search uses `ip-src`/`ip-dst`; explicit adds use `ip-dst`. Third-party IPv6 support varies; errors/timeouts do not establish a clean verdict or prevent other results. The protected IPv4 policy does not classify IPv6, including loopback, private and IPv4-mapped literals: check sensitivity and recipients before investigating. No permissions, telemetry or credentials requirement are added.

### Email investigation values

ASCII, non-defanged email addresses are distinct `email` IOC, not their domains. The dot-atom local part retains its case; only the DNS domain is lowercased. Source spelling/positions are preserved for highlighting. Cache, local history and notes distinguish local-part case. Unsupported Unicode/IDN, quoted local parts and malformed address-like tokens do not promote nested indicators. Editable fields are not scanned; no registration capture or account collection is added.

An email address may identify a person. Detection/highlighting are local and do not request any provider or navigate; excluded pages do not scan. Tab detection state is held in memory-only `chrome.storage.session` until tab closure or navigation; investigation cache/history remain in `chrome.storage.local`, not synced. Explicit copy/export includes the full address and may disclose it wherever you paste/share. No compatible provider is added: email lookups, reruns and pivots cannot send it to VirusTotal, AbuseIPDB, Shodan or MISP, and Add to MISP is unavailable. No domain extraction pivot or mailto action is provided. Without keys and with Analyst Assist disabled, the investigation remains local and useful without claiming reputation.

Email is eligible for the existing optional Analyst Assist flows: when enabled with endpoint, key and model, an uncached investigation automatically sends the full normalized email/type and available page URL/title to that endpoint. An explicit correlation request can include selected email history and page context under the existing selection rules. LLM errors/timeouts remain non-blocking for investigation and may already have transmitted data. Detection alone does not trigger either flow. Local-first does not mean zero sending; review potentially personal data before enabling these options. No recipient, permission or telemetry is added.

## What stays local

The following are stored in `chrome.storage.local` in the browser profile:

- Provider settings and API keys, including MISP base URL and default event ID.
- Analyst Assist settings, API key, base URL, and model.
- Highlight/detection preferences, cache TTL, and disabled-page rules.
- Recent investigation history with IOC, page URL/title, verdict, score, occurrence count, pinning, and analyst notes.
- A manual TLP 2.0 sharing label per history entry (IOC type + normalized value), shared across pages investigating the same IOC. New/legacy entries are unclassified (`null`), never CLEAR by default. Unknown stored values are treated as unclassified. Clearing history or eviction beyond 50 entries removes the label and note locally; it does not delete exports or remote MISP attributes.
- Cached investigation results, including compact provider results and the investigation's LLM summary, action, and raw response text when present.
- Summary/action text copied into history, with its LLM or built-in source recorded.

IOC detected on the current tab, with page URL/title, are stored in **`chrome.storage.session`** (memory only), cleared on tab closure or navigation. Each tab has its own key; URL/title are stored once per tab and unchanged lists are not rewritten. This state survives service-worker restarts, but not browser sessions. Startup/update deletes the legacy `mustela_last_detected` key from `chrome.storage.local`; this does not clear investigation history or cache.

This storage remembers configuration and investigations and reduces repeated calls. It is not a promise of non-transmission: configured credentials authenticate requests, and some locally held context is used in prompts. The correlation response is returned to the UI; that handler does not save it to the investigation cache or history. Free-form analyst notes stay local in the examined LLM flows.

### In-page UI isolation

The investigation panel, detection indicator and hover tip share one closed shadow root with internal styles. Ordinary page DOM selectors, `innerText`/`innerHTML`, and subtree MutationObservers cannot read their verdicts, provider results, Analyst Assist text, notes or TLP labels. UI identifiers and classes stay inside that root. The panel resets inherited styles, exposes a named non-modal dialog, supports Escape and restores prior focus on close. Only the panel uses a moderate backdrop blur; reduced-transparency preferences select an opaque background.

This is DOM/CSS encapsulation, **not a security boundary against a hostile site**. The page can remove or obscure the host, observe composed events in capture listeners (including typed keystrokes), and observe existing page highlights. Do not type sensitive investigation notes on an untrusted page expecting closed shadow DOM to guarantee confidentiality. Use a trusted page for sensitive work. Clipboard, downloads, explicit sharing, extension/profile compromise and the outgoing flows below keep their existing limitations. No permission, recipient or network trigger is added.

## Message security boundary

API keys are never transmitted to visited pages or their content scripts through extension messages. Display settings contain only `highlightEnabled` and `detectionMode`; settings-change broadcasts to tabs contain exactly those two fields, not provider credentials or API configuration URLs. A separate detection-policy read supplies local exclusion rules and the page's matching decision to the isolated extension content script for local filtering; it does not insert the rule list into the site's DOM or send it to a provider. Rule management remains reserved to extension pages.

The background checks the Chrome-supplied sender ID and URL before processing messages. This extension's own pages (including the welcome/settings page in an extension tab) can manage settings, bulk history, cache, configuration tests, and correlation. HTTP(S) content scripts are limited to reporting detections, reading pause/display/page-disabled state, looking up IOC and opening pivots, and the panel's single-entry history, note, TLP, and explicit MISP actions. Other senders and unauthorized messages receive an explicit failure before storage, network, or navigation work. A content script cannot save settings, change global pause, or clear history through this message interface. These checks do not remove the panel's documented investigation disclosures or protect against a compromised extension page/browser profile.

## What leaves the browser

### Global transmission pause

The Chrome-only `toggle-global-pause` command uses the same serialized, durable transition as the popup, including without API keys. Assign it at `chrome://extensions/shortcuts`; no default or system-global shortcut is imposed. The toolbar badge and action title reflect confirmed ON/OFF after successful saves and startup restoration. ON means no global pause, not permission to highlight every URL. Command failures keep the last confirmed state and expose a retryable error to the popup (in worker memory only, cleared on success/restart). The command, badge, title and shortcut-settings link add no permissions, recipients or outgoing data.

The background owns a global pause state stored separately as `mustela_paused` in `chrome.storage.local`; absence means ON (`paused: false`). It is independent of highlighting, URL rules, keys, and provider/Analyst Assist preferences. The popup's named global ON/OFF button is separate from URL exclusion, keyboard-accessible, and synchronized to this confirmed state. Failed saves show an error and retry, not an OFF success.

Confirmed OFF is propagated to loaded pages: highlights and detection indicators are removed, panels close, and DOM changes do not restart scanning. Content initialization fails closed until the background confirms ON, including new/reloaded pages and worker restarts. Old panel opens or lookup replies cannot reopen or repopulate panels while paused; an OFF/ON cycle also invalidates pending replies. An unavailable or non-scriptable tab does not prevent notification of the others.

- `GET_PAUSE_STATE` returns the last confirmed state. `SET_PAUSE_STATE` accepts `payload: { paused: boolean }`, serializes transitions, and confirms `{ ok: true, data: { paused } }` only after storage succeeds. A failed write returns an explicit error asking for a retry; no OFF success is announced. Ordinary settings saves cannot change pause.
- After OFF is confirmed, `LOOKUP_IOC` (including reruns/cache paths), `OPEN_EXTERNAL_PROVIDER`, `CORRELATE_IOCS`, `ADD_IOC_TO_MISP`, `TEST_API_KEY`, and investigation/pivot context menus are refused before any new API call or external navigation. This applies with or without keys, to MISP and local LLM endpoints too, and to already-open interfaces. Message refusals have `ok: false`, `code: 'MUSTELA_PAUSED'`, and an explanation; blocked menus notify the originating tab with `MUSTELA_ACTION_BLOCKED`.
- Each new provider/LLM call and pivot is guarded. If pause is confirmed during an outstanding request, later providers and the automatic summary do not start. Shodan key validation also checks before its second (host-probe) request. Provider errors/timeouts do not bypass pause.
- ON preserves previous preferences and existing policies; detection resumes only on permitted pages with highlighting enabled. It never reopens a panel, replays blocked actions, or restarts interrupted investigations. A fresh analyst action is required, even if ON was confirmed before an old response arrived.

Pause does **not** cancel or recall requests already started, promise remote deletion, purge local data, or stop autonomous traffic from a website already opened. Local history, cache, keys, URL exclusions and highlighting preferences are retained, not erased or overwritten. No recipient, Chrome permission, telemetry, or cloud storage is added. The operations below describe ON behavior, subject to this pause and the protected IPv4 policy.

### Direct-action exclusions

Local exact page-URL, normalized exact-IOC and host rules are described in
[Local exclusion rules](EXCLUSION_RULES.md). Manage them without API keys in Settings → Local exclusions; invalid input leaves saved rules unchanged. Saves update loaded pages and open popups, without a browser restart or automatic investigation.
Legacy disabled-page URLs are also effective exclusions for these actions.

- The background checks both the IOC and all available source page URLs:
  `sourceContext.pageUrl`, the Chrome sender's tab/frame URLs, the current URL
  of that tab, and the active tab for popup actions. Any match refuses the action,
  even if another source is allowed. Popup pivots retain their source page.
- Direct investigations from highlights, manual input, history and context menus,
  including cached results and Re-run, cannot bypass a matching rule. No enabled
  provider lookup or automatic Analyst Assist summary starts for an excluded
  action, regardless of valid keys or a pre-existing cached result.
- Every provider-card action is a background-checked button, not an unguarded
  native link. Manual pivots, runtime pivot messages and context-menu pivots also
  check current rules before opening a provider tab, including without API keys.
- MISP lookup, website pivots and explicit Add to MISP have no exclusion exception,
  even for a private/internal instance or a protected IPv4. Exclusion rules take
  precedence over the MISP exception in the protected IPv4 policy below.
- Rules are re-read before each new provider/summary call and navigation, not only
  when rendering UI. A rule added while a request is outstanding prevents later
  calls once observed. Already-started requests cannot be recalled or cancelled.
  Refusals return `ok: false`, `code: 'MUSTELA_EXCLUDED'`, and an IOC/page explanation identifying the matching rule and its explicit removal in settings;
  menus notify the originating tab. Unreadable rules or unavailable tab context
  fail closed rather than authorizing a transmission.
- Repeated clicks do not override a rule. After explicit removal, only new actions
  can proceed under the other existing protections; nothing is automatically sent
  or replayed. Cache/history are not purged by a rule, and previously opened
  websites and remote data are not controlled by it.

Correlation also checks the current source page and filters history as described
below. These guards do not redact arbitrary page/provider text, change
configuration connection tests, or restrict local copy/export. Excluded pages do not scan/highlight; allowed pages omit matching IOC values, including dynamic DOM additions. Saving rules invalidates scans, highlights, stale page detection results and open investigation panels. Removing a rule resumes permitted detection only, not investigations. The popup cannot override exclusions or legacy page pauses; remove them explicitly in settings. No new recipient,
permission, telemetry, or cloud storage is introduced.

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

Investigation scheduling does not add a recipient or new request trigger. Concurrent requests for the same IOC/cache profile reuse one pending investigation (including its optional automatic summary, using the originating investigation's context); explicit Re-run waits for it and starts a fresh investigation. Every caller still checks current exclusions and pause before receiving the shared result. Local history retains each caller's context.

Lookup start intervals default to 15 seconds for VirusTotal and 1 second for Shodan, with a finite, nonnegative `providers.<id>.minIntervalMs` advanced override; AbuseIPDB/MISP default to no added spacing. HTTP 429 blocks that provider's lookups until Retry-After (seconds or HTTP date), or 60 seconds for missing/invalid headers. Provider cards report remaining seconds; these refusals are not cached and do not trigger automatic provider retries. Ordinary interval waits recheck current transmission policy before sending. Confirmed pause discards waiting work, including queued re-runs; resume does not replay it. Already-started requests cannot be recalled.

Pending promises, spacing and cooldown deadlines are in worker memory only and reset when the worker restarts. They do not count daily use or coordinate other clients sharing the key. Connection tests, explicit MISP writes, LLM calls and browser pivots retain their separate existing behavior; scheduling does not impose a new limit on them. The existing 12-second provider network timeout begins at transmission, not during local spacing waits.

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
| Manual external pivot | Destination provider website | Normal browser navigation to the pivot URL | Public-provider pivots embed the IOC in the destination URL; the MISP pivot opens its attribute search page without embedding the IOC | Normal browser/site authentication, if any; no extension API key required | Opening an external pivot |

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

The dedicated correlation action reads current local exclusion rules at the time of the action, including rules added after the popup was displayed and legacy disabled-page URLs. A matching current source page refuses the entire correlation, even with enough allowed history. The check covers the supplied page context and the active tab's current URL.

Before ranking or applying the **10-entry** limit, selection removes whole history entries whose IOC or either stored source page URL matches a current exclusion, as well as protected IPv4 entries. This applies to older investigations too. Remaining entries are prioritized by threat verdict and then recency. Fewer than **2 eligible entries** returns an explicit refusal without an LLM request. Unreadable exclusion rules fail closed; disabled or incomplete Analyst Assist configuration also makes no request.

Only selected entries enter the prompt: excluded entries contribute no IOC, page URL/title or summary. The prompt sends selected IOC/type, verdict, score, tags, `seenCount`, and associated page URL/title when available, plus allowed current-page URL/title if supplied. It does **not** send the entire history or free-form analyst notes. This is entry filtering, not redaction of arbitrary text in allowed entries or current-page context.

Filtering does not delete or rewrite local history. Removing a rule does not replay refused requests; a new analyst action is required. Exclusions do not recall already-started requests or delete data previously sent to an endpoint. No new recipient, Chrome permission or telemetry is added.

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

## Remote code and store disclosures

**No remote code:** executable JavaScript and styles ship in the extension package; Mustela does not download or execute remotely hosted code. Provider/Analyst Assist responses are data, not executable scripts. The extension-page content security policy restricts scripts to self.

[Store listing and data-usage declarations](store/LISTING.md) disclose website content, investigation page URL/title and selected history, and locally stored authentication keys with their optional recipients and triggers. Email IOC and page/provider context can contain personally identifiable information. Mustela does not sell user data, use it for advertising, transfer it for unrelated purposes, or use it for creditworthiness or lending. The optional service requests and explicit sharing actions above still disclose data to recipients under their own policies.

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
