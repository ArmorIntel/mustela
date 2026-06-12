# Mustela

[![CI](https://github.com/ArmorIntel/mustela/actions/workflows/ci.yml/badge.svg)](https://github.com/ArmorIntel/mustela/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](manifest/chrome.manifest.json)

**Mustela** is a Chrome extension for SOC analysts who want to investigate indicators of compromise (IOC) directly from the page they are already working on.

Instead of copying IPs, domains, URLs, and hashes across multiple tabs, Mustela highlights IOC on the page and gives you fast investigation actions in context.

> Named after *Mustela*, the weasel genus — small, fast, and very good at hunting.

## Why this exists

SOC workflows are full of repetitive pivots:

- copy an IOC from a SIEM, ticket, email, or CTI report
- open VirusTotal, AbuseIPDB, or Shodan
- paste the indicator
- correlate the result manually

Mustela reduces that friction and keeps the investigation loop inside the browser.

## Features

- **Detect IOC directly on a page**: IPv4, subnets, ASN, domains, URLs, MD5 / SHA1 / SHA256
- **Highlight detected IOC** without breaking the host page
- **In-page investigation panel** with one click on any highlighted IOC
- **Aggregated provider verdicts** (VirusTotal, AbuseIPDB, Shodan) in a single analyst-friendly view
- **Quick external pivots** to open an IOC on the provider's own site
- **Manual lookup** of any IOC from the popup or the in-page panel
- **Local history, cache, and analyst notes** — everything stays in your browser
- **Context-menu lookup** for selected text
- **Per-page disable toggle** for pages where highlighting gets in the way

Everything runs locally in the browser. The only network calls are the lookups you explicitly enable toward the providers you configure.

## Screenshots

**IOC detected and highlighted directly on the page:**

![IOC highlighted on a page](docs/screenshots/01-page-highlights.png)

**One click on a highlight opens the in-page investigation panel:**

![In-page investigation panel](docs/screenshots/02-page-panel.png)

**The popup summarizes the current page, offers manual lookup, and keeps your recent investigations:**

<img src="docs/screenshots/03-popup-history.png" alt="Popup with current-page summary and history" width="380">

## Installation

### Prerequisites

- [Google Chrome](https://www.google.com/chrome/) (or any Chromium-based browser supporting Manifest V3)
- [Node.js](https://nodejs.org/) 18 or newer (only needed to build; `npm` is included)
- [Git](https://git-scm.com/)

### Step 1 — Get the code and build

```bash
git clone https://github.com/ArmorIntel/mustela.git
cd mustela
npm install
npm run build
```

The build output lands in `dist/chrome`.

### Step 2 — Load the extension in Chrome

1. Open `chrome://extensions` in Chrome
2. Turn on **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `dist/chrome` folder inside the project

That's it — the Mustela icon appears in your toolbar and a welcome page opens to guide you through setup.

### Step 3 (optional) — Add provider API keys

Mustela works out of the box for detection, highlighting, and external pivots. To get enriched verdicts inside the panel, add free API keys on the extension's setup page (right-click the Mustela icon → **Options**):

| Provider | Free key | Used for |
|---|---|---|
| [VirusTotal](https://www.virustotal.com/gui/my-apikey) | Yes (account required) | File hashes, domains, URLs, IPs |
| [AbuseIPDB](https://www.abuseipdb.com/account/api) | Yes (account required) | IP reputation |
| [Shodan](https://account.shodan.io/) | Yes (account required) | Exposed-service context for IPs |

If a provider is not configured, Mustela stays fully usable and still offers external pivots.

## Usage

1. Open any page containing indicators (SIEM, ticket, CTI report, email…)
2. Mustela detects and highlights IOC automatically
3. Click a highlighted IOC to open the investigation panel
4. Review the consolidated verdict, add a local analyst note, or export the result as JSON
5. Pivot to the provider's site only when you need deeper context

You can also select any text on a page and use the right-click context menu, or paste an IOC into the popup for a manual lookup.

## Privacy and trust posture

Mustela is intentionally transparent about its trade-offs:

- IOC detection and highlighting run **locally in the browser**
- Settings, cache, history, notes, and disabled-page rules are stored in `chrome.storage.local`
- Configured provider lookups send the IOC to the enabled third-party provider — and only then
- There is **no backend, no telemetry, no analytics, no account system**

If you investigate sensitive IOC, assume the enabled provider will see that IOC. Full details in [`docs/PRIVACY_TRANSPARENCY.md`](docs/PRIVACY_TRANSPARENCY.md).

## Development

```bash
npm install         # install dev dependencies
npm test            # fast Node test suite (parsing, providers, storage, popup state, smoke checks)
npm run build       # build the extension into dist/chrome
npm run test:e2e    # Playwright end-to-end suite (requires a display)
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for conventions and what a good PR looks like. Security reports go through [`SECURITY.md`](SECURITY.md) — please do not open public issues for vulnerabilities.

## Current status

Mustela is a **Chrome MVP**. Firefox support, backend services, shared team memory, and advanced automation are not implemented and not claimed. Near-term priorities: stronger detection quality, fewer false positives, better investigation UX, and more robust provider handling.

## Contributing

Issues and feedback are welcome, especially from people who work in SOC operations, CTI, incident response, or threat hunting. If you test Mustela on real analyst workflows, that feedback is more valuable than theoretical architecture debates. As is tradition.

## License

[MIT](LICENSE)
