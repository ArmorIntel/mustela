# Static landing preparation

This is a single test fixture, not the published website or the final interactive experience. It lives outside `docs/`, has no link from the current site and is not deployed by a preview workflow. `docs/index.html` remains unchanged.

The shell preserves the approved dark composition, section order, system typography, existing logo and local assets. There are no remote fonts or runtime scripts. Artwork placeholders and the static incident report deliberately do not claim to provide working investigation controls. Guided playback, the investigation panel and narrative artwork are separate integration steps.

`landing.css` owns page composition; `demo.css` owns only the scoped demonstration layout. Every selector is rooted in `.landing`; demo selectors also require `.demo-shell`. No extension CSS, light theme or unused legacy rules are imported.

Run `npm run test:e2e -- tests/e2e/landing-shell.spec.js` for the shell, or `npm run verify` for full validation. The test server exposes only this fixture and its assets under `/mustela/` on an ephemeral loopback port. The HTTP tests cover desktop 1440×900, tablet 768×1024, touch-enabled mobile 390×844 and reduced motion. Screenshots are named `shell-*-not-final.png` in the Playwright test outputs.

Tests check section order, local resources, internal links, metadata, overflow, keyboard skip/focus and installation navigation. Text contrast is measured from computed colors and composite ancestor backgrounds. For the light indicator gradient, the opaque base is a conservative lower bound; its white overlays increase contrast with the dark label. The opaque fallback is also exercised. These shell checks are not a claim of final-site accessibility compliance or physical-device performance. A physical phone has not been tested.

Privacy copy identifies configured providers, MISP, external pivots, automatic optional AI summaries and dedicated correlation. Installation uses the existing release ZIP/Load unpacked route, not a proposed Store listing. No extension data flows or permissions change.
