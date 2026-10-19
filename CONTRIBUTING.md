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

On Debian/Ubuntu, install `xvfb` and `xdotool` for the Linux E2E suite (`sudo apt-get install xvfb xdotool`), then prepare Chromium with `npx playwright install chromium`. Shortcut E2E assigns a key through Chrome's settings and delivers native X11 key events: Playwright/CDP key events alone do not invoke extension accelerators. Run those tests on an isolated display (the xvfb command below), not alongside interactive windows.

```bash
npm test                # Node test runner: parsing, providers, storage, popup state, smoke wiring
npm run test:e2e        # Playwright E2E (requires display)
npm run test:e2e:xvfb   # Playwright E2E under xvfb (headless Linux)
npm run verify          # build + npm test + xvfb e2e
```

PRs are expected to pass `npm test`. E2E coverage is encouraged for changes that affect the end-to-end analyst flow.

When testing external provider pivots, observe `chrome.tabs.onCreated` before clicking and assert the new tab's `pendingUrl` (or committed `url`), then remove the tab by ID. Keep the real extension message and tab creation paths. A newly created tab's Playwright `page` event can wait for the initial navigation response; provider latency, outages or WAF challenges must not determine whether a pivot test passes.

### Generated IOC runtime

`npm test` regenerates the expected IOC runtime in memory and compares its exact bytes
with both `src/shared/ioc.content-runtime.js` in the working tree and its Git index blob.
It never repairs files or changes the index. Git and a staged runtime are required;
missing files or an unavailable index fail explicitly. Checking the index prevents a
preceding build from hiding a stale runtime in a commit (including in CI).

After editing `src/shared/ioc.js`, regenerate and stage both files before validating:

```bash
npm run build
git add src/shared/ioc.js src/shared/ioc.content-runtime.js
npm test
```

Commit both files together. Running build alone only repairs the working tree, not
the index, so the freshness check will still fail until the correct runtime is staged.

## Performance

Run `npm run bench` with Node (no additional dependencies). Every PR touching the
scan or parser must attach its bench output to the PR description. Timings describe
this machine, not a browser latency guarantee.

`npm test` uses the same synthetic fixtures and measurement helpers:

- Parser: dense 200,000-character log, no-IOC text, repeated `a.` / `1.` tokens,
  and minified JSON. Input grows from 12,500 to 200,000 characters (16×).
  The median per-call cost may grow at most 48×: linear growth × a 3× CI margin.
  Both sizes are warmed, short calls are batched above clock noise, and seven
  alternating samples are taken. There is no absolute millisecond pass/fail limit.
  Quadratic work (approximately 256×) must fail with `Performance budget exceeded`.
- Scan: a 20,000-text-node no-IOC page must visit/parse at most 1,500 nodes per
  scan, pass at most 8,192 characters per text node to the parser, retain no IOC,
  and publish the unchanged empty result only once across two scans. Node uses
  a minimal DOM adapter and the shipped scan; real DOM behavior, yielding and
  idle/live-stream behavior remain covered by the scanning E2E suite.
- Storage: 16 identical 500-IOC lists produce one session write and zero local
  (disk-backed) writes, while preserving all restored indicators.
- Popup: the history summary reads at most eight recent entries and displays
  at most five, independently of total history size (1,250 versus 20,000).

Scan/storage/popup use deterministic work counts rather than scheduler-sensitive
wall time. Bench also prints their durations for diagnosis. These checks do not
measure browser heap usage, layout or popup paint latency; use E2E for those flows.
When changing budgets, justify the workload and complexity bound rather than
raising a threshold until a regression passes. Validate timing stability with ten
consecutive `npm test` runs on the supported Node versions (including CI Node 20).

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
