# Adea and Control Plane consumer contract

The repository is currently public. The stable browser-readable catalog URL is:

`https://raw.githubusercontent.com/adea-ai/plugins/catalog-assets/catalog-latest.v1.json`

The immutable URL for a catalog is derived from `catalogId`:

`https://raw.githubusercontent.com/adea-ai/plugins/catalog-assets/catalogs/<catalogId-suffix>/catalog.v1.json`

For example, `catalog:abc...` is published under the immutable directory
`catalogs/abc...`. Each catalog snapshot contains six core artifacts —
`catalog.v1.json`, `catalog-summary.v1.json`, `categories.v1.json`,
`compatibility.v1.json`, `integrity.json`, and `sources.lock.json` — plus the
consumer shards `catalog-index.v1.json`, `shelf-<category>.v1.json` and
`category-<category>.v1.json`. Mirrored brand marks are addressed by their own
digest and sit at the branch root rather than inside a snapshot, so every
snapshot shares them. `integrity.json` enumerates every artifact and asset in
the snapshot with its digest, so the inventory is self-describing rather than
fixed. The `catalog-latest.v1.json` pointer is byte-identical to
`catalog.v1.json` in the current snapshot. Fetch patterns and cache lifetimes
are defined in [consumer fetch patterns](consumer-fetch-patterns.md).

## Why the catalog is not published as a release

The catalog used to be published as a GitHub Release tagged
`catalog/<catalogId-suffix>`, and consumers read it through
`releases/latest/download/…`. GitHub marks exactly one release "latest", so a
content-addressed catalog reached that way outbid every versioned release for
that slot permanently. The repository carried a workflow whose only job was to
win the slot back after each release, which meant the Releases page led with a
64-character digest and no `vX.Y.Z` was ever the release a visitor saw first.

A branch removes the conflict instead of arbitrating it. `catalogs/<catalogId>/`
is content-addressed exactly as the release tag was: a build that produced
different bytes has a different `catalogId` and therefore a different path, so a
pinned URL is immutable by construction. `raw.githubusercontent.com` serves it
with `access-control-allow-origin: *`, so a browser can read it directly, which a
GitHub release asset cannot do. Releases are left to mean one thing — a version.

Consumers should use the stable latest URL for discovery, then pin the
digest-derived URL and exact `catalogId` for caching and audit records.

The two kinds of digest in `integrity.json` are taken over different things,
and a verifier has to reproduce each exactly:

- an **artifact** digest (`files`) is the canonical digest of the artifact
  _text_: read the fetched artifact as a string, canonicalize that string as a
  JSON value (a string canonicalizes to its own quoted JSON form), then hash the
  UTF-8 bytes of the result. It is deliberately not `sha256` of the file bytes,
  so a checker hashing the raw file disagrees with every published snapshot even
  though the snapshot is consistent. `canonicalDigest` in Adea's
  `@adea/workspace-ui` and `digest` in this repository's `@adea-ai/plugins`
  implement the convention on either side.
- an **asset** digest (`assets[i].digest`) is `sha256` over the mirrored mark's
  bytes, because a client stores those bytes; `icon.digest` in a product record
  is the same value.

The artifact convention is what every shipped consumer implements, so it cannot
change on one side. Making the artifacts verifiable with a plain `sha256sum` too
— the obvious reason to want byte digests — would mean publishing byte digests
and teaching every consumer to accept them, which is a breaking change for
already-installed clients: it needs a contract-version bump and a consumer
release that understands the new value before this repository switches, not an
edit here. Until then, compare bytes through the release API's own asset digests
(what `bun run verify:published` does) when the question is "are these the same
files", and use this convention when the question is "did the artifact I fetched
match the manifest".

The checked-in bootstrap/fixture snapshot is not a production freshness claim.
Only a successful live synchronization, identified by current source SHAs and
its generated timestamp, is a production catalog. A release change report may
also contain deterministic `skippedPlugins` entries. Those entries identify
unsafe or incomplete upstream plugins that were excluded; they are not
available for download or execution and do not weaken the snapshot boundary.

Consumers must verify `integrity.json` before accepting any artifact and treat
the following identifiers and fields as opaque, exact values:

| Field                    | Contract                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `catalogId`              | `catalog:<sha256-hex>`; identifies the complete catalog snapshot.                                         |
| `pluginId`               | `plugin:<source-id>:<normalized-name>`; source-qualified and stable across releases.                      |
| `releaseId`              | `release:<sha256-hex>`; identifies one exact plugin release.                                              |
| `canonicalContentDigest` | SHA-256 digest of the normalized release content; persist it with installation state.                     |
| `harnessCompatibility`   | Per-harness status, reasons, and responsible capabilities; descriptive only and never an execution grant. |
| `requiredConnectors`     | Connector names required by the plugin; resolve configuration through Control Plane.                      |
| `requiredCredentials`    | Credential requirement names only; no secret values are published.                                        |
| `securityClassification` | Content resolution, sensitivity level, reasons, and permission-sensitive capability types.                |
| `provenance`             | Source ID, repository, marketplace manifest, upstream name digest, plugin path, and exact commit.         |

Adea is a read-only catalog consumer. It may use the summary, categories,
search text, product grouping, icons, source badges, compatibility, and update
state for browsing.

Catalog JSON is served through Control Plane; brand-mark bytes are served from
an immutable, content-addressed asset base, substituted per deployment. The
[fetch patterns](consumer-fetch-patterns.md#who-serves-what) document which
surface answers which request and why.

`categories.v1.json` is the browsing index and is already deduplicated, ranked
and sorted. It carries the category list, each category's display order and
curated `topProductKeys` shelf, the shard artifact names to fetch for records,
and `diagnostics` (an advisory list of curated names that no longer resolve).
Product records live in `catalog-index.v1.json` and in the per-category shards:
each holds one entry per product with its canonical `pluginId`, its
`variantPluginIds`, and its `icon`, `license`, `capabilitySummary` and
compatibility statuses. Consumers must not re-group, re-sort or slice
`pluginIds` for a shelf, and must not derive icons by inspecting file paths:
`icon.asset` names a mirrored asset in the same release. An install or enable action submits `pluginId`, exact
`releaseId`, `canonicalContentDigest`, and the requested harness to Control
Plane. Adea never downloads or executes upstream plugin content.

Control Plane fetches the immutable snapshot server-side, verifies the catalog
and content digests, checks revocation/supersession and policy, resolves
connectors and credentials through its own authorities, and preserves the
release ID and digest in installation and execution records. Catalog metadata
does not grant execution authority.

If this repository becomes private, browser clients must not fetch GitHub
directly. Control Plane must use a scoped GitHub App/token server-side and
expose a sanitized catalog API or a public signed read-only artifact endpoint;
the Adea contract remains the same.
