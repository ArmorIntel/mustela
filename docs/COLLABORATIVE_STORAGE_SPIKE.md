# Collaborative storage: decision spike

Status: research only, 2026-10-16. No collaborative flow is implemented by this report. No service, account, prototype, new dependency, permission, or data transfer is introduced. A separate/self-hosted service is an option under study, not an approved architectural decision. Current privacy commitments remain unchanged.

## Decision in brief

- Private team: retain local memory; investigate the organisation's existing MISP first, through a small, synthetic, read-only feasibility exercise. Its existing connector and sharing model reduce the next-step surface, but do not already provide colleague investigation recall.
- Public community: defer implementation. TLP:CLEAR is necessary for the proposed flow, not sufficient evidence of permission, anonymity, quality, or safe publication. No candidate removes the need for moderation, consent, withdrawal and an accountable operator.
- If MISP cannot meet the team's annotation and isolation needs, compare a narrow dedicated API against self-hosted Supabase after requirements are demonstrated. Do not install a second platform merely to complete this spike.

## Observed baseline (not proposed capability)

Inspected integration reference: `e1ae2463f5c29a21a1ccf98bd2874f6199890c96`. These observations supersede older main-branch assumptions; notably, manual TLP labels and protected IPv4 handling now exist.

| Evidence | Observed behavior and limit |
| --- | --- |
| [Storage](../src/storage/storage.js): `getStorageArea`, `buildHistoryKey`, `mergeHistoryEntries` | Exclusively `chrome.storage.local`; history cap 50, cache cap 30. Key = type plus trimmed/lowercased value. Merge preserves first/last seen, count, note, pin and confirmed TLP, not distributed authors or team membership. A local mutation queue prevents overlapping local updates; it is not distributed conflict resolution. |
| Storage: `saveHistoryNote`, `saveHistoryTlp`, `clearHistory` | Note replacement has a local update timestamp. TLP is manual, defaults to unclassified, and is not a network access control. Clearing/evicting history does not delete remote submissions or exports. |
| [Providers](../src/providers/providers.js): `mispLookup`, `mispValidate` | Search posts to `/attributes/restSearch`, page 1, limit 10. Version validation uses `/servers/getVersion`, not a collaboration/permissions test. Returned metadata is compact; it is not colleague-note retrieval. Supported MISP IOC: IP/domain/URL/MD5/SHA1/SHA256, not ASN/subnet. |
| Providers: `addIocToMisp`, `providerFetch` | Separate action posts one attribute/comment to `/attributes/add/{eventId}`, optionally with a confirmed TLP attribute tag. No event distribution/publication change. Fetch omits credentials, HTTP cache and referrer, with a 12-second AbortController timeout. A timeout is not proof of non-delivery. |
| [Background](../src/background/background.js): `rememberInvestigation`, `handleMessage`; [content](../src/content/content.js): `bindAnalystActions` | History retains page URL/title. `SAVE_HISTORY_NOTE` stays local; `ADD_IOC_TO_MISP` is distinct and sends the action's comment and confirmed TLP. Neither action synchronises local history. |
| [Manifest](../manifest/chrome.manifest.json) | MV3; storage/activeTab/contextMenus/tabs/scripting and broad HTTP/HTTPS host access already exist. No permission change is needed for this report. |
| [Storage tests](../tests/storage.test.js), [provider tests](../tests/providers.test.js) | Local merge behavior and mocked MISP requests, not proof of live multi-analyst collaboration. |
| [README](../README.md), [product foundations](../PRODUCT.md), [contribution guide](../AGENTS.md), [privacy](PRIVACY_TRANSPARENCY.md), [changelog](../CHANGELOG.md) | No project backend, extension accounts or cloud sync. MISP integration was already delivered in v0.3.0; team/community memory was not. Existing configured lookups, pivots and optional Analyst Assist can disclose data; local-first is not zero disclosure. |

“100% local” memory alone cannot share between browser profiles or colleagues. Even an organisation-operated server is outside the browser trust boundary; self-hosting does not turn remote storage into local storage.

## Two separate hypothetical journeys

All names, notes and indicators below are fictional; do not query them during review.

### A. Private team: find a colleague's investigation

