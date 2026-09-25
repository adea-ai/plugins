# Consumer fetch patterns

The published release carries one navigation artifact, one index, one shard per
category per view, and the mirrored brand marks. This document defines which
fetch to use for which screen, and how long each URL may be cached.

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

**Default view (critical path).** Fetch `categories.v1.json` once, then fetch
`shelf-<category>.v1.json` for the categories above the fold in parallel.
Sequential fetching is also correct: the shelves are independent artifacts, so a
client can prioritize visible categories and prefetch the rest when idle. A
nine-category home screen is roughly 35 KB + 9 × 4 KB. Rendering a card needs
only the shelf record.

**"View more" for one category.** Fetch `category-<category>.v1.json`. It
carries every product in that category in display order.

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

Every product carries an `icon` and a `monogram`; one of them always renders.

An `icon` is a mirrored asset inside the same catalog release, so there is
nothing to search, sniff or fall back to:

```
https://github.com/<owner>/<repo>/releases/download/catalog/<catalogId-suffix>/<icon.asset>
```

`icon.kind` says where the mark came from, and `icon.digest` is SHA-256 over the
bytes, so a client can verify what it stored:

| `kind`    | Origin                                                  | Provenance fields |
| --------- | ------------------------------------------------------- | ----------------- |
| `content` | A file the vendor ships inside the plugin               | `path`            |
| `favicon` | The product site's icon, where the plugin ships no mark | `url`, `homepage` |

Render a mirrored SVG through an image element and never inline it into the
document. `icon.bytes` lets a client budget load order without a probe.

When `icon` is `null`, the product has no brand mark anywhere and `monogram`
carries a deterministic fallback: `text` is one or two initials derived from the
display name and `hue` is a stable 0–359 value derived from the product key, so
adjacent tiles stay visually distinct and identical across catalogs. The client
draws it, which keeps it crisp and themable:

```ts
const background = `hsl(${monogram.hue} 42% ${dark ? 32 : 46}%)`
const foreground = '#fff'
// <span style={{ background, color: foreground }}>{monogram.text}</span>
```

A client that prefers one code path can instead render the monogram as a
placeholder behind the icon while it loads, since both fields are in the same
record.

`iconCoverage` on `categories.v1.json` reports the split — how many products have
a content mark, how many a site icon, and `monogramProductKeys`, the list still
on a monogram. That list is the curation worklist:

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

Two different questions, two different answers — and the answer is a
configuration value, not client code.

**Catalog JSON (navigation, shards, index, catalog) is served by Control Plane.**
It already fetches and verifies the release server-side, it is the surface that
enforces policy before an install, and it keeps working unchanged if this
repository becomes private. Adding the shards to that surface is additive: the
same artifacts, the same digests, proxied.

**Brand-mark bytes are served from an immutable asset base, not proxied per
request.** Icons are numerous, small, binary and content-addressed, which is the
shape a cache serves well and an API proxy serves badly: routing 274 binary files
through the verified-JSON path would add latency and egress without adding a
security decision the compile-time gate has not already made.

To keep that a deployment decision rather than hardcoded client logic, product
records carry an absolute, immutable URL in `icon.assetUrl`, composed at build
time from `config/publication.json`:

```
https://github.com/<owner>/<repo>/releases/download/catalog/<catalogId-suffix>/<icon.asset>
```

A client renders `icon.assetUrl` and never composes a URL itself. A deployment
that hosts assets elsewhere substitutes its base in that config, and every
record then points at the substitute. `icon.asset` and `icon.digest` remain in
the record, so a client can resolve a different base or verify what it stored.

An unpublished build (`sync --offline`) advertises no `assetUrl` rather than a
URL that would not resolve.

### Private repository deployments

The published assets are public today, so no signature is involved and the URLs
are cacheable forever. If this repository becomes private, the contract's rule
applies — browser clients must not fetch GitHub directly — and the deployment
substitutes one of:

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

Catalog releases are immutable and their tag is derived from `catalogId`
(`catalog/<catalogId-suffix>`), so **every artifact URL above is immutable**:

- Cache artifact and icon responses against the full URL, indefinitely. A new
  snapshot publishes new URLs; old ones never change bytes.
- Treat `releases/latest/download/*` as a mutable pointer with a short TTL.
  Resolve it to a `catalogId`, then switch to the immutable URLs. Do not cache a
  `latest` response beyond the refresh interval you are willing to serve stale
  data for.
- Because icon names are content addressed, the same mark is byte-identical in
  every catalog that resolves it to the same digest: an icon cache never needs
  invalidation, and two products that share artwork share one asset.
- Verify `integrity.json` before trusting a snapshot, and verify a mirrored
  icon against its `digest` before storing it. `bun run verify:published`
  performs both checks on a downloaded release.

## Offline and partially cached clients

A shelf record is self-sufficient: it carries the category, the display order,
the licence, capability summary, compatibility statuses and the icon asset. A
client that has fetched the navigation plus one shelf can render that category
with no further requests, and a client that has cached `catalog-index.v1.json`
can render any category without the per-category shards.
