# Consumer fetch patterns

The published release carries navigation, index, per-category shards, and
mirrored brand marks. This document describes the artifact set, fetch patterns
for consumers that request individual shards, and how long each URL may be
cached. Adea's current integration fetches the verified catalog bundle through
Control Plane, then may fetch the public browsing index, mirrored icons, and
other image URLs selected by its icon resolver. It does not use the
per-category shelf and list shards yet.

## Artifacts

| Artifact                      | Size     | Contents                                                               |
| ----------------------------- | -------- | ---------------------------------------------------------------------- |
| `categories.v1.json`          | ~35 KB   | Navigation: category list, counts, curated shelf keys, shard pointers. |
| `shelf-<category>.v1.json`    | ~4 KB    | Full records for one category's curated shelf (`topProductKeys`).      |
| `category-<category>.v1.json` | 10–60 KB | Full records for every product in one category ("view more").          |
| `catalog-index.v1.json`       | ~450 KB  | Every product, once, plus category membership.                         |
| `catalog.v1.json`             | ~25 MB   | Complete source-qualified catalog: releases, digests, provenance.      |
| `catalog-summary.v1.json`     | ~160 KB  | Counts and flat `pluginId` → search text.                              |
| `compatibility.v1.json`       | ~1 MB    | Per-plugin harness compatibility.                                      |
| `sources.lock.json`           | ~140 KB  | Resolved marketplace commits and manifest digests.                     |
| `integrity.json`              | ~2 KB    | Digest of every artifact and every mirrored brand mark.                |
| `icon-<32 hex>.<ext>`         | 1–200 KB | One mirrored brand mark, content addressed.                            |

`categories.v1.json` is a router, not a payload: it carries the category list,
the curated shelf order as product keys, and the shard names to fetch for
records. Every shard repeats the `catalogId` it belongs to, so a client can
prove that a shard and the navigation it came from are from the same snapshot.

## Which fetch for which screen

**Default view for a shard-based consumer.** Fetch `categories.v1.json` once,
then fetch `shelf-<category>.v1.json` for the categories above the fold in parallel.
Sequential fetching is also correct: the shelves are independent artifacts, so a
client can prioritize visible categories and prefetch the rest when idle. A
nine-category home screen is roughly 35 KB + 9 × 4 KB. Rendering a card needs
only the shelf record.

**"View more" for one category in a shard-based consumer.** Fetch
`category-<category>.v1.json`. It carries every product in that category in
display order.

**Full list, search index or offline cache.** Fetch
`catalog-index.v1.json`. It is the complete product set, keyed by `productKey`,
roughly 60× smaller than `catalog.v1.json`, and rarely needed: use it for the
"all plugins" screen, for a local search index, or to pre-populate a cache.

**Install or detail view.** Fetch `catalog.v1.json` only here, and look up the
`pluginId` from the product record. It carries `currentReleaseId`,
`canonicalContentDigest`, per-harness compatibility reasons, the file index and
full provenance. Install actions still submit `pluginId`, `releaseId` and the
harness to Control Plane.

## Icons

Every product carries an `icon` field, which may be `null`, and a `monogram`;
the UI can render the monogram when no image URL resolves.

When a compiled mark is present, it is mirrored at the root of the publication
branch and uses this content-addressed URL:

```
https://raw.githubusercontent.com/<owner>/<repo>/<ref>/catalog-assets/<icon.asset>
```

`icon.digest` is SHA-256 over the mirrored bytes. The index digest in
`integrity.json` covers the index JSON, not the image response. A client that
downloads and stores a mirrored mark can compare those bytes with `icon.digest`
before trusting them.

`icon.kind` says where the mark came from, and `icon.digest` is SHA-256 over the
bytes, so a client can verify what it stored:

| `kind`    | Origin                                                  | Provenance fields |
| --------- | ------------------------------------------------------- | ----------------- |
| `content` | A file the vendor ships inside the plugin               | `path`            |
| `favicon` | The product site's icon, where the plugin ships no mark | `url`, `homepage` |

Render a mirrored SVG through an image element and never inline it into the
document. `icon.bytes` lets a client budget load order without a probe.

Adea's current UI has an additional icon resolver. It prefers a URL in the
upstream plugin's `icons` field, then uses the compiled mark when available, and
may fall back to a company favicon through Google's favicon service or a Simple
Icons URL. Those fallback responses are outside the publisher's mirrored-asset
digest inventory, and Adea does not automatically hash image responses when it
verifies the catalog or optional browsing index.

When `icon` is `null`, the compiler found no mark to mirror. The `monogram` still
carries a deterministic fallback: `text` is one or two initials derived from
the display name and `hue` is a stable 0–359 value derived from the product key,
so adjacent tiles stay visually distinct and identical across catalogs. Adea
may still resolve an external icon URL. The client draws the monogram, which
keeps it crisp and themable:

