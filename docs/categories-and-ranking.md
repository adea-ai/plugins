# Categories, products and shelves

This document defines how the catalog groups plugins and how each category's
headline products are chosen. It exists because the ranking is **curated, not
computed from popularity**: nothing here is random, and nothing depends on
upstream ordering.

## Categories

`config/category-map.json` maps every upstream marketplace category onto the
published set. Upstream values are free-form, so the map carries aliases such as
`engineering`, `deployment` and `testing` → `developer-tools`. Anything the map
does not recognise falls back to `other`.

`config/product-categories.json` assigns a category to a named product. It is
applied _in addition to_ the upstream categories, so a product can legitimately
appear in two categories. `config/product-aliases.json` collapses product names
that differ only by punctuation or vendor spelling (for example
`google calendar` → `google-calendar`).

The published categories are:

| Category              | Notes                                               |
| --------------------- | --------------------------------------------------- |
| `business-operations` | sales, marketing, legal, HR, operations             |
| `communication`       | messaging, meetings, email, support                 |
| `creativity`          | design, media, publishing                           |
| `data-analytics`      | analytics platforms, databases, data tooling        |
| `developer-tools`     | engineering, infrastructure, observability, testing |
| `education-research`  | learning **and** research, including life sciences  |
| `finance`             | banking, accounting, investing                      |
| `productivity`        | documents, tasks, planning                          |
| `security`            | application, cloud and identity security            |

`scientific-research` no longer exists as a separate category. Research
products (`bio-research`, `math-olympiad`, `boltz-api-cli`, laboratory and
life-science tooling) are grouped under `education-research`, and
`config/category-map.json` maps every previous alias (`research`, `math`,
`scientific research`, `scientific-research`) there.

## Products versus plugins

A plugin ID is source-qualified: the same product published by several
marketplaces produces several plugins. Google Calendar, for example, exists as
both `plugin:cursor-official:google-calendar` and
`plugin:openai-official:google-calendar`.

Consumers browse **products**, not plugin IDs. `catalog.v1.json` stays complete
and source-qualified — every release, digest and provenance record is preserved
for installation — while the consumer shards publish the deduplicated,
pre-sorted view:

- `catalog-index.v1.json` → `products[productKey]` — one entry per product.
  `pluginId` is the canonical variant to install; `variantPluginIds` lists the
  others, canonical first.
- `shelf-<category>.v1.json` and `category-<category>.v1.json` carry the same
  records for one category, ordered for display.
- Variants are listed but never repeated: a browsing grid renders one card per
  product. See [consumer fetch patterns](consumer-fetch-patterns.md) for which
  artifact to request per screen.

### Canonical variant selection

For each product, the canonical variant is chosen deterministically in
`config/product-preference.json` order:

1. `canonicalOverrides[productKey]`, when configured, always wins.
2. Otherwise, a variant whose release is **published from a repository other
   than its marketplace** wins, because that is content the product's own vendor
   ships (for example Slack's plugin from `slackapi/slack-mcp-plugin`) rather
   than a marketplace's own wrapper package.
3. Ties break by `sourcePreference` order.
4. Remaining ties break by a human-formatted display name, then by plugin ID.

`displayName` on a product is presentation only: the most human-formatted label
among the variants (`GitHub` rather than `github`). The authoritative per-variant
name remains in `catalog.v1.json`.

### Brand marks

Marketplaces declare no icon field, so a mark is resolved at compile time and
mirrored into the release. For each product, in order:

1. **An explicit entry** in `config/product-icons.json`: a path inside the
   plugin content, an `https://` vendor site to take the mark from, or `null` to
   publish no mark and let the monogram stand.
2. **A file in the plugin's own content**, chosen by the documented rule
   (`assets/icon.svg` before `assets/logo.*`, a vendor-named mark such as
   `atlan-logo.png`, screenshots and diagrams never).
3. **The product site's icon**, for a live build only, when the content has no
   mark and the declared homepage is a vendor site — never a repository URL,
   which would only yield the forge's logo.
4. **A monogram**, when nothing else exists: initials and a stable hue the
   client renders locally.

Each product records which of these applied in `icon.kind`
(`content` or `favicon`) plus a `monogram`; see
[consumer fetch patterns](consumer-fetch-patterns.md) for the client contract and
[security](security.md#mirrored-brand-marks) for the mirroring policy.
`iconCoverage` in `categories.v1.json` reports how many products landed on each
step.

## Shelves: what each category shows first

Each category carries a curated shelf:

- `topProductKeys` — the products to headline, in display order. Its length is
  capped by `topCount` in `config/leading.json` (currently 6).
- `shelfArtifact` and `listArtifact` — the shards that carry those products'
  full records, already in this order.
- `leading[category]` in `config/leading.json` names the curated products by
  upstream plugin name, in the order they should appear.
- `productKeys` — the full, deduplicated category in display order: curated
  products first in configured order, then the remaining products alphabetically.
- `pluginIds` — the same ordering for the source-qualified plugins. Do not slice
  this list for a shelf; it contains each product's variants.

Two rules keep shelves clean:

- A curated product headlines **one** category only. If two categories curate
  the same product, the alphabetically first category keeps it.
- When a category curates fewer products than `topCount`, the shelf is filled
  from that category's own order, skipping any product that another category
  curates or has already shelved. A fill can never take a curated product away
  from the category that curated it.

### Curation drift is published

A curated name that no longer resolves is **skipped, never invented**, and
reported in `categories.v1.json` → `diagnostics` with a reason:

| Reason                    | Meaning                                                |
| ------------------------- | ------------------------------------------------------ |
| `PRODUCT_NOT_FOUND`       | no plugin in the catalog carries that upstream name    |
| `PRODUCT_NOT_IN_CATEGORY` | the product exists, but not in the curated category    |
| `UNKNOWN_CATEGORY`        | the curated category itself is absent from the catalog |

Diagnostics are computed for live builds only: an offline fixture build replays
synthetic content that no curation targets, so it publishes an empty list.
`bun run catalog validate` prints the same list, and
`bun run verify-integrity` rejects any published index whose shelves, counts or
membership contradict `catalog.v1.json`. A unit test (`config.test.ts`) checks
the shipped configuration, and once the checked-in snapshot carries an index it
also asserts the published `diagnostics` list is empty.

## Consumer quick path

For category browsing, two small artifacts are enough:

1. Fetch `categories.v1.json` once (~35 KB): category list, display counts, and
   each category's curated shelf order.
2. Fetch `shelf-<category>.v1.json` for the categories in view (~4 KB each) and
   render it directly.
3. Render a card from a product record: `displayName`, `description`, `sourceId`,
   `license`, `capabilitySummary`, `compatibility`, `keywords`, `icon`.
4. Fetch `category-<category>.v1.json` for "view more", or
   `catalog-index.v1.json` (~450 KB) for the complete list or a local search
   index. Fetch `catalog.v1.json` (~25 MB) only for detail views that need
   release provenance, file indexes or per-harness reasons.
5. On install, submit that product's `pluginId` and `releaseId` to Control
   Plane.

No client-side grouping, deduplication, sorting or ranking is required, and the
result is byte-stable for a given `catalogId`. Sizes, caching and the icon URL
are in [consumer fetch patterns](consumer-fetch-patterns.md).