1. Analyst A investigates `case.example`, keeps the full trace locally, and chooses a future “Share with team” action. A preview names the organisation-operated destination and exact fields. Merely investigating or saving a note must not cause this new write.
2. Allowed payload: IOC type/value, explicit classification, a separately reviewed team note such as “Reviewed in the training exercise; verification pending”, authenticated author identity and server timestamps. Internal IOC may be sent only to a specifically authorised private team destination, never assumed safe because it is MISP.
3. Forbidden by default: page URL/title, customer identity, raw history, provider/LLM payloads, attachments, settings and secrets. A note or IOC URL can itself contain forbidden context; require review, not merely field removal.
4. Analyst B explicitly chooses a future “Check team” action for the same IOC. Authentication plus server-side membership limits results to the chosen team; B sees provenance, time and revisions, not an unexplained authoritative verdict. Querying also discloses the IOC and interest to the server/operator.
5. If unavailable or unauthorised, show unavailable/denied, not “never investigated”. Detection, permitted pivots, local notes and local conservation remain usable. No automatic replay of a failed write; acknowledge ambiguous delivery before a deliberate retry.

Recipient: the named organisation service, its authorised members and privileged operators/backups. MISP organisation membership is not automatically the same boundary as a SOC team; sharing groups select organisations, not sub-teams within the creator organisation. Teams inside one organisation may require separate instances or a different verified access model. Read-only users must not inherit write/publish/admin capabilities. Writers must not choose arbitrary teams or impersonate authors. Use per-user revocable credentials, not a shared administrative key; credential provisioning/session renewal in MV3 remains to verify. Credentials authenticate only the selected service and are never synchronised as collaboration records.

### B. Public community: consult an opt-in signal

1. Analyst explicitly opts into a named public community and requests a signal for `case.example`; no background batch lookup of local history. Public read authentication may be optional, but the destination still observes IP, time and query. The future response would show source, observation time, moderation status and uncertainty, never a count-as-proof verdict.
2. Publishing is a separate explicit action with payload/recipient preview and confirmation of source authority. Allow only individually approved TLP:CLEAR IOC type/value and a bounded structured signal (for example “reported; unverified”), not copied free text. Unclassified or other TLP labels must fail closed. Existing TLP selectors do not enforce this proposed policy.
3. Forbid internal/reserved IOC, page URL/title, IOC URLs containing credentials/customer paths/query identifiers, notes, customer/tenant identity, detailed history, provider keys and inherited team provenance. Initial type allowlist and validation remain to decide; CLEAR must never override internal-IOC exclusion. Existing literal IPv4 protection is useful but does not classify every URL, domain, subnet or IPv6 value.
4. Public contributors need revocable identity and submit-only rights; moderators decide acceptance/removal; publishers and administrators are separate roles. Use separate endpoint/schema/credentials from private team data, with no “publish team row” switch. Validate CLEAR and the payload allowlist again on the server.

Recipient: the public operator and potentially anyone who downloads, mirrors or republishes accepted signals. A private MISP community or “all communities” distribution is not automatically an anonymous public API or web-wide publication. This journey is a proposed contract, not a description of current MISP lookup or add.

## Comparison matrices

Capabilities below are documented primitives, not validated Mustela integrations. “Design” means work we would have to implement; “verify” means unproven in the intended deployment. Effort/cost are relative engineering judgments, not estimates of latency, capacity or vendor prices. All four candidates are self-hosted; MISP means the already configured organisation instance. The dedicated candidate is concretely a small authenticated API over PostgreSQL, not an unspecified turnkey product.

### Data, access and concurrency