```ts
const background = `hsl(${monogram.hue} 42% ${dark ? 32 : 46}%)`
const foreground = '#fff'
// <span style={{ background, color: foreground }}>{monogram.text}</span>
```

A client that prefers one code path can instead render the monogram as a
placeholder behind the icon while it loads, since both fields are in the same
record.

`iconCoverage` on `categories.v1.json` reports how many products have a content
mark, how many have a site icon, and `monogramProductKeys`, the list still on a
monogram. That list is the curation worklist:

```json
{
  "schemaVersion": 1,
  "overrides": {
    "servicenow-sdk": "https://www.servicenow.com/",
    "some-repo-only-plugin": "assets/brand/logo.svg",
    "deliberate-monogram": null
  }
}
```

An `https://` value names the vendor site to discover the mark from, a relative
path forces a file inside the plugin content, and `null` keeps the monogram.

## Who serves what

Catalog artifacts and image assets have different delivery paths.

**The Control Plane serves Adea's verified catalog bundle.** Its server reads
the latest pointer, resolves the immutable snapshot, and verifies the required
artifacts before returning them through Adea's authenticated same-origin API
proxy. The response includes the full catalog and navigation metadata, plus the
optional `catalog-index.v1.json` when the snapshot has one. Adea independently
verifies the catalog response. Its browser then reads the public immutable
`catalogIndexUrl` declared in `categories.v1.json` and checks the index against
the digest in `integrity.json`; if that fetch fails verification, Adea uses the
full catalog returned by Control Plane. The current Control Plane API does not
serve the `shelf-*` or `category-*` shards. These remain available for other
shard-based consumers.

**Compiled brand-mark bytes are served from the public publication branch.**
These small, content-addressed assets are easy to cache and do not need to pass
through the catalog JSON proxy. Adea may resolve other icon URLs from the
upstream plugin record or its favicon and brand fallbacks.

They are served from `raw.githubusercontent.com` under `catalog-assets/`, which
is also where the catalog artifacts live. A GitHub release asset would not work
for browser use: a cross-origin fetch returns no
`access-control-allow-origin` header, so a client cannot read the index at all,
and every asset request redirects through a signed URL marked `no-cache`, so
images are re-downloaded on every render.

Product records with a compiled mark carry an absolute, immutable URL in
`icon.assetUrl`, composed at build time from `config/publication.json`:

```
https://raw.githubusercontent.com/<owner>/<repo>/<ref>/catalog-assets/<icon.asset>
```

The `icon.digest` and the matching `assets[]` entry identify the mirrored mark's
bytes. The index digest in `integrity.json` verifies the index JSON. Adea's
current consumer verifies the index but does not automatically fetch and hash
each image response.

For a compiled mark, a client can render `icon.assetUrl` without composing a URL
itself. A deployment that hosts assets elsewhere substitutes its base in that
config, and every record then points at the substitute. `icon.asset` and
`icon.digest` remain in the record, so a client can resolve a different base or
verify what it stored.

An unpublished build (`sync --offline`) advertises no `assetUrl` rather than a
URL that would not resolve.

### Private repository deployments

The published assets are public today, so no signature is involved and the URLs
are cacheable forever. If this repository becomes private, browser clients must
not fetch GitHub directly under this contract. The deployment substitutes one
of:

- **Control Plane proxies the bytes**, with its own cache in front. Simplest, and
  the client contract does not change at all.
- **A signed read-only asset endpoint**, where signatures are **catalog-scoped,
  not per-request** (the path already identifies immutable content). Signing each
  request individually would make every icon uncacheable, which is worse than the
  proxy for no gain.

Both are substitutions of the `publication.json` base. Neither requires a client
change, which is why the build publishes URLs instead of leaving them to be
constructed.

## Caching

Catalog snapshots are immutable and their directory is derived from `catalogId`
(`catalogs/<catalogId-suffix>`), so **every artifact URL above is immutable**:

- Cache artifact and icon responses against the full URL, indefinitely. A new
  snapshot publishes new URLs; old ones never change bytes.
- Treat `catalog-latest.v1.json` as a mutable pointer with a short TTL.
  Resolve it to a `catalogId`, then switch to the immutable URLs. Do not cache a
  pointer response beyond the refresh interval you are willing to serve stale
  data for.
- Because icon names are content addressed, the same mark is byte-identical in
  every catalog that resolves it to the same digest: an icon cache never needs
  invalidation, and two products that share artwork share one asset.
- Verify `integrity.json` before trusting a snapshot, and verify a mirrored
  icon against its `digest` before storing it. `bun run verify:published`
  performs both checks on a downloaded snapshot, and
  `bun run verify:catalog-branch` performs them against the live publication.

## Offline and partially cached clients

A shelf record is self-sufficient: it carries the category, the display order,
the licence, capability summary, compatibility statuses and the icon asset. A
client that has fetched the navigation plus one shelf can render that category
with no further requests, and a client that has cached `catalog-index.v1.json`
can render any category without the per-category shards.
