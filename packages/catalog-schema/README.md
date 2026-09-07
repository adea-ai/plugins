# @adea-ai/catalog-schema

Deterministic, provenance-first schemas for AI agent plugin marketplaces.
One Zod schema (plus JSON Schemas for non-TypeScript consumers) describing
plugin catalogs across harnesses: **Codex, Claude Code, Cursor, Pi, Hermes,
OpenCode**, and generic skill/MCP targets.

The schema is a metadata and provenance boundary. It describes what a plugin
is, where it came from, and how it maps onto harnesses — it never installs or
executes anything.

## What's inside

- **Catalog schemas** — plugins, releases, capabilities (`skill`,
  `mcp-server`, `connector`, `command`, `agent`, `hook`, `rule`, and more),
  categories, and sources.
- **Provenance** — source lock entries with SHA-pinned Git trees, sha256
  content digests, license metadata, and security classifications.
- **Harness compatibility** — per-harness status (`native`, `portable`,
  `requires-translation`, `blocked-by-policy`, …) and materialization plans.
- **JSON Schemas** — language-agnostic validation artifacts
  (`catalog.v1`, `compatibility.v1`, `sources-lock.v1`).

## Install

```sh
bun add @adea-ai/catalog-schema
```

## Usage

```ts
import { CatalogSchema, PluginSchema, HarnessSchema } from '@adea-ai/catalog-schema'

const catalog = CatalogSchema.parse(rawCatalog)
```

JSON Schemas are available as files for non-TypeScript consumers:

```ts
import catalogSchema from '@adea-ai/catalog-schema/schema/catalog.v1.schema.json' with { type: 'json' }
```

## Design rules

- Digests are `sha256:<64 hex>`; Git SHAs are 40-char hex; timestamps carry an
  explicit offset.
- Harness identifiers are a closed enum; unknown harnesses fail validation
  rather than passing silently.
- Every plugin release carries provenance: repository, commit, and content
  digests.

## License

Apache-2.0
