# @adea-ai/catalog-core

Deterministic compiler for AI agent plugin marketplaces. Parse marketplace
sources, verify provenance against pinned Git trees, merge into a canonical
catalog, and compile provenance-checked static artifacts — byte-for-byte
reproducible from the same inputs.

Pairs with [`@adea-ai/catalog-schema`](https://www.npmjs.com/package/@adea-ai/catalog-schema)
(the schemas), [`@adea-ai/source-adapters`](https://www.npmjs.com/package/@adea-ai/source-adapters)
(source parsing), and [`@adea-ai/harness-adapters`](https://www.npmjs.com/package/@adea-ai/harness-adapters)
(per-harness materialization).

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

## Install

```sh
bun add @adea-ai/catalog-core
```

## Usage

```ts
import { verifyArtifacts } from '@adea-ai/catalog-core/publication'
```

## Design rules

- Same inputs, same bytes: compilation is deterministic and offline-safe.
- Every artifact carries provenance; `sources.lock.json` pins the exact Git
  trees and digests a catalog was built from.
- The compiler is a metadata boundary — it never installs or executes
  upstream plugins, hooks, MCP servers, or binaries.

## License

Apache-2.0
