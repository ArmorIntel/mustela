# Store listing and privacy declarations

Copy the sections below into the corresponding Chrome Web Store and Microsoft Edge Add-ons fields. These are submission copy, not evidence of store approval or Edge compatibility testing. The current supported/tested browser is Chrome 105 or later; validate an Edge candidate before publishing it. Permission justifications are in [PERMISSIONS.md](PERMISSIONS.md). The [privacy policy](../PRIVACY_TRANSPARENCY.md) describes the full flows and limitations.

## Name

Mustela

## Short description

Detect and investigate IOC values from any page.

## Detailed description

Investigate indicators of compromise without losing your page context. Mustela is a local-first browser extension for SOC analysts: it detects and highlights supported IP addresses, domains, URLs, email addresses and file hashes on ordinary HTTP(S) pages, including supported defanged indicators.

Open an in-page investigation panel or enter an indicator manually. Keep recent investigations, notes and manual TLP sharing labels in your browser profile, copy or export results, and generate a Defender KQL query locally. Detection, highlighting and local tools work without API keys. Detection itself does not contact intelligence providers or navigate to an indicator.

Optional enrichment connects to enabled, configured VirusTotal, AbuseIPDB, Shodan and your chosen MISP instance where the indicator type is supported. A dedicated Add to MISP action can create an attribute in an event you choose; lookups do not add attributes automatically. Explicit website pivots can send an indicator to the destination even without API keys.

Optional Analyst Assist connects to your chosen local or remote OpenAI-compatible endpoint. Once enabled and fully configured, an uncached eligible investigation automatically sends a summary prompt containing the indicator, provider summaries and available page URL/title; no separate AI click is required. A dedicated correlation action can send 2–10 eligible recent investigation entries and available current-page context. MISP and Analyst Assist are disabled by default.

Use global transmission pause and local page/indicator/host exclusions to control new investigations and pivots. Protected literal IPv4 ranges block public-provider and Analyst Assist flows, but configured MISP can still receive those indicators. These controls do not recall requests already started or delete data at recipients. TLP labels are sharing guidance, not network controls.

Settings, keys, history, notes and cached results remain stored in this browser profile, not cloud-synced. Local storage is not a promise of zero transmission: configured integrations and explicit sharing actions can disclose investigation data. There is no project backend, telemetry, analytics or extension account system. Review the privacy policy and your recipients' policies before investigating sensitive material. Provider coverage varies; a missing result is not a clean verdict. Mustela is a public-facing MVP, not an enterprise confidentiality or compliance guarantee.

## Proposed categories

Chrome Web Store: Tools.
Microsoft Edge Add-ons: Productivity.

## Language

English (en)

## Single purpose

Help SOC analysts detect indicators of compromise on web pages and investigate those indicators in context using local investigation tools and optional threat-intelligence integrations.

## Privacy policy URL

https://github.com/ArmorIntel/mustela/blob/next/docs/PRIVACY_TRANSPARENCY.md

## Support URL

https://github.com/ArmorIntel/mustela/issues

## Edge keywords

SOC, threat intelligence, IOC, investigation, cybersecurity, MISP, incident response

## Data usage

Declare processing and optional transmission rather than answering that no data is handled merely because the project has no backend. For Chrome, disclose **Website content**, **Web history**, and **Authentication information**. Where the portal asks about personally identifiable information, also disclose **Personally identifiable information** for email IOC and potentially identifying page context. Use the corresponding Edge data categories and the explanations below; do not claim that optional transmissions are absent. Page URL/title means context of pages used for investigations, not a read of the browser's complete browsing-history database.

All categories below serve the single purpose above. Detection and local tools remain usable without integrations or keys. Integration/API-key configuration and external pivots are optional; authenticated connection tests are network actions even before enabling an integration. Public-provider API calls require an enabled/configured provider supporting the IOC type. MISP and Analyst Assist require opt-in configuration. Global pause, exclusions and protected IPv4 checks constrain flows as detailed in the policy, but are not arbitrary-text redaction.