| Option | Data / IOC identity | Team/tenant isolation and rights | Authors, timestamps and conflicts |
| --- | --- | --- | --- |
| Local baseline | Existing type/lowercase key and one browser history; no shared record. | Browser profile boundary; no membership/remote rights. | Local note/update time and local queue only; no colleague identity. |
| Dedicated API + PostgreSQL [D1–D2] | Design IOC table plus append-only investigation revisions keyed by tenant + type + canonical value + schema version; DB uniqueness required. | Design per-user auth, server-derived tenant, reader/writer/admin roles; PostgreSQL RLS is available, not enabled by default. Owners/superusers can bypass it [D1]. | Design server-bound author/time, immutable revisions and conditional revision checks; reject stale edits rather than silently merging notes. No collaboration behavior supplied by PostgreSQL alone. |
| Supabase [S1–S2] | PostgreSQL schema/unique constraints; design the same IOC and revision model. Auth/REST primitives do not define IOC equivalence. | Auth plus explicit grants and RLS policies; verify every operation and membership transition. Service-role/secret credentials bypass RLS and must never ship in the extension [S2]. A self-hosted project is not an automatic tenant model. | Design author relation, server timestamps, revision checks and append-only notes. Realtime notifications would not resolve concurrent edits. Verify identity binding and revocation. |
| PocketBase [P1–P3] | SQLite-backed collections, records and auth collections; design tenant/IOC/revision relations and uniqueness. | Collection list/view/create/update/delete rules can filter by authenticated membership. Superusers bypass rules. Verify tenant/author fields cannot be reassigned, including relation and realtime paths [P2]. | Design authored revisions and server-controlled times. Atomic stale-write rejection is to verify; do not infer it from ordinary record CRUD. Separate notes reduce lost-update risk, not abuse. |
| Existing MISP [M1–M4] | Events/typed attributes with UUIDs; IOC value alone is not a unique investigation. Analyst Data offers separately identified notes/opinions/relationships. Design mapping from one IOC to multiple events and records. | Organisations, roles, distribution and sharing groups; verify event, attribute and Analyst Data visibility independently. Analyst Data has its own distribution, with a documented community-level default: never inherit it blindly [M3]. | Analyst Data records have creator organisation and author information; other organisations add parallel records. Verify individual accountability, timestamps, same-organisation edits and concurrency on installed version. Existing attribute comments are not a revisioned team notebook. |

Identity warning for every remote option: do not copy `buildHistoryKey` as a universal canonicalisation rule. Domain/hash casing differs from case-sensitive URL paths; IP/subnet representations and MISP type aliases need explicit versioned rules. Preserve the original value for review, disambiguate type, and never infer that two sightings are the same investigation. Tenant identity must come from authenticated membership, not a client-selected key prefix.

### Failure, lifecycle and operating burden

| Option | Offline / outage / timeout | Backup, export, deletion and retention | Integration / operation / qualitative cost |
| --- | --- | --- | --- |
| Local baseline | Local memory works without remote access; external enrichment/pivots still require connectivity. | Existing copy/JSON export; local clear and 50-entry eviction, not remote erasure or a tested disaster-recovery system. | No new integration/service cost; cannot answer colleague/public queries. |
| Dedicated API + PostgreSQL [D1–D2] | Design optional bounded requests, cancellation, unavailable status and no blocking local dependency. No offline synchronisation supplied. | `pg_dump`/restore primitives documented [D2]; design tenant-filtered export, deletion API, retention jobs, encrypted backups and restore/expiry procedure. Verify deletion in replicas/logs/backups. | Highest custom API/auth/lifecycle/security engineering; operator owns TLS, patching, monitoring, incident response, DB restores and availability. Infrastructure plus sustained staff cost; no quoted amount. |
| Supabase [S1–S2] | Remote Auth/API unavailable offline; retain local path. Offline queue/conflict recovery and MV3 session lifecycle are design/verify, not delivered sync. | Self-hosting does not include managed backups/PITR [S1]. Operator owns Postgres backups/restores; design authorised exports, deletion/retention and auth-data cleanup. Full restore and backup expiry to verify. | Medium/high integration (schema, auth, RLS tests); broader multi-service stack to operate than a small API. No cloud subscription assumed, but compute/storage/mail/operations cost remains. |
| PocketBase [P1–P4] | Server API/auth/realtime do not establish offline merge. Design bounded requests and local fallback; verify retry/dedup semantics. | Deployment/backup guidance exists [P4]; verify backup coverage, restore consistency including files, encryption and off-host storage. Design team export, authorised deletion and retention; deleting records does not prove backup erasure. | Relatively small initial deployment footprint (standalone binary/SQLite), still custom policies and lifecycle. Official pre-1.0 compatibility/production-critical warning [P1] raises upgrade and migration risk for SOC use. No HA/scale claim. |
| Existing MISP [M1–M4] | Current connector has 12-second per-request timeout, no offline note sync; search only returns first ten matches. Failed/empty/truncated results cannot prove absence. Design pagination, no-result semantics and bounded optional access if expanded. | Events/attributes have export/sharing workflows [M1]; full instance backup/restore, Analyst Data export completeness, deletion propagation, retention and log/backup expiry are to verify with operator. Local clear never removes MISP data. | Lowest incremental connector discovery if already operated, not zero integration: note retrieval, rights, mapping and pagination remain. Existing MISP operations still cost staff/infrastructure; installing one solely for this feature is a substantially different burden. |

