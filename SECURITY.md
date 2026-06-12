# Security policy

Mustela is a Chrome MVP for analysts. Security reports are taken seriously and handled privately.

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security reports.

Use [GitHub Security Advisories](https://github.com/ArmorIntel/mustela/security/advisories/new) to report a vulnerability privately. This routes the report directly to the maintainers without disclosing it publicly.

When reporting, include enough information to reproduce the issue:

- affected version (Chrome extension version, commit hash, or branch)
- Chrome version and OS
- a minimal reproduction (page content, IOC value, configured providers, steps)
- the impact you observed and what you believe an attacker could do
- any suggested mitigation

## Scope

In scope:

- the Chrome extension code in this repository
- the provider integration code that talks to VirusTotal, AbuseIPDB, and Shodan
- the local storage / cache / history layer (`chrome.storage.local`)
- the content script DOM handling, including potential XSS or content-script confusion
- the packaging scripts in `scripts/`

Out of scope:

- vulnerabilities in the third-party provider APIs themselves (VirusTotal, AbuseIPDB, Shodan)
- vulnerabilities in Chrome / Chromium / V8
- social-engineering or physical-access scenarios that already imply local profile compromise
- denial of service through abusive page content that simply makes detection slow

## What to expect

- acknowledgement of the report as soon as the advisory is read
- a status update within a reasonable delay while the issue is investigated
- a coordinated disclosure timeline that lets users update before public details are published
- credit in the release notes for the reporter, when desired

## Trust posture

This is a public, volunteer-maintained MVP. There is no SLA, no bug bounty, and no enterprise support contract attached to this repository. The intent is honest, timely handling of security reports — not a paid program.

See also:

- [`docs/PRIVACY_TRANSPARENCY.md`](docs/PRIVACY_TRANSPARENCY.md) — what the extension stores locally and what is sent to third-party providers.
