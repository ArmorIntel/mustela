# Isolated landing preparation

This single test fixture is not the published website or the final experience. It lives outside `docs/`, has no link from the current site and is not deployed by a preview workflow. `docs/index.html` remains unchanged. Narrative artwork is reserved for the next integration step.

The shell preserves the approved dark composition, section order, system typography, existing logo and local assets. `landing.css` owns page composition; `demo.css` owns the scoped demonstration. Every selector is rooted in `.landing`. No extension CSS, light theme, remote fonts or unused legacy rules are imported.

## Offline investigation

The panel uses a documentation IP and reserved example domain. Scores, source data, recommendations and AI output are explicitly fictional. IP examples contain VirusTotal, AbuseIPDB, Shodan context and internal MISP evidence; domain examples contain only VirusTotal and MISP. No provider, MISP or model is called. The MISP action only explains the real extension's configuration requirement.

`demo-state.js` contains provider fixtures and a guide with one cancellable timer. Cursor, loading, verdict, evidence and actions appear in sequence. Offscreen/hidden/reduced-motion suspension retains elapsed time. Explicit pause survives environmental changes; only Replay resets progress. Pointer, focus, keyboard and note input transfer ownership immediately. Manual results are synchronous, so no delayed load, scroll or note writer can reopen a closed panel or overwrite a choice. Reduced motion leaves manual access available without opening a panel automatically.

Notes remain in memory per indicator for the page session. DOM content uses text nodes and textarea values, not HTML interpolation. Download JSON creates a real local file with the fictional disclaimer and provider evidence. Copy reports success only after a successful clipboard write; refusal or an insecure context offers a selectable readonly field and JSON download. Late copy completion cannot overwrite status after selection, note editing or closure.

## Validation

Run `npm run test:e2e -- tests/e2e/landing-shell.spec.js tests/e2e/landing-demo.spec.js`, or `npm run verify` for full validation. The server exposes only explicit fixture assets under `/mustela/` on an ephemeral loopback port. Tests cover 1440×900 desktop, 768×1024 tablet, 390×844 touch-enabled mobile and reduced motion, with screenshots in Playwright outputs.

Shell tests retain section order, local resources, internal links, metadata, overflow, skip/focus and installation checks. Panel tests exercise both IOC types, literal long notes, real JSON parsing, clipboard failure/success, source disclosure, keyboard/touch, interruption and combined lifecycle changes. Unit tests use a deterministic scheduler to verify timer cancellation and remaining-time preservation.

Text contrast is measured from computed colors and composite ancestor backgrounds on the open panel and shell, including opaque fallback surfaces. White indicator-gradient overlays increase contrast with the dark label; its opaque base is the conservative minimum. These checks are not final-site accessibility certification or physical-device performance measurements. A physical phone has not been tested.

Privacy copy identifies configured providers, MISP, external pivots, automatic optional AI summaries and dedicated correlation. Installation uses the existing release ZIP/Load unpacked route, not a proposed Store listing. No extension data flows or permissions change.
