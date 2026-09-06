# Adea Plugin Marketplace

This repository is a deterministic, static marketplace compiler for the official
OpenAI, Cursor, Claude Code, and Anthropic knowledge-work plugin marketplaces.
It is a metadata and provenance boundary: it never installs or executes an
upstream plugin, hook, MCP server, package lifecycle script, binary, or command.

## Quick start

```sh
bun install --frozen-lockfile
bun run catalog help
bun run sync:fixtures
bun run validate
bun run verify:integrity
bun run catalog materialize-plan --plugin plugin:openai-official:linear --harness codex
```

The normal fixture suite is offline and deterministic. The checked-in fixture
catalog/bootstrap release is for development and initial publication only;
it is not a live production snapshot. Live discovery is
explicit:

```sh
bun run catalog sync --dry-run --metadata-only --json
```

Live synchronization resolves the four configured marketplace heads, fetches
only manifests in dry-run mode, and reports whether a source changed. A full
live build additionally retrieves immutable Git trees and raw files through the
source adapter. A failed build never replaces `generated/`. Unsafe individual
plugins are skipped with a deterministic security reason in the synchronization
change report; their content is never followed or published. The remaining safe
plugins can still form a live catalog.

## Architecture

- `packages/catalog-schema` — Zod-backed versioned contracts and runtime parsing.
- `packages/source-adapters` — OpenAI, Cursor, and Claude marketplace dialects,
  source-reference normalization, duplicate-key JSON parsing, and path/URL gates.
- `packages/catalog-core` — immutable ref resolution, safe snapshots,
  normalization, capability classification, deterministic artifacts, integrity,
  and atomic last-known-good publication.
- `packages/harness-adapters` — deterministic materialization plans for Codex,
  Claude Code, Cursor, Pi, Hermes, OpenCode, and generic SKILL/MCP harnesses.
- `packages/cli` — the `plugins` command surface.

The full boundary and data flow are in [`docs/architecture.md`](docs/architecture.md).
The Adea and Control Plane URL/field contract is in
[`docs/consumer-contract.md`](docs/consumer-contract.md).

## Commands

| Command                                    | Purpose                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `sync`                                     | Resolve source heads and build a catalog; supports `--offline`, `--dry-run`, `--source`, `--metadata-only`, and `--from-lock`. |
| `validate`                                 | Parse and validate generated catalog, lock, and integrity contracts.                                                           |
| `inspect <plugin-id>`                      | Print one normalized plugin record.                                                                                            |
| `diff <old-lock> <new-lock>`               | Compare immutable source pins.                                                                                                 |
| `materialize-plan --plugin ID --harness H` | Produce JSON describing copy/translation/ignore actions without installing.                                                    |
| `build-catalog`                            | Alias for a writing synchronization run.                                                                                       |
| `verify-integrity`                         | Verify every generated artifact digest.                                                                                        |

Every command supports `--json` where a machine-readable response is useful.

## Generated artifacts

The checked-in snapshot contains:

- `catalog.v1.json` — source-qualified plugins, releases, capabilities,
  compatibility, licenses, and provenance.
- `catalog-summary.v1.json` — counts, categories, product groups, and search text.
- `sources.lock.json` — resolved immutable marketplace commits and manifest digests.
- `compatibility.v1.json` and `categories.v1.json` — narrow consumer indexes.
- `integrity.json` — SHA-256 digests for every artifact except itself.

`generated/` is replaced using a temporary directory swap only after parsing,
integrity, and deterministic generation complete. This is the last-known-good
gate used by scheduled synchronization.

## Automation

`.github/workflows/marketplace-sync.yml` runs every six hours and on manual
dispatch. It exits without a commit when source heads match the lock, builds and
validates when they differ, commits generated artifacts to `main`, and publishes
an immutable catalog release plus a latest catalog asset. All required assets
are attached before publication, and CI verifies that the published release is
actually immutable. It also bootstraps the release when the current catalog is
unchanged but has never been published. CI runs formatting,
lint, type checking, tests, build, schema/integrity, determinism, and generated
artifact consistency checks.

For first publication, `workflow_dispatch` supports `bootstrap-only`, which
validates and publishes the checked-in last-known-good catalog without live
upstream retrieval.

## Licensing

The marketplace compiler follows the existing Adea organization Apache-2.0
policy. Upstream plugin code and metadata retain their upstream license and
copyright; this repository does not relicense upstream content. The current
snapshot records `Unknown` when a plugin does not declare a license.
