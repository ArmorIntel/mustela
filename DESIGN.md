# Existing design reference

## Overview

Inventory of public commit `8b7c175f022a9d48a9c186a264cc9f526d4d2cd9`, rechecked against main. This is descriptive, not a unified token specification or redesign. Product intent is in [PRODUCT.md](PRODUCT.md); observations and opportunities are in [the audit](docs/design-audit.md).

Source shorthand used below:
- **P**: [popup.html](src/popup/popup.html), with [popup.js](src/popup/popup.js).
- **C**: [content.css](src/content/content.css), with [content.js](src/content/content.js).
- **W**: [welcome.html](src/welcome/welcome.html), with [welcome.js](src/welcome/welcome.js).
- **S**: [docs/index.html](docs/index.html), inline CSS/JavaScript.

Distinct existing surfaces; no shared component implementation.

## Colors

| Surface / source | Roles and actual declarations |
| --- | --- |
| P `:root`, `body`, `.panel` | Text `rgba(15,23,42,.92)`, muted `rgba(51,65,85,.72)`, accent `rgba(37,99,235,.92)`; white cards `.62`/`.55`, white borders `.75`. Body combines white radial glow with `rgba(248,250,252,.98)` → `rgba(241,245,249,.94)`. No dark variant. |
| C `.mustela-panel` | Background `rgba(22,28,38,.72)`; text `rgba(248,250,252,.96)`; muted `rgba(226,232,240,.82)`; card `rgba(15,23,42,.22)`; border white `.18`, subtle `rgba(148,163,184,.20)`. |
| C `.mustela-panel--light` | Background white `.54`; text `rgba(15,23,42,.92)`; muted `rgba(51,65,85,.88)`; card white `.24`; border white `.44`, subtle `rgba(15,23,42,.08)`. JS `detectBackdropTone` selects at opening, not a user theme control. |
| C badges/links/highlight | `.mustela-provider-score`: good `#86efac`, warn `#fde68a`, bad `#fca5a5`; kind signal/context/setup/limited: `#fecaca`/`#bfdbfe`/`#cbd5e1`/`#fde68a` on translucent red/blue/slate/amber. Links `#2563eb` in both themes. Highlight text `rgba(17,24,39,.92)` over layered translucent white/slate gradients; host backdrop matters. |
| W `:root`, `body` | Text `#eef2ff`; muted `rgba(226,232,240,.76)` and `rgba(203,213,225,.68)`; accent `#7dd3fc`; background `#07111f` → `#0f172a` plus radial glows; glass white `.14`/`.10`; line white `.16`/`.10`. Test dots valid/invalid/limited `#22c55e`/`#ef4444`/`#f59e0b`. Dark only. |
| S `:root`, `.aurora` | Backgrounds `#060b14`/`#0a1120`/`#0d1626`; text `#eef3fc`; muted `rgba(206,217,238,.72)`/`rgba(176,190,217,.58)`; glass white `.055`/`.085`/`.12`. Cyan `#7dd3fc`/`#38bdf8`, blue `#4f7cff`, AI indigo `#a78bfa`/`#8b5cf6`; functional status `#fb7185`/`#fbbf24`/`#34d399`. Dark only. |

## Typography

| Source | Family, hierarchy and exceptions |
| --- | --- |
| P `html,body`, headings, `.muted`, chips | `Inter, ui-sans-serif, system-ui, sans-serif`; headings 12px bold/.04em uppercase; body helper 12px/1.35; input 13px; chips 10px/700; actions 11px/700. Form controls do not inherit the family: observed input Arial. |
| C `.mustela-panel`, `.mustela-label`, `renderResult` | `Inter, system-ui, sans-serif`; base size not declared, observed 16px on fixture; highlight inherits host family/size, label 600. IOC 15px/700/1.1; pills 11px/700; scores 12px/700; global verdict 20px/800 inline; supporting text 12px. Manual input observed Arial. |
| W `body`, `h1`, section/provider headings | P family stack; h1 40px/1/-.05em (34px below 900px), headings 21px (20px narrow), helper text 13–14px. Base body size/line-height and h2 weight use browser defaults; no common type scale. |
| S `body`, `.hero h1`, `h2`, `--mono` | `Inter, ui-sans-serif, system-ui, -apple-system, sans-serif`; body 17px/1.65 (16px below 580px); hero `clamp(2.3rem,4.6vw,3.5rem)`/800/1.06; h2 `clamp(1.7rem,3vw,2.3rem)`/800/1.1; chips `.7rem`, buttons `.94rem`/600. Mono: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. |

Inter is declared, not bundled by these extension surfaces; actual availability is environment-dependent. S currently requests Inter and JetBrains Mono from Google Fonts. This existing remote-resource deviation is not a recommendation; offline inspection used fallbacks.

## Layout

