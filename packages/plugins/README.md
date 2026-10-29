# @adea-ai/plugins

The marketplace toolkit for AI agent plugin catalogs, published as one package.
Parse marketplace sources, verify provenance against pinned Git trees, merge
into a canonical catalog, compile provenance-checked static artifacts, and
produce per-harness installation plans. The package does not install plugin
files into a runtime or execute upstream content. Its materialization functions
return in-memory package bytes or structured plans; they do not write to a
harness or start an MCP server or command.

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
| `@adea-ai/plugins/harness`               | Capability-negotiated v2 plans and MCP launch descriptors; no process launch.           |
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

- **Catalog compilation:** merge parsed marketplace sources into one
  canonical, policy-checked catalog.
- **Integrity verification:** sha256 content digests, SHA-pinned Git trees,
  and `verifyArtifacts` for published artifact sets.
- **Publication artifacts:** `catalog.v1.json`, `catalog-summary.v1.json`,
  `categories.v1.json`, `compatibility.v1.json`, `sources.lock.json`, and
  `integrity.json` with deterministic serialization.
- **Policy enforcement:** repository protocol/host allowlists and source
  trust classification.
- **Harness planning:** v2 installation plans keyed by stable instance data,
  plus MCP launch and connect descriptors. These describe proposed file and
  binding operations; they do not authorize or perform an installation.

## The catalog is not in this package

A catalog snapshot is roughly 38 MB and changes whenever an upstream
marketplace moves, several times a day. Shipping it inside a semver package
would force a toolkit release on every data change and churn every consumer's
lockfile, so the catalog is published to the content-addressed `catalog-assets`
branch instead. `@adea-ai/plugins` addresses those URLs; it does not embed
them. See [the consumer contract](https://github.com/adea-ai/plugins/blob/main/docs/consumer-contract.md).

## Usage

```ts
import { verifyArtifacts } from '@adea-ai/plugins'
import { catalogSnapshotBaseUrl } from '@adea-ai/plugins/publication'
```

Direct callers of `verifyShardArtifact` must supply the expected catalog ID as
its fourth argument, obtained from a separately verified catalog. Earlier
three-argument calls did not check shard catalog identity; they now fail with
`SHARD_CATALOG_ID_REQUIRED`. Callers that verify a complete artifact set can use
`verifyArtifacts`, which supplies the catalog ID internally.

## Design rules

- Same inputs, same bytes: compilation is deterministic and offline-safe.
- Every artifact carries provenance; `sources.lock.json` pins the exact Git
  trees and digests a catalog was built from.
- The compiler is a metadata and planning boundary. It never installs or
  executes upstream plugins, hooks, MCP servers, lifecycle scripts, or binaries.

## License

Apache-2.0
