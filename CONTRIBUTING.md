# Contributing

Thanks for considering a contribution. This project is a Chrome MVP for SOC analysts. Contributions are most useful when they come from people who actually use the extension during real analyst work.

## Before you start

- Read [`README.md`](README.md) for the product scope.
- Read [`docs/PRIVACY_TRANSPARENCY.md`](docs/PRIVACY_TRANSPARENCY.md) — privacy posture must stay honest. If a change touches what data leaves the browser, the document must be updated in the same PR.
- For security issues, use [`SECURITY.md`](SECURITY.md). Do **not** open a public issue for vulnerabilities.

## Local setup

```bash
git clone https://github.com/ArmorIntel/mustela.git
cd mustela
npm install
npm test
npm run build
```

Load `dist/chrome` as an unpacked extension in `chrome://extensions` to test manually.

## Branching and commits

- branches: `feat/...`, `fix/...`, `docs/...`, `chore/...`, `refactor/...`, `test/...`
- commit prefixes match the branch type (`feat: ...`, `fix: ...`, `docs: ...`, …)
- never merge with a failing build or failing tests
- when changing extension wiring, include extension smoke checks (manifest/content script/popup structure), not just helper unit tests

Small, focused PRs are preferred over large ones.

## What a good PR looks like

- explains the problem before the solution
- includes tests when the change surface is broad — see existing tests in `tests/`
- updates docs touched by the change
- keeps the extension usable when no API keys are configured
- does not silently broaden permissions; any new permission must be justified in the PR description

## Tests

```bash
npm test                # Node test runner: parsing, providers, storage, popup state, smoke wiring
npm run test:e2e        # Playwright E2E (requires display)
npm run test:e2e:xvfb   # Playwright E2E under xvfb (headless Linux)
npm run verify          # build + npm test + xvfb e2e
```

PRs are expected to pass `npm test`. E2E coverage is encouraged for changes that affect the end-to-end analyst flow.

## Code style

There is no linter today. Match the existing style:

- vanilla JS modules
- prefer small focused functions over clever one-liners
- escape any user-controlled value before inserting it into the DOM
- harden every `fetch` to a third-party provider (`credentials: 'omit'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`, timeout)

## Not in scope for contributions right now

- new third-party providers without an accompanying privacy-posture update
- backend services, telemetry, or analytics
- features that require widening Chrome permissions without a clear analyst-facing benefit

If in doubt, open a discussion or issue before writing code.
