# @adea-ai/plugins

The marketplace toolkit for AI agent plugin catalogs, published as one package.
Parse marketplace sources, verify provenance against pinned Git trees, merge
into a canonical catalog, compile provenance-checked static artifacts, and
materialize per-harness installation plans — byte-for-byte reproducible from the
same inputs.

## Install

```sh
bun add @adea-ai/plugins
```

## Entry points

| Import                                   | Contents                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `@adea-ai/plugins`                       | Catalog compilation, artifacts, integrity, and last-known-good publication.             |
| `@adea-ai/plugins/schema`                | Zod-backed versioned contracts and runtime parsing.                                     |
| `@adea-ai/plugins/sources`               | OpenAI, Cursor, and Claude marketplace dialects, ref normalization, path and URL gates. |
| `@adea-ai/plugins/harness`               | Capability-negotiated v2 installation plans and MCP launch descriptors.                 |
| `@adea-ai/plugins/publication`           | Where a published catalog lives, and the URLs that address it.                          |
| `@adea-ai/plugins/portable-catalog`      | Offline synchronization and verification against a source lock.                         |
| `@adea-ai/plugins/agent-plugins`         | Canonical package compilation.                                                          |
| `@adea-ai/plugins/agent-plugins/schema`  | Agent plugin and harness profile schemas.                                               |
| `@adea-ai/plugins/agent-plugins/harness` | Harness binding resolution and path verification.                                       |

The former `@adea-ai/catalog-core`, `@adea-ai/catalog-schema`,
`@adea-ai/source-adapters`, and `@adea-ai/harness-adapters` packages are
consolidated here. Their dependency graph was already total, so they versioned
in lockstep; the subpaths above keep each surface addressable on its own.

## What's inside

- **Catalog compilation** — merge parsed marketplace sources into one
  canonical, policy-checked catalog.
- **Integrity verification** — sha256 content digests, SHA-pinned Git trees,
  and `verifyArtifacts` for published artifact sets.
- **Publication artifacts** — `catalog.v1.json`, `catalog-summary.v1.json`,
  `categories.v1.json`, `compatibility.v1.json`, `sources.lock.json`, and
  `integrity.json` with deterministic serialization.
- **Policy enforcement** — repository protocol/host allowlists and source
  trust classification.
- **Harness materialization** — v2 installation plans keyed by stable instance
  data, plus MCP launch and connect descriptors.

## The catalog is not in this package

A catalog snapshot is roughly 38 MB and changes whenever an upstream
marketplace moves — several times a day. Shipping it inside a semver package
would force a toolkit release on every data change and churn every consumer's
lockfile, so the catalog is published to the content-addressed `catalog-assets`
branch instead. `@adea-ai/plugins` addresses those URLs; it does not embed
them. See [the consumer contract](https://github.com/adea-ai/plugins/blob/main/docs/consumer-contract.md).

## Usage

```ts
import { verifyArtifacts } from '@adea-ai/plugins'
import { catalogSnapshotBaseUrl } from '@adea-ai/plugins/publication'
```

## Design rules

- Same inputs, same bytes: compilation is deterministic and offline-safe.
- Every artifact carries provenance; `sources.lock.json` pins the exact Git
  trees and digests a catalog was built from.
- The compiler is a metadata boundary — it never installs or executes
  upstream plugins, hooks, MCP servers, or binaries.

## License

Apache-2.0
