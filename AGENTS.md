# Agent contribution guide

Mustela is a Chrome Manifest V3 extension for SOC analysts: it detects and highlights indicators of compromise (IOC) on web pages and supports investigation in context. Start with [README.md](README.md) for product scope. Read this guide explicitly if your agent does not discover it; automatic discovery is not universal.

## Guardrails

- Keep Mustela local-first: no project backend, telemetry, analytics, extension account system, or cloud sync.
- Preserve detection, highlighting, and investigation pivots without API keys; provider enrichment and Analyst Assist are optional.
- Keep Chrome permissions minimal. Any expansion needs a clear analyst-facing benefit and justification in the PR description.
- If a change affects what data leaves the browser, update [docs/PRIVACY_TRANSPARENCY.md](docs/PRIVACY_TRANSPARENCY.md) in the same PR, including when adding a provider. Local-first does not mean zero disclosure: configured providers, MISP, Analyst Assist, and external pivots can receive data.
- Follow [CONTRIBUTING.md — Code style](CONTRIBUTING.md#code-style) for DOM escaping of user/page-controlled values and hardened third-party fetches (credentials omitted, no cache or referrer, bounded timeout). Do not introduce unescaped DOM insertion or weaken network safeguards.

## Code map

| Path | Purpose |
| --- | --- |
| `src/background/` | Extension service worker and message handling |
| `src/content/` | In-page highlighting, investigation UI, and CSS |
| `src/popup/` | Toolbar popup and popup state |
| `src/providers/providers.js` | VirusTotal, AbuseIPDB, Shodan, and MISP integrations |
| `src/integrations/assistants.js` | Optional Analyst Assist LLM integration |
| `src/storage/` | Local browser storage |
| `src/shared/ioc.js` | IOC detection and normalization |
| `src/welcome/` | Welcome/setup page |
| `manifest/chrome.manifest.json` | Chrome MV3 manifest |
| `tests/` | Node tests, Playwright E2E tests, and fixtures |
| `docs/` | Privacy documentation and public site |

`src/shared/ioc.content-runtime.js` is generated: never edit it by hand. Modify `src/shared/ioc.js`, run `npm run build`, and commit both source and generated runtime when they change.

## Development and validation

Run from the repository root with Node.js and npm. The current [CI workflow](.github/workflows/ci.yml) uses Node 20.

```bash
npm ci                         # install locked dependencies
npm run build                  # build into dist/chrome; regenerate IOC runtime
npm test                       # fast Node tests
```

For end-to-end analyst flows, prepare Chromium and run E2E. On Linux, the following commands require `xvfb`:

```bash
npx playwright install chromium # prepare the E2E browser
npm run test:e2e:xvfb            # build + Playwright E2E under xvfb
npm run verify                  # full validation: build + Node tests + xvfb E2E
```

Build and Node tests are the quick checks, not a substitute for E2E when analyst flows change. See [CONTRIBUTING.md — Tests](CONTRIBUTING.md#tests) for coverage expectations. Report exactly what ran and what did not.

## Contribution and publication

Keep PRs small and focused. Write code, commits, PR descriptions, and repository docs in English. Use [CONTRIBUTING.md](CONTRIBUTING.md) for [branching and commits](CONTRIBUTING.md#branching-and-commits), [PR expectations](CONTRIBUTING.md#what-a-good-pr-looks-like), and [style](CONTRIBUTING.md#code-style); fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) honestly rather than duplicating its checklist here.

Agents may push contribution branches and open PRs. Agents must never push to `main`, merge PRs, or create or push tags. Pushing a `v*` tag triggers the [release workflow](.github/workflows/release.yml) and publishes a release. The maintainer owns merges and releases.
