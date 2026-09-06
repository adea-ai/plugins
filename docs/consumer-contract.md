# Adea and Control Plane consumer contract

The repository is currently public. The stable browser-readable catalog URL is:

`https://github.com/adea-ai/plugins/releases/latest/download/catalog-latest.v1.json`

The immutable release URL for the current catalog is derived from `catalogId`:

`https://github.com/adea-ai/plugins/releases/download/catalog/<catalogId-suffix>/catalog.v1.json`

For example, `catalog:abc...` is published under the immutable tag
`catalog/abc...`. Each catalog release contains these six required versioned
artifacts: `catalog.v1.json`, `catalog-summary.v1.json`, `categories.v1.json`,
`compatibility.v1.json`, `integrity.json`, and `sources.lock.json`. It also
contains the `catalog-latest.v1.json` pointer asset, which is byte-identical to
`catalog.v1.json` in that release. The repository’s GitHub immutable-release
setting is enabled; this seven-file asset set is attached before the release is
published.
Consumers should use the stable latest URL for discovery, then pin the
digest-derived release URL and exact `catalogId` for caching and audit records.

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
state for browsing. An install or enable action submits `pluginId`, exact
`releaseId`, `canonicalContentDigest`, and the requested harness to Control
Plane. Adea never downloads or executes upstream plugin content.

Control Plane fetches the immutable release server-side, verifies the catalog
and content digests, checks revocation/supersession and policy, resolves
connectors and credentials through its own authorities, and preserves the
release ID and digest in installation and execution records. Catalog metadata
does not grant execution authority.

If this repository becomes private, browser clients must not fetch GitHub
directly. Control Plane must use a scoped GitHub App/token server-side and
expose a sanitized catalog API or a public signed read-only artifact endpoint;
the Adea contract remains the same.