| Source | Density and responsiveness |
| --- | --- |
| P `body`, cards/lists | Fixed 340px, padding 14px; card margin/padding 12px; rows gap 8px, padding 8px 10px. Five-IOC preview expands; values ellipsize. No responsive breakpoint. |
| C `.mustela-panel`, header/body/provider grid | Declared 400px, top/right 16px, max-height 82vh, scrollable; measured 402px border box on fixture (no local box-sizing reset). Header 14px 16px, body 14px 16px 18px; provider padding 12px; two-column fields, gap 8px. No narrow breakpoint. |
| W `main`, `.grid`, cards | Max-width 1120px; margin 24px auto; padding 0 18px 40px; two columns/gap 14px, one below 900px. Hero 24px, cards 20px; sticky savebar bottom 16px. |
| S `.container`, grids, media queries | Max-width 1120px/padding 24px; hero columns 1.05:1/gap 56px; sections 96px. At 940px most grids become single-column, features two; at 760px navigation keeps Install only; at 580px features single, sections 72px. |

## Elevation & Depth

P `.toolbar`: inset highlights plus `0 14px 32px rgba(15,23,42,.14)`; cards `0 10px 24px rgba(15,23,42,.08)`, blur 34px toolbar.
C panel: `0 24px 64px rgba(2,6,23,.24)` (light `rgba(15,23,42,.12)`), inset white highlight, blur 34px; highlight `0 12px 30px rgba(15,23,42,.16)`, blur 24px.
W cards: `0 24px 60px rgba(2,6,23,.22)` plus inset highlight, blur 30px.
S `.glass`: inset `0 1px 0 rgba(255,255,255,.14)`, blur 14px; demo adds `0 30px 70px rgba(0,0,0,.5)`. These are separate vocabularies, not shared elevations.

## Shapes

P cards 20px, rows/field wrappers 14px, buttons/chips 999px.
C panel 24px, providers 18px, fields 14px, search shell 20px, pills 999px; copyables 8px.
W cards 30px, section headers 24px, styled inputs/details 18px, buttons/savebar/toast 999px.
S `--radius:22px` for glass/demo, nav/verdict 16px, buttons 12px (small 10px), type chips 6px. No common radius scale is implemented.

## Components

| Sources | Implemented states and behavior |
| --- | --- |
| P buttons / `renderSummary`, `mountManualLookup` | Default glass, hover transform; disabled opacity .5; native button focus. Loading badge → IOC count/No IOC/Paused; invalid input hint and disabled unsupported pivots. `.manual-input` suppresses outline without replacement. |
| P lists / `renderHistory`, `renderInsight`, `armCopyFeedback` | Empty history/filter messages; investigated row, active filter, pin/unpin, reopen; idle/saved brief. IOC copies support Enter/Space, hover accent, focus shadow, green success for 900ms; clipboard failure is silent. |
| P `renderCorrelation`, `mountCorrelation` | Disabled without configuration/two entries; loading “Correlating…”; result or error. No distinct provider-timeout popup treatment. |
| C `highlightNode`, panel render functions | Highlight hover reveals type; no keyboard activation/focus state. Skeleton “Loading…” → empty manual/result/error. Provider cards show setup, limited access, unavailable, usable/degraded/cached counts; timeout uses generic provider-error rendering, no dedicated timeout component. |
| C `bindCopyables`, `bindAnalystActions` | Copyables Enter/Space, hover `#93c5fd`, focus translucent ring, copied `#86efac`/900ms. Notes saving/saved/failure; export success/failure; MISP adding/added/error with retry. Add button availability depends on IOC type, not configuration readiness. Search input removes focus outline; panel buttons have no authored hover/disabled/focus variants. |
| W forms/details / `setDirtyState`, `testProvider`, `showToast` | Native controls/details; hover moves buttons -1px. Dirty savebar; testing → valid/invalid/limited; save/action success/error toast (polite live region). No authored focus/error field styling; text/URL fields miss the password/number/select styling rule. |
| S nav/buttons/cards / inline handlers | Anchor navigation, narrow links hidden; hover lifts buttons/cards; native focus. Copy → Copied/1600ms; clipboard rejection has no UI. Demo badges/IOC are static, aria-hidden illustrations, not extension behavior. No application loading/empty/provider states. |

Motion: P buttons transform 140ms and shadow/background/filter 160ms `ease`; copy feedback 140ms. C highlight shadow/background/border 180ms `ease`, copy feedback 140ms; chip scale/opacity 180ms `cubic-bezier(.2,.8,.2,1)`. W savebar/toast opacity/transform 180ms `ease`; hover has no transition. S buttons 200ms/cards 250ms, transform/shadow use `cubic-bezier(.22,1,.36,1)`; reveal opacity/translate 700ms with 0/80/160ms stagger. Only S implements reduced-motion override (0.001ms and visible reveals, automatic scrolling).

## Do's and Don'ts

- Do cite the surface and handler before extending a pattern; preserve keyless operation and evidence uncertainty.
- Do test translucent UI against actual host backgrounds, keyboard and fallback fonts.
- Don't turn these independent values into a fictitious shared palette/scale or imply present AA compliance.
- Don't copy static site demonstrations as runtime truth, generalize remote fonts, or implement the audit's proposals without a separate decision.