Managed Supabase, hosted PocketBase offerings, contracted MISP hosting and a managed dedicated API are separate deployment choices, not approved alternatives by implication. They add a recipient/operator and require review of jurisdiction, contracts, access, retention, backups and pricing. Self-hosted documentation is not a managed-service guarantee. No performance benchmark, deployment, recovery test or production audit was performed.

## Trust boundaries and non-negotiable future gates

These are requirements for a possible follow-up, not new implemented safeguards or changes to current provider behavior.

- Browser → team service → public community are three distinct boundaries. Preview the endpoint, team/audience and allowlisted fields on every explicit new disclosure. Never reuse the full history/export object as a request body, synchronise settings/API keys, or send page context implicitly. Avoid putting IOC in access-log URLs; minimise request-body logging and restrict operator access.
- Enforce permissions on the server for reads, writes, exports, deletes and subscriptions, with adversarial tests across two teams, forged tenant/author identifiers, revoked users and admin bypass paths. A client-side team filter or a TLP tag is not isolation. Private data must not reach public search, aggregates, logs or feeds.
- Withdrawal: disabling participation stops future reads/writes and pending sends, revokes credentials where appropriate and clears optional remote caches. Offer a separate authorised remote-delete request with acknowledgement; local clear is not that request. Specify tombstones, retention deadlines, log/backup expiry and restore-time re-deletion. Already downloaded/publicly mirrored information cannot be recalled reliably; state that before publication. MISP sync/removal behavior must be verified, not promised.
- Poisoning/abuse: bound field sizes and rates, validate types, render remote text safely, retain provenance/revisions and permit moderation, challenge/removal and credential revocation. Do not execute remote HTML or treat remote notes as instructions. Public contributors require anti-spam/Sybil controls and moderation capacity; popularity is not confidence. Distinguish verified evidence from unreviewed submissions and stale data.
- Anonymisation is not solved by hashing an IOC: domains/IPs can be enumerated, hashes correlated, and query timing/IP addresses identify interests. Even TLP:CLEAR can reveal investigative focus. TLP communicates sharing boundaries, not licensing, consent, encryption or automatic safety [T1]. Customer/source authority still needs review.
- Keep an unconfigured/keyless extension useful: detection, highlighting, permitted manual pivots and local notes/history must remain independent of collaboration. Remote outage must not prevent those local functions. Pivots can themselves disclose IOC and need network access. New remote access needs finite timeouts and a separate error state, not a shared-memory dependency in the local save path.
- Future network/auth work must preserve hardened fetch options and require TLS; retries need idempotency and ambiguous-delivery handling. An offline outbox is not approved: queued sensitive data and later publication need their own consent/revocation policy. Future implementation must update the privacy document in its own PR; this report does not amend today's policy.

## Recommendation, rejected options and next decision

### Private team

Prefer MISP-first feasibility, not automatic MISP-based memory. It already receives deliberate IOC operations, has threat-intelligence identity/sharing primitives and an annotation layer [M1–M4]. However, Mustela currently exposes neither colleague annotations nor a validated mapping between team membership and MISP rights. The default distribution of new Analyst Data is a concrete oversharing risk; per-record access must be established before any experiment with real data.

Do not select a dedicated API now: it offers precise semantics but creates an entirely new security and operations responsibility before demand is demonstrated. Keep self-hosted Supabase as a fallback when a relational team model is needed and an operator can own RLS/auth/restore tests; generic CRUD is not justification for its full stack. Reject PocketBase for a production-critical first choice while its documented maturity caveat and our conflict/recovery unknowns remain. Retain local-only as the safe baseline or final outcome if no operator/authorisation exists.

