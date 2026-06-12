# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-12

Initial public release, under the name **Mustela**.

### Added
- Content-script IOC detection and highlighting (IPv4, subnet, ASN, domain, URL, MD5/SHA1/SHA256).
- In-page investigation panel with aggregated provider verdicts and local analyst notes.
- Popup with current-page summary, manual lookup, recent history, and pinning.
- Provider integrations for VirusTotal, AbuseIPDB, and Shodan with hardened fetch options (`credentials: 'omit'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`, bounded timeout).
- Manual external pivots to VirusTotal, AbuseIPDB, and Shodan.
- Context-menu lookup for selected text.
- Local storage of settings, cache, history, and disabled-page rules (`chrome.storage.local` only — no backend, no telemetry).
- Welcome/setup page for provider configuration and storage hygiene.
- Explicit Manifest V3 `content_security_policy.extension_pages` declaration.
- Node test suite and Playwright E2E harness covering analyst-facing flows.
- CI workflow running the Node test suite on push and pull requests.
- Community files: `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
