# Local exclusion rule API

Manage rules without keys in Settings → **Local exclusions**: add a typed row,
edit its value or remove it, then choose **Save exclusions**. Validation errors
identify the row and leave the previously saved list intact. Legacy page pauses
are listed separately with explicit removal controls. Stored rules filter page
detection/highlights and guard direct investigations, automatic summaries,
provider pivots, MISP lookup/add and correlation history. Local copy/export is
not restricted. Changes propagate to loaded pages and open popups, invalidate
stale detections and close panels without starting investigations. See
[Privacy & Transparency](PRIVACY_TRANSPARENCY.md#direct-action-exclusions) for
the guarded paths and limits.

## Rules and decisions

`src/shared/exclusions.js` exports `normalizeExclusionRules(rules)` and
`isExcluded(rules, { pageUrl, ioc })`. Pass validated rules (or the storage reader's
result) to the decision helper. It returns a boolean: any matching exclusion
suffices, including when the page matches but the IOC does not, or vice versa.
There are no allow rules or precedence overrides.

Each rule has one of these shapes; unknown kinds or fields are rejected:

```js
{ kind: 'page-url', value: 'https://console.corp/Case?q=1#A' }
{ kind: 'host', value: 'intranet.corp' }
{ kind: 'host', value: '*.intranet.corp' }
{ kind: 'ioc', iocType: 'domain', value: 'evil[.]test' }
```

- New page rules require an absolute HTTP(S) URL without whitespace, control
  characters or backslashes. The entire string, including case, path, query and
  fragment, is matched byte-for-byte. No URL parser canonicalization is used for
  equality. A page rule does not match an IOC's URL.
- Hosts are ASCII DNS labels (including single-label hosts), lowercased, with no
  scheme, port, path, empty labels or trailing dot. They match a page URL's host
  and domain/URL IOC hosts, not arbitrary text, email domains or IP IOC values.
  URL host comparison ignores case and the DNS root dot. An exact host matches
  only itself. `*.intranet.corp` matches `a.intranet.corp` and
  `a.b.intranet.corp`, but neither `intranet.corp` nor `intranet.corp.evil`.
  Add a separate exact-host rule for the bare host.
- Exact IOC rules require an explicit existing IOC type: `ip`, `domain`, `url`,
  `email`, `subnet`, `asn`, `md5`, `sha1` or `sha256`. They use the existing
  `normalizeIoc` behavior, including refanging, hash casing, IPv6 canonicalization
  and case-sensitive email local parts. IOC URL normalization does not otherwise
  canonicalize URLs; path/query case remains significant. Values must be a whole
  valid IOC, not surrounding text or a partial candidate. Explicit domain rules
  are not subject to automatic detection's noise filters.
- Host wildcards are limited to the leading `*.` form. Free regex is rejected;
  no user-supplied expression is compiled. An empty list adds no exclusions.
  Duplicate normalized rules are collapsed. Invalid lists throw before saving.

The IOC argument uses `{ type, normalized }` or `{ type, raw }`, consistent with
the existing IOC model. `normalized` takes precedence when both are supplied.

## Local storage and legacy page pauses

`src/storage/storage.js` exports `saveExclusionRules(rules)` to atomically replace
configured rules and `getExclusionRules()` to read the effective rule list. The
versioned record is stored only in `chrome.storage.local`:

```js
{ mustela_exclusions: { version: 1, rules: [] } }
```

Saves validate the complete list first; an invalid list leaves stored rules
unchanged. Reads initialize the versioned record if absent. Unsupported versions
are rejected without overwriting data. Initialization and replacement share a
queue to avoid a first read overwriting a concurrent save. Neither API requires
provider keys, networking or additional permissions.

Migration is a non-destructive projection: existing `mustela_disabled_pages`
strings are included as exact `page-url` rules on every read, preserving their
original bytes, including legacy non-HTTP URLs. The old key is never removed or
rewritten by these APIs. Keeping it authoritative means an existing unpause or
clear operation removes the projected rule immediately, rather than leaving a
stale copied exclusion. Repeated reads deduplicate exact rules and do not expand
their scope.

`saveExclusionRules([])` clears only configured rules; existing legacy pauses
remain until removed through `setPageDisabled` or `clearDisabledPages`. The save
result contains configured rules; read again for the effective union. New rules
are not written into the old pause list. The legacy `isPageDisabled` helper remains
an exact pause-list check; detection now uses the effective union instead. Rules
are supplied to the isolated extension content script, not the website's DOM.
The background re-reads the
effective rules before direct outputs and refuses when either the IOC or any
available source/tab/frame page matches. Refusals use `MUSTELA_EXCLUDED` with an
explanation naming the matching rule and requiring explicit removal in settings;
unreadable rules fail closed with `MUSTELA_EXCLUSION_UNAVAILABLE`. There is no
one-time override. Removal never replays refused actions or withdraws data
already transmitted to recipients.