Proposed next lot: **3 points, capped at 5**, a separately approved synthetic, read-only MISP feasibility harness/report; no production rollout, writes, account creation or new platform. An operator must first provide an authorised disposable fixture instance and restricted credentials through an approved channel; none are required to finish this document. Otherwise defer this lot.

Acceptance for that lot: demonstrate IOC-to-multiple-event/annotation retrieval (including pagination), distinguish no evidence from denial/outage, show provenance/time, and prove two-team isolation including Analyst Data defaults and revoked access. Exercise local fallback with the endpoint unavailable. Record installed-version support, export/delete/retention ownership and MV3 auth uncertainties. Do not synchronise secrets, URL/title or local history. If it cannot fit the cap, stop with findings rather than expanding into a backend build.

Reconsider MISP if teams cannot be isolated within the current organisation layout, annotations are unavailable, individual authors cannot be trusted, or deletion/retention needs cannot be met. Only then refine a dedicated-API versus Supabase proof with named operator, realistic threat model, versioned identity rules, concurrency contract and a priced operations budget. A separate service remains a decision for that later review.

### Public community

Recommend **deferral**, independently of the team result. Local-only cannot provide public signals; dedicated API and Supabase can store them but do not supply the moderation/trust model; PocketBase adds the maturity concern; MISP federation is useful between governed communities but does not implement the proposed public opt-in contract. Sharing a private backend/table/event with a public flag is rejected for leakage risk.

Reopen only with an accountable operator/moderation owner, source-authority and licensing rules, explicit CLEAR-only type/field policy, physically or logically separated public data plane with tested isolation, abuse controls, retention/withdrawal wording and sustainable operations funding. Start with synthetic read-only signal consumption and a privacy review before considering contributions. No public publishing implementation is recommended in the next lot, and team feasibility does not automatically approve either feature.

## Official sources and evidence limits

All sources below were opened on **2026-10-16**. They establish documented primitives, not the installed configuration or tested end-to-end behavior. Verify versions and operator settings before implementation. The dedicated candidate has no product documentation because it does not exist; its concrete PostgreSQL primitives are sourced below and all API/auth behavior is explicitly design work.

- D1 — [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): policies, default-deny when enabled, owner/superuser bypass.
- D2 — [PostgreSQL SQL dump and restore](https://www.postgresql.org/docs/current/backup-dump.html): backup/export primitives, not a full retention/deletion strategy.
- S1 — [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting): single-project self-hosted stack, differences from managed service, operator responsibility for backups/security/availability.
- S2 — [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): grants/policies, Auth integration, service-role bypass and policy tests.
- P1 — [PocketBase introduction](https://pocketbase.io/docs/): standalone SQLite backend/auth/realtime and production-critical/pre-1.0 warning.
- P2 — [PocketBase API rules](https://pocketbase.io/docs/api-rules-and-filters/): collection operation rules, filtering and superuser bypass.
- P3 — [PocketBase collections](https://pocketbase.io/docs/collections/): SQLite-backed base/view/auth collections.
- P4 — [PocketBase production guide](https://pocketbase.io/docs/going-to-production/): deployment/operations guidance; restore and retention suitability not validated here.
- M1 — [MISP event workflow](https://www.circl.lu/doc/misp/using-the-system/): events, attributes, distribution, collaboration and publication/export lifecycle.
- M2 — [MISP administration](https://www.circl.lu/doc/misp/administration/): users, organisations, roles and authentication keys.
- M3 — [MISP Analyst Data](https://www.circl.lu/doc/misp/analyst-data/): independent notes/opinions/relationships, identity, authorship, distribution defaults and synchronisation/deletion blocklist.
- M4 — [MISP sharing](https://www.circl.lu/doc/misp/sharing/): sync permissions/settings and oversharing risks; not proof of remote erasure.
- T1 — [FIRST TLP 2.0](https://www.first.org/tlp/): sharing boundaries and limits of the labels.

Validation boundary: code inspection plus official-document review only; no live collaborative service or multi-user tests. Existing mocked provider tests must not be cited as proof of collaboration. Review the two journeys, both matrices and the conditional recommendation together; no current runtime, privacy policy or marketing promise changes.
