# Existing-interface audit

Reference: [DESIGN.md](../DESIGN.md), including its source shorthand and commit. Documentation only; no fixes applied.

## Coverage and evidence

Chromium loaded the built extension with the existing [E2E harness](../tests/e2e/support/extensionHarness.js), no keys. Inspected synthetic `iocs.html`/`many-iocs.html`: popup 340px, seven-item expansion, invalid manual input, Paused/re-enabled page; panel on explicit white and `#0f172a` backgrounds, empty manual search and keyless setup messages; welcome 1440×900 and save toast; site 1440×900 and 390×844, normal/reduced motion. Captures were examined; UI is unchanged.

Synthetic success, limited access and timeout results were inserted through existing `setCachedResult` and rendered through real panel messages/handlers. They demonstrate rendering only, not elapsed network timeouts or live intelligence. External requests were blocked during inspection; site fonts fell back. Existing unit tests separately mock provider/assistant responses. Full `npm run verify`: build, 75 unit tests and 10 E2E tests passed; standard E2E includes external-pivot navigation.

Keyboard inspection: Tab skips highlights; native site brand link gains a visible outline; manual fields have no focus outline/shadow; Escape does not close panel. Copyable keyboard handlers are source-verified; E2E verifies note/export, pin/reopen and settings flows. No screen-reader session, exhaustive focus-order check, real SIEM integration or full contrast sweep was performed. No global WCAG conformance claim.

## Priorities

Severity reflects investigation obstruction, not a certification score. All rows are confirmed defects unless marked otherwise.

| Priority / surface / source | Reproduction, finding and impact | Future direction |
| --- | --- | --- |
| High · C `highlightNode`, `renderPanelSkeleton`, `closePanel` | Tab on fixture skips click-only spans (`tabIndex=-1`, no role); opening panel leaves focus unmanaged, Escape leaves it open. Keyboard analysts lose the direct investigation route; popup is a workaround. | Define keyboard trigger, panel semantics, entry/return focus and dismissal. |
| High · P `.manual-input`; C `.mustela-search-input:focus` | Focus each input: computed outline none/0px, shadow none, no wrapper focus rule. Location is not visually signaled during manual lookup. | Add tested visible focus treatment. |
| High · W labels/toggles | Inspect input label associations: checkboxes and most settings fields have neither associated labels nor ARIA labels; detection select is associated. Visible text is not a programmatic label, making configuration ambiguous. Placeholders are not equivalent persistent labels. | Associate labels and describe help text. |
| High · C `.mustela-panel a`, `.mustela-provider-link` | Dark fixture: 16px/400 link `#2563eb` against sampled composite `rgb(45,52,67)` measures **2.41:1**, below WCAG 1.4.3 normal-text 4.5:1. Background sampled from rendered link center with text temporarily transparent; includes host/panel/card/link layers. Provider pivots are hard to read. | Theme-specific link colors, remeasure both themes. |
| Medium · P/C/W motion rules | Emulate reduce: popup retains 140/160ms transitions, C chip 180ms animation, W toast 180ms transition. S overrides to 0.001ms. Motion preference is ignored in extension surfaces. | Extend reduced-motion handling without hiding state feedback. |
| Medium · W input selector | MISP/assist text and URL fields render native white rectangles while password fields use full-width glass styling. Selector excludes these types; configuration hierarchy becomes inconsistent. | Cover equivalent field types, retaining native semantics. |
| Low · S font links | Load with network blocked: fallbacks render; HTML still requests Google Fonts when online. This contradicts local-resource constraints and makes typography network-dependent. | Resolve in separate resource-localization work, not this inventory. |

Intentional differences: light popup, dark welcome/site and backdrop-selected panel are distinct existing surfaces; differing radii alone are not defects. To confirm: fixed panel width on narrow/dense SIEM layouts and host-style interference need representative compatibility testing. Unmeasured pale light-theme badges/page indicator are not asserted contrast failures.

## Opportunities

Prioritized proposals, not committed direction or roadmap:

1. SIEM context: fixed floating panel and inline pills → test dense log tables, zoom and dark consoles, then explore less-obstructive investigation placement → preserve log scanning while investigating.
2. Voice/identity: literal actions coexist with conversational history and hunting copy → propose a consistent evidence-aware voice and recognizable product identity across setup/site/extension → improve comprehension and recognition on return visits.
3. Continuity: local notes, export and pinning exist but site proof is illustrative → demonstrate a synthetic detect/investigate/trace workflow and clarify optional-service readiness → help analysts adopt and retain useful workflows without invented social proof.
