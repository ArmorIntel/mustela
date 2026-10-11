# Chrome Web Store release validation

This is a manual maintainer-owned procedure, not an automated publication gate.
A passing CI run or GitHub Release is not product approval. No Store pipeline is
provided. Keep completed reports in a maintainer-authorized location; this public
repository contains only the blank template below and explicitly authorized,
redacted evidence. This document certifies no candidate.

## Separate the publication stages

1. **GitHub Release:** a maintainer-created `v*` tag triggers the existing
   [release workflow](../.github/workflows/release.yml), which builds and publishes
   a ZIP on GitHub. It does not upload, submit, or publish to the Chrome Web Store.
2. **Store upload:** staging the exact ZIP in the Store dashboard is not submission
   for Google review and is not approval to publish.
3. **Store submission:** only the maintainer may submit the exact SHA-256 approved
   in a dated GO decision after all required checks below pass.
4. **Store publication:** use deferred publication. After favorable Google review,
   the maintainer must explicitly reconfirm the approved candidate and declarations
   before making it live. Google review does not replace maintainer approval.

Agents must not merge, create tags/releases, upload, submit, or publish candidates.
No new tag is needed to validate a candidate.

## Status and decision rules

Record an observed result and redacted evidence for every check and subcase.
All checklist rows are mandatory for functions available in the candidate,
including integrations that users can optionally enable.

- **PASS:** the check was executed on the identified candidate, the required
  behavior was observed, and evidence is attached.
- **FAIL:** the executed check exposed a defect, mismatch, or unmet requirement.
- **NOT TESTED (NON TESTÉ):** the check was not completed or has insufficient
  evidence, including an unavailable endpoint. Never default this to PASS.
- **N/A:** genuinely inapplicable because the function is absent or the IOC type
  is unsupported; record a verifiable reason and evidence. Missing credentials,
  unavailable infrastructure, or an integration being optional do not justify N/A.

Any mandatory FAIL, NOT TESTED, blank result, missing evidence, blocking deviation,
missing decision, or missing privacy prerequisite means **NO-GO: do not submit**.
An available, enableable integration that has not been validated is blocking;
resolve it, on a new candidate if necessary, before GO. Valid, evidenced N/A
subcases do not waive the remaining supported cases of an integration.

GO requires every applicable mandatory check to pass, all deviations to be
resolved, and the maintainer's explicit approval of the exact SHA-256, with date
and authorized public identity. A GO never authorizes an agent to publish.
Changes to ZIP bytes/hash, version, manifest, or data flows invalidate the prior
GO: identify a new candidate, repeat the required checks, and obtain a new decision.
Changes to privacy policy, listing, or data declarations also require renewed
validation and approval before submission or publication.

## Prepare and identify the exact candidate

