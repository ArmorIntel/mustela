# Store permission justifications

Copy the text below each permission heading into the corresponding Chrome Web Store or Microsoft Edge Add-ons justification field. Each text is at most 1,000 characters. The headings mirror the manifest exactly; `npm test` checks coverage, obsolete entries and length.

Mustela requires Chrome 105 or later for the CSS Custom Highlight API. Broad HTTP(S) access is intentional and requires store review: automatic local detection must work on arbitrary analyst pages, not just a fixed list of sites. Access does not mean all page content is uploaded. See [Privacy and transparency](../PRIVACY_TRANSPARENCY.md) for configured integrations, automatic summaries and explicit sharing actions.

## permissions: `storage`

Mustela uses chrome.storage.local on this browser profile for preferences, API configuration, investigation history, notes, sharing labels, exclusions and cached results. Detected page indicators and their page context use chrome.storage.session in memory and are cleared on navigation or tab closure. Mustela does not use cloud sync, telemetry or a project backend. Detection and local investigation remain available without API keys.

## permissions: `contextMenus`

Mustela adds selection context-menu actions to investigate an indicator in the page panel or open it in VirusTotal, AbuseIPDB or Shodan. These actions let analysts investigate selected text without copying it into another tool. External pivots are user-triggered and respect current exclusion and transmission-pause checks.

## permissions: `scripting`

Mustela checks whether its content script is present when an HTTP(S) tab finishes loading. If it is missing, Mustela injects its packaged IOC detection script, shared parser and stylesheet to restore in-page detection and investigation. This uses chrome.scripting.executeScript and insertCSS; no remote code is downloaded or executed. Host access is limited to the HTTP(S) schemes declared in the manifest.

## host_permissions: `http://*/*`

Mustela detects and highlights indicators locally on arbitrary HTTP pages, including analyst consoles and internal tools whose hosts cannot be listed in advance. Access also supports restoring the packaged content script and reading page URL/title for investigation context and exclusion checks. Configured HTTP MISP or OpenAI-compatible endpoints can receive investigation data as described in the privacy documentation. Detection itself does not upload page contents; optional integrations and external actions can send indicators and page context. Global pause and page/IOC exclusions remain available.

## host_permissions: `https://*/*`

Mustela detects and highlights indicators locally on arbitrary HTTPS pages, including analyst consoles and reports whose hosts cannot be listed in advance. Access also supports restoring the packaged content script and reading page URL/title for investigation context and exclusion checks. It covers requests to VirusTotal, AbuseIPDB and Shodan and user-configured HTTPS MISP or OpenAI-compatible endpoints. Detection itself does not upload page contents; optional integrations and external actions can send indicators and page context as described in the privacy documentation. Global pause and page/IOC exclusions remain available.
