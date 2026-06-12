# Privacy & Transparency

Mustela is a **local-first Chrome extension MVP** for analysts.

This page is intentionally plain: it explains what the extension stores locally, what is sent to third-party providers, and what is **not** claimed.

## Short version

- IOC detection and highlighting happen **inside the browser on the current page**.
- Extension settings, recent history, cache, and disabled-page rules are stored in **`chrome.storage.local` on the local browser profile**.
- If you configure provider API keys and run lookups, the extension sends the IOC value to the provider(s) you enabled.
- The project currently uses these third-party providers:
  - VirusTotal
  - AbuseIPDB
  - Shodan
- There is **no project backend** in this MVP.
- There is **no account system** for this extension.
- There is **no cloud sync or team memory** implemented by this project today.

## What the extension processes

The extension may process the following categories of data while you use it:

- IOC visible on the current web page:
  - IPv4
  - domains
  - URLs
  - MD5 / SHA1 / SHA256
  - subnet and ASN support where implemented
- Basic page context attached to local history entries:
  - page URL
  - page title
- Provider configuration you enter manually:
  - whether a provider is enabled
  - provider API key
- Investigation results returned by enabled providers

## What stays local

The following data is stored locally in `chrome.storage.local` in the browser profile where the extension is installed:

- provider settings and API keys
- highlight preference
- cache TTL preference
- recent investigation history
- cached provider results
- last detected IOC for tab state
- disabled-page rules

In the current MVP, this local storage is used so the extension can:

- remember your provider configuration
- reopen or review recent investigations
- reduce repeated provider calls through cache
- remember pages where highlighting was disabled

## What leaves the browser

Data leaves the browser **only when the extension interacts with an external provider or opens an external pivot**.

### Provider lookups

When a configured provider lookup runs, the relevant IOC value is sent to that provider's API.

Current providers:
- VirusTotal
- AbuseIPDB
- Shodan

Depending on the provider and IOC type, the request may include:
- the IOC value itself
- your API key in the request header or query string, according to the provider's API design

The extension does **not** claim control over how those providers retain, analyze, or reuse submitted data. Their own policies and account terms apply.

### External pivots

If you use a manual external pivot such as “Open in VirusTotal”, “Open in AbuseIPDB”, or “Open in Shodan”, your browser opens the provider site with the IOC embedded in the destination URL.

That means the provider receives the IOC through the normal browser request for that page.

## Network behavior and current safeguards

Current provider fetches are designed to be conservative for an MVP:

- `GET` requests only
- `credentials: 'omit'`
- `cache: 'no-store'`
- `referrerPolicy: 'no-referrer'`
- bounded request timeout in extension code

These are useful safeguards, but they are **not a blanket privacy guarantee**.

## What is not claimed

This repository does **not** currently claim:

- zero data disclosure to third parties
- end-to-end encryption beyond what the provider connection normally uses
- enterprise-grade secret management
- cross-device secure sync
- support for Firefox or non-Chrome browsers
- backend-side anonymization or proxying
- legal compliance coverage for every environment

If you investigate sensitive IOC, assume your enabled provider will see the submitted IOC.

## Operational guidance for users

Before using the extension on sensitive cases, decide whether external provider enrichment is acceptable in your environment.

Recommended operator stance:

- enable only the providers you actually use
- avoid submitting highly sensitive IOC externally if policy forbids it
- clear cache/history when needed from the setup page
- use dedicated provider accounts consistent with your org policy
- review third-party provider terms before production use

## Chrome Web Store / public-release wording guidance

If this extension is published publicly, the store listing and privacy answers should stay aligned with reality:

- mention that IOC may be sent to enabled third-party intelligence providers
- mention that settings, cache, and history are stored locally in the browser
- do not imply the project runs its own backend if it does not
- do not overclaim anonymity, confidentiality, or compliance

## Current maturity statement

This is a **public-facing MVP**, not a fully hardened enterprise product.

The goal today is honest utility for analysts, with transparent trade-offs.
If the implementation changes later, this document should be updated with the code — not as marketing fan fiction.