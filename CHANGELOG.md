# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Root `AGENTS.md` entry point for AI-assisted contributions, covering product context, privacy guardrails, code navigation, validation, and maintainer-owned publication.

### Fixed
- Align privacy documentation, README, and public-site wording with MISP requests, automatic Analyst Assist summaries, selected-history correlation, and local LLM-response storage. No runtime behavior or permissions changed.

### Security
- Update the locked CRX packaging dependency `protocol-buffers-schema` from 3.6.0 to 3.6.1 to fix prototype pollution (GHSA-j452-xhg8-qg39), with a parser regression test. Extension permissions and outgoing data are unchanged.

## [0.3.0] - 2026-09-20

Analyst Assist (LLM), MISP connector, and a build-free installation path.

### Added
- **MISP connector** — lookup against a self-hosted instance via `/attributes/restSearch` (IPs search both `ip-src` and `ip-dst`), and `Add to MISP` from the investigation panel via `/attributes/add/{eventId}`. Supports IP, domain, URL, MD5, SHA1, SHA256. Treated as an internal provider and excluded from external pivot links.
- **Analyst Assist** (`src/integrations/assistants.js`) — optional LLM-generated investigation summaries: one-sentence verdict plus a recommended next action per IOC, through any OpenAI-compatible endpoint (Anthropic, OpenAI, Ollama, ...).
- **Page context in prompts** — `pageUrl` and `pageTitle` are injected into the summary prompt so the recommended action fits the analyst's actual context (a SIEM alert versus a threat report).
- **Provider conflict detection** — disagreement across providers (for example VirusTotal malicious while AbuseIPDB is clean) is surfaced as `providerConflict`, and the model is asked to resolve the discrepancy rather than return a generic step.
- **Cross-IOC correlation** — `generateCorrelationAnalysis` and the `CORRELATE_IOCS` background handler identify 1-3 patterns across up to 10 history entries (shared ASN, campaign indicators, infrastructure overlap), return a `likely related` / `possibly related` / `independent` verdict, and suggest the most impactful next step. Exposed as a `Correlate with AI` button in the popup history section, disabled with a contextual tooltip when fewer than 2 entries exist or no LLM is configured.
- **Release workflow** (`.github/workflows/release.yml`) — pushing a `vX.Y.Z` tag builds the extension, packs the Chrome zip, and publishes a GitHub Release with install instructions.
- **`install.sh`** — one-liner install for users with Git and Node, building from source automatically.
- README coverage for the three installation options, per-provider setup, the MISP connector, LLM configuration with a model recommendation table, and an expanded FAQ.
- Landing page (`docs/index.html`) rewritten around the Detect / Investigate / Keep the trace workflow, with an Analyst Assist section and an in-page IOC mock.

### Changed
- `max_tokens` for investigation summaries raised from 220 to 300 to fit the enriched output.
- `pack-zip.mjs` reads the version from `package.json` instead of hardcoding it.
- Node test suite grown from 40 to 74 tests, covering the MISP connector and Analyst Assist.

### Fixed
- Domain false positives: strings whose single TLD-like segment exceeds 11 characters (for example `firstname.lastname`) are no longer detected as domains.
- `SELECT`, `OPTION` and `OPTGROUP` added to `SKIP_TAGS`, so the content script no longer injects highlight spans inside native select controls and break dropdown selection.
- A stale service worker returning `Unknown message type` now produces an actionable hint pointing to `chrome://extensions` for a reload, instead of a cryptic error. The error string also names the unhandled message type.

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
