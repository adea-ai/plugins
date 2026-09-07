# @adea-ai/source-adapters

Deterministic source adapters for AI agent plugin marketplaces: parse
marketplace manifests into typed plugin entries, canonicalize repository
URLs, and pin every fetched artifact to an immutable Git tree and sha256
content digest.

Runtime-neutral (Node or Bun), dependency-free, and metadata-only — adapters
parse and verify; they never install or execute upstream plugins.

## What's inside

- **Manifest parsing** — marketplace manifests into validated
  `ParsedMarketplace` / `MarketplacePluginEntry` records.
- **Source configuration** — typed `SourceConfig` and `PluginSourceSpec`
  definitions with fixture support for offline runs.
- **Canonicalization** — canonical repository URLs and safe relative paths.
- **Provenance primitives** — SHA-pinned refs, raw-file URL construction,
  and content digest helpers.

## Install

```sh
bun add @adea-ai/source-adapters
```

## Usage

```ts
import { parseMarketplaceManifest, canonicalRepositoryUrl } from '@adea-ai/source-adapters'

const parsed = parseMarketplaceManifest(rawManifest)
```

## License

Apache-2.0