Use [AGENTS.md](../AGENTS.md#development-and-validation) for validation prerequisites
and [README installation](../README.md#option-a--download-a-pre-built-release-recommended-no-build-tools-needed)
for loading an extracted ZIP. Do not substitute a source build for the distributed
ZIP when performing the manual campaign.

For each future Store candidate, on its recorded source commit, run and retain
real command outputs (including tool versions, exit codes, and E2E results):

```bash
npm ci
npx playwright install chromium # if the E2E browser is not prepared
npm run verify                 # build + Node tests + E2E under xvfb
```

Use Node 20 as in CI; under Linux prepare `xvfb` for the E2E command. The current
[CI workflow](../.github/workflows/ci.yml) does not run E2E, and the release workflow
does not run tests. Their successes alone are insufficient. E2E fixtures do not
prove all integrations are available or the distributed ZIP is compliant.

For a source-produced candidate, on the same validated source, package the already
built `dist/chrome` with `npm run pack:zip`. It produces
`artifacts/mustela-v<version>-chrome.zip`, using the version in `package.json`.
Prefer this to `npm run package`, which also creates a CRX not needed for the Store.
Use a fresh output location, with no stale ZIP or private build files: the packer
archives everything in `dist/chrome` and does not sanitize the contents for you.

If using an existing GitHub Release, download its exact ZIP and record its release
URL, tag, and resolved source commit. Verify the recorded source separately; do
not silently replace the downloaded artifact with a rebuild.

For example, after selecting the candidate, substitute its actual filename:

```bash
sha256sum artifacts/mustela-v<version>-chrome.zip
unzip -l artifacts/mustela-v<version>-chrome.zip
unzip artifacts/mustela-v<version>-chrome.zip -d candidate-extracted
```

Extract into a new empty directory. Load that directory in a clean Chrome profile
with no other extensions or API keys, following the linked installation steps.
Record Chrome version, OS/version, date, and the exact hash. Do not change the
extracted contents. Recheck the hash before submission and publication.

## Mandatory checklist

Use synthetic fixtures, such as documentation IPs (`192.0.2.10`), example domains,
and fabricated hashes. Use only maintainer-authorized test endpoints/accounts.
Do not use real incidents, customer data, private URLs, or production MISP events.
Use a fictitious page URL/title to model a sensitive case. Redact credentials,
headers, query strings, internal endpoints, and incidental identifiers from all
screenshots, logs, exports, and request evidence; never place secrets in reports.

| ID | Check and required observation/evidence |
| --- | --- |
| C1 | Record source commit, optional tag and resolved commit, artifact origin, ZIP filename/hash, package version, ZIP root manifest version, date, Chrome and OS. Reconcile all versions and optional `v<version>` tag. If already on the Store, confirm the new Store version is higher than the latest published version; record that version or evidence of no prior publication. |
| C2 | Record successful locked install, build, Node tests, and E2E from `npm run verify` on the source commit, with redacted outputs. Review any generated diff; reconcile the source and exact artifact, not merely the release name. |
| C3 | Inspect the exact ZIP listing and extracted tree: `manifest.json` at root; all icons, scripts, CSS, HTML and referenced resources exist and load. No secrets, private configuration, development dependencies, traces, unrelated or stale files. Record inspection evidence. |
| C4 | Review the ZIP manifest against source and Store declarations. Justify each permission, `host_permissions` entry and CSP without broadening them for validation. Current permissions are `storage`, `activeTab`, `contextMenus`, `tabs`, `scripting`; inspect broad HTTP/HTTPS host access and provider hosts. Confirm extension-page CSP and referenced resources match the candidate. |
| C5 | Install the exact extracted ZIP in a clean Chrome profile. Observe successful load, toolbar/options access, settings save/reopen, and no extension load errors. Record the loaded version and absence of API keys before the no-key checks. |
| L1 | Without API keys, detect and highlight supported IOC types on a static synthetic page; record expected versus detected values and rendering. |
| L2 | Insert synthetic IOC dynamically and observe rescan/highlighting and updated popup page summary without breaking the page. |
| L3 | Open the in-page panel from a highlight; record IOC/type, available local result and actionable external pivots without configured enrichment. |
| L4 | Exercise supported provider pivots and verify destination/type/encoded IOC. External navigation sends the IOC to the third-party site: no-key operation does not mean no traffic. Unsupported type/provider combinations need evidenced N/A, not invented links. |
| L5 | Use popup manual search and current-page investigation actions; record observable states. For an invalid IOC, confirm no useful enrichment or crash and document the actual observed behavior, not a promised new UX. |
| L6 | Select synthetic text and use the context-menu investigation action; observe the recognized IOC and panel. |
| L7 | Pause/disable and resume/re-enable on the fixture page; observe highlighting and popup state before/after. Review settings-based highlighting separately. |
| L8 | Investigate synthetic IOC, reopen recent history entries and pin/unpin them; verify persistence and applicable history filters after reopening the popup. |
| L9 | Save/reopen a local analyst note and export JSON; inspect the exported IOC/result/note as applicable, parseable JSON and absence of unrelated data. Evidence must be redacted. |
| I1 | For each available public provider (VirusTotal, AbuseIPDB, Shodan), configure authorized test credentials, validate connection and perform supported synthetic IOC lookups. Record provider/type coverage, returned or no-signal state, and requests consistent with privacy declarations. A successful no-signal response is not proof an IOC is safe. |
| I2 | For MISP, test connection, supported lookup and Add to MISP only in an explicitly authorized test event. Confirm destination, IOC/type, created attribute or event link and actual POST behavior; include no production writes. Unsupported ASN/subnet cases may be evidenced N/A, not the entire integration. |
| I3 | For Analyst Assist, validate the configured endpoint/model, generate an investigation summary, and correlate at least two synthetic history entries. Record observable responses and redacted request evidence for IOC/provider data, page URL/title context and history sent to the configured LLM. |
| I4 | For each available integration, exercise network failure, timeout, absent key and invalid key. Observe bounded failure and usable local flows, not a crash or fabricated success. An unreachable endpoint is FAIL or NOT TESTED according to what was observed; it cannot prove successful integration behavior. Record each subcase. |
| I5 | On a fictitious sensitive-context page, inspect actual enabled-provider, MISP and Analyst Assist outbound behavior and disabled/unconfigured states. Confirm URL/title/history disclosures and operator guidance match reality. Do not assume pausing highlighting is a network/privacy boundary. Record requests without leaking keys or private URLs. |
| P1 | Confirm privacy documentation aligned with current integrations has been merged, deployed to the published policy, and verified for this candidate. Record merge/source evidence and the published URL/revision/date. Pending work or a ready PR does not meet this prerequisite. Until delivered and verified, NO-GO. |
| P2 | Compare the published [privacy policy](PRIVACY_TRANSPARENCY.md), listing, Store data declarations, permissions and observed behavior. Explicitly cover external pivots, provider authentication, MISP POST lookup/write, LLM IOC/verdict/page URL/title/history disclosure and local storage. Resolve every mismatch before GO. Local-first must not imply zero disclosure; no project backend, telemetry, analytics, new provider or permission is introduced by this procedure. |

The existing E2E scenarios in `tests/e2e/extension.e2e.spec.js` cover highlighting,
dynamic rescans, popup actions, pause/resume, history/pinning, notes/JSON export,
pivots and settings. Use them as a cross-check, not as a replacement for this
human campaign on the exact ZIP, context-menu checks, live authorized integrations
or the Store/privacy review.

## Blank validation report template

Copy this template to a maintainer-authorized location. All fields below are
intentionally blank; none assert PASS or GO. Expand every checklist ID into
separate rows for provider/type/error subcases as needed. Do not omit a check.

### Candidate and environment

| Required field | Value |
| --- | --- |
| Source commit (full SHA) | |
| Tag, if any; resolved commit (otherwise state no tag) | |
| Artifact origin / release URL, if any | |
| `package.json` version | |
| Version from ZIP root `manifest.json` | |
| ZIP filename | |
| ZIP SHA-256 | |
| Latest published Store version / evidence of no prior publication | |
| Campaign date and timezone | |
| Chrome version; OS and version; clean-profile confirmation | |
| Node/npm versions; source checkout used for verification | |
| Synthetic fixtures and authorized test configuration (no credentials/private URLs) | |
| Privacy alignment merge/source evidence; published policy URL/revision/date | |
| Store listing/data-declaration revision and redacted evidence | |

### Automated verification on the recorded source

| Command | Date / exit code / observed result | Redacted evidence reference |
| --- | --- | --- |
| `npm ci` | | |
| `npm run verify` — build | | |
| `npm run verify` — Node tests | | |
| `npm run verify` — E2E under xvfb | | |

### Checklist results

For every C1–C5, L1–L9, I1–I5 and P1–P2 check above, record a row with its
subcases. Use only PASS / FAIL / NOT TESTED (NON TESTÉ) / N/A after execution or
assessment; a blank row is incomplete and blocks submission.

| Check ID / subcase | Expected and actually observed result | Status | Redacted evidence reference / verifiable N/A reason |
| --- | --- | --- | --- |
| C1 | | | |
| C2 | | | |
| C3 | | | |
| C4 | | | |
| C5 | | | |
| L1 | | | |
| L2 | | | |
| L3 | | | |
| L4 | | | |
| L5 | | | |
| L6 | | | |
| L7 | | | |
| L8 | | | |
| L9 | | | |
| I1 | | | |
| I2 | | | |
| I3 | | | |
| I4 | | | |
| I5 | | | |
| P1 | | | |
| P2 | | | |

### Deviations and resolution

| Check / deviation | Blocking impact | Resolution / retest evidence / candidate hash |
| --- | --- | --- |
| | | |

### Maintainer submission decision

| Required field | Value |
| --- | --- |
| Decision: GO or NO-GO | |
| Rationale; completeness and deviation review | |
| Exact approved ZIP SHA-256 (GO only) | |
| Decision date/time and timezone | |
| Maintainer authorized public identity | |

No decision means NO-GO. Before submitting, the maintainer rechecks the artifact
hash, privacy prerequisite and declarations. Only the approved ZIP may be
submitted; record upload/submission date and candidate hash in the authorized
report, not as a substitute for this decision.

### Deferred publication confirmation

| Required field | Value |
| --- | --- |
| Submitted ZIP SHA-256; upload/submission date | |
| Google review outcome/date and evidence | |
| Rechecked candidate hash/version/manifest and policy/listing/declarations | |
| Changes since GO (if any, new validation and decision reference) | |
| Maintainer decision to publish or withhold | |
| Confirmation date/time and authorized public identity | |

Even after favorable Google review, do not publish without this explicit
confirmation. If the candidate or declarations changed, stop and repeat validation
with a new decision. Only the maintainer performs publication.