| Category / data | Recipient | Trigger | Optionality and local handling |
| --- | --- | --- | --- |
| Website content: detected or entered IOC, including supported email addresses | Local browser profile during detection/investigation; VirusTotal, AbuseIPDB or Shodan for supported lookups | Detection is local; an eligible investigation not served from cache (including Re-run) starts configured provider lookups | Provider enrichment is optional and needs keys. Detection does not upload the full page. Email IOC have no compatible public-provider lookup or pivot. |
| Website content: IOC/type; submitted MISP attribute metadata, comment, event ID and classified TLP tag | The MISP instance configured by the user | Configured lookup searches existing attributes; the separate explicit Add to MISP action creates an attribute; connection test contacts the instance without an investigation IOC | MISP is disabled by default and requires base URL/key; adding also needs a target event. Notes stay local unless the user explicitly submits text as an add comment. |
| Website content: IOC/type, scores, tags, recommendations and provider summaries/errors (including MISP context) | The user's local or remote OpenAI-compatible Analyst Assist endpoint | Automatic summary during an eligible uncached investigation once enabled/configured, even if some providers fail; no distinct AI click | Disabled by default; requires endpoint, key and model. Not the full page, raw MISP dataset, free-form analyst notes or provider API keys. Email IOC may be sent. |
| Web history: investigation page URL/title; selected investigation-history IOC/type, verdict, score, tags and occurrence counts | The configured Analyst Assist endpoint | Available source URL/title enters automatic summaries. Dedicated correlation sends 2–10 eligible selected history entries with their available URL/title and supplied current-page context | Analyst Assist is optional and disabled by default. History is stored locally; correlation filters excluded/protected entries before ranking and limiting. It does not send the complete history or analyst notes. |
| Website content / web history: IOC embedded in a public-provider pivot URL; MISP search-page navigation | Destination provider website (VirusTotal, AbuseIPDB, Shodan or configured MISP, where supported) | Explicit external pivot opens a browser tab | Optional and may work without API keys. Public-provider pivots embed the IOC; the MISP pivot opens its attribute search page without embedding the IOC. Normal website cookies, authentication and network behavior apply, unlike extension API fetch safeguards. An IOC that is a URL itself discloses that URL on a public-provider pivot. |
| Authentication information: user-supplied API keys | The matching VirusTotal, AbuseIPDB, Shodan API, chosen MISP instance or chosen Analyst Assist endpoint, never a project backend | Authenticated configuration tests and the configured lookup, add, summary or correlation requests above | Optional; stored in chrome.storage.local, not cloud-synced or sent to visited pages. Keys authenticate their own service, not the LLM prompt. Shodan uses a key query parameter; other integrations use headers. No enterprise secret-management claim. |
| Personally identifiable information: email IOC and potentially identifying URL/title or provider text | Local profile, and the eligible recipients in the applicable rows above; email IOC can reach Analyst Assist but not public-provider/MISP lookup/add/pivots | Local detection or the same configured investigation/summary, explicit correlation or sharing actions described above | Not an account-registration feature. Integrations are optional; arbitrary sensitive text is not automatically redacted. Review content and recipient before enabling or sharing. |

Local copy/export is explicit and can include IOC, notes, TLP and investigation results; whoever receives a file or pasted text receives that content. Exports omit provider configuration/API keys. Copy Defender KQL only writes a locally generated query to the clipboard, not to Microsoft. Local deletion does not remove exports or data already sent to another service. Detected tab IOC/context use memory-only chrome.storage.session until navigation/tab closure; investigation history, settings and cache use chrome.storage.local.

There is **no project backend, telemetry, analytics, extension account system or project cloud sync**. Mustela does not sell user data, use it for advertising, transfer it for purposes unrelated to the single purpose, or use it to determine creditworthiness or for lending. User-configured service requests and explicit pivots are the disclosures described above, not a promise that third parties receive nothing. Recipients control their own retention and reuse; review their policies. API fetches omit browser cookies and referrers and use no-store and bounded timeouts; opened websites do not inherit these safeguards.

## Reproducible artwork

The committed [store assets](assets/) are generated from synthetic fixtures and the actual built extension, not a hand-drawn imitation of its UI:

| Asset | Dimensions | Scene |
| --- | --- | --- |
| [01-highlights.png](assets/01-highlights.png) | 1280×800 | Reserved IPs, example domain/URL and a fabricated hash highlighted in a training report |
| [02-investigation.png](assets/02-investigation.png) | 1280×800 | In-page investigation with honest keyless/unknown results |
| [03-popup-history.png](assets/03-popup-history.png) | 1280×800 | Current-page list and local history, shown as two cropped views of the same popup |
| [04-settings.png](assets/04-settings.png) | 1280×800 | Provider settings with every API-key field empty |
| [05-global-pause.png](assets/05-global-pause.png) | 1280×800 | Real ON and confirmed OFF states side by side |
| [promo-small.png](assets/promo-small.png) | 440×280 | Small promotional tile |

Regenerate on Linux from the repository root with Node.js, npm and `xvfb` installed:

```sh
npm ci
npx playwright install chromium
npm run store:assets
npm test
```

No additional npm dependency is needed. Other platforms can run `npm run build && node scripts/generate-store-assets.mjs` with a graphical display. The generator uses a disposable browser profile; it never reads your everyday browser data. Only `https://report.example.org/brief` is served, directly from the dedicated fixture; other web requests are blocked and service-worker fetches fail closed. No API key is configured and no provider results are fabricated. The fixture history is explicitly synthetic. The artwork follows the existing surfaces described in [DESIGN.md](../../DESIGN.md).

Animations/transitions and carets are disabled, popup time is fixed and capture waits for fonts, scene readiness and stable popup pixels. With the same Playwright Chromium build, OS and fonts, repeated runs produce identical PNGs. Cross-platform/font changes can change pixels: review all six images before publishing. `npm test` checks the exact PNG signature/IHDR dimensions and the report's synthetic indicator set without an image-library dependency. The committed PNGs are tested without launching a browser.

## Remote code

**No remote code.** Executable JavaScript and styles are packaged with the extension. It does not download or execute remotely hosted code. Provider and Analyst Assist responses are data, not executable scripts; an LLM request does not fetch executable code. The extension-page content security policy restricts scripts to self. Configuration URLs select data/API destinations, not code sources.
