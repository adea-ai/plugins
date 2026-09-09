# Adea Plugin Marketplace

This repository is a deterministic, static marketplace compiler for the official
OpenAI, Cursor, Claude Code, and Anthropic knowledge-work plugin marketplaces.
Its canonical portable package format is **Agent Plugins 1.0**: skills and MCP
configuration, with supporting files preserved. Adea users select one plugin;
Control Plane binds its approved components to whichever compatible harness is
orchestrated. Native package loading is preferred when supported; explicit
component adapters cover other runtimes.

This repository remains a metadata and provenance boundary: it never installs
or executes an upstream plugin, hook, MCP server, package lifecycle script,
binary, or command. Compatibility and execution authorization are separate.

The [Agent Plugins and Control Plane contract](docs/agent-plugins.md) defines
canonical packages, v2 installation plans, capability negotiation, and migration.
It supersedes the legacy file-projection model for the new default CLI path.

## Quick start

```sh
bun install --frozen-lockfile
bun run catalog help
bun run catalog sync --offline --fixture-root fixtures --output /tmp/adea-fixture-catalog
bun run catalog validate --output /tmp/adea-fixture-catalog --require-portable
bun run catalog verify-integrity --output /tmp/adea-fixture-catalog
bun run schema:plugins
```

The fixture suite is offline and deterministic. `--output` leaves `generated/`
untouched. Existing checked-in catalog snapshots remain readable, but they must
be regenerated before requesting canonical v2 installation plans. Do not mistake
an offline fixture catalog for a production snapshot. Live discovery is explicit:

```sh
bun run catalog sync --dry-run --metadata-only --json
```

Live synchronization resolves the four configured marketplace heads, fetches
only manifests in dry-run mode, and reports whether a source changed. A full
live build additionally retrieves immutable Git trees and raw files through the
source adapter. A failed build never replaces `generated/`. Unsafe individual
plugins are skipped with a deterministic security reason in the synchronization
change report; their content is never followed or published. The remaining safe
plugins can still form a live catalog. Canonical packages have per-component
diagnostics: a skipped MCP entry does not disable a valid skill. Nonportable
hooks, commands, rules and client extensions are not advertised as portable.
Dry-run and metadata-only never publish, including when combined with `--write`.

To plan installation, obtain a capability profile from the actual Control Plane
harness adapter; the harness brand alone is insufficient:

```sh
bun run catalog materialize-plan \
  --plugin plugin:openai-official:linear \
  --capabilities /absolute/path/to/adapter-profile.json \
  --instance stable-user-workspace-installation-id \
  --json
```

The selected catalog must first have canonical package metadata. All plans set
`allowedToActivate: false` and require a separate Control Plane approval. Partial
installations require explicit `--allow-partial`; missing capabilities are not
silently accepted.

## Architecture

- `packages/catalog-schema` — Zod-backed versioned contracts and runtime parsing.
- `packages/source-adapters` — OpenAI, Cursor, and Claude marketplace dialects,
  source-reference normalization, duplicate-key JSON parsing, and path/URL gates.
- `packages/catalog-core` — immutable ref resolution, safe snapshots,
  canonical package recipes, component diagnostics, deterministic artifacts,
  integrity, and atomic last-known-good publication.
- `packages/harness-adapters` — capability-negotiated v2 installation plans,
  stable instance data keys, and MCP launch/connect descriptors; original v1
  materialization APIs remain available for migration.
- `packages/cli` — the `plugins` command surface.

The full boundary and data flow are in [`docs/architecture.md`](docs/architecture.md).
Existing catalog URL/field contracts remain in
[`docs/consumer-contract.md`](docs/consumer-contract.md); the new package and
activation-planning contract is in [`docs/agent-plugins.md`](docs/agent-plugins.md).

## Commands

| Command                                                          | Purpose                                                                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`                                                           | Resolve immutable sources and compile canonical packages; supports `--offline`, `--dry-run`, `--metadata-only`, `--from-lock`, and `--output`. |
| `validate`                                                       | Validate catalog, lock and integrity; `--require-portable` additionally requires complete sources and canonical descriptors.                   |
| `inspect <plugin-id>`                                            | Show normalized metadata and component diagnostics.                                                                                            |
| `diff <old-lock> <new-lock>`                                     | Compare immutable source pins.                                                                                                                 |
| `materialize-plan --plugin ID --capabilities PATH --instance ID` | Produce a v2 native-package or component-adapter plan without installing.                                                                      |
| `build-catalog`                                                  | Alias for synchronization; dry-run and metadata-only remain nonwriting.                                                                        |
| `verify-integrity`                                               | Verify generated artifact digests and canonical metadata.                                                                                      |

`--legacy-catalog` selects the original compiler. `materialize-plan --legacy-plan
--plugin ID --harness H` retains the v1 planning path. These switches are for
migration, not claims of universal legacy feature support.

Every command supports `--json` where a machine-readable response is useful.

## Generated artifacts

The published artifact set contains:

- `catalog.v1.json` — source-qualified plugins, releases, capabilities,
  compatibility, licenses, and provenance; canonical synchronization adds versioned
  `releaseMetadata.agentPlugins` recipes.
- `catalog-summary.v1.json` — counts, categories, product groups, and search text.
- `sources.lock.json` — resolved immutable marketplace commits and manifest digests.
- `compatibility.v1.json` and `categories.v1.json` — narrow consumer indexes.
- `integrity.json` — SHA-256 digests for every artifact except itself.

`generated/` is replaced using a temporary directory swap only after parsing,
integrity, and deterministic generation complete. This is the last-known-good
gate used by scheduled synchronization. Source byte digests and derived package
digests remain distinct. No new public artifact URL is required; catalog v1
readers can continue parsing the existing extensible metadata field.

## Automation

`.github/workflows/marketplace-sync.yml` runs every six hours and on manual
dispatch. The canonical compiler also detects old catalogs without package metadata and
replays verified source pins once, even when source heads are unchanged. After
migration, unchanged sources remain no-ops. The workflow builds and validates
changed artifacts, commits generated artifacts to `main`, and publishes
an immutable catalog release plus a latest catalog asset. All required assets
are attached before publication, and CI verifies that the published release is
actually immutable. It also bootstraps the release when the current catalog is
unchanged but has never been published. CI runs formatting,
lint, type checking, tests, build, schema/integrity, determinism, and generated
artifact consistency checks. Original fixture goldens are preserved with
`--legacy-catalog`; a separate canonical fixture pass validates package metadata
and determinism. Applying a source patch does not itself regenerate or publish
catalog data. Review the [staged migration procedure](docs/agent-plugins.md#cli-and-migration)
before switching consumers to v2 plans.

For first publication, `workflow_dispatch` supports `bootstrap-only`, which
validates and publishes the checked-in last-known-good catalog without live
upstream retrieval.

## Licensing

The marketplace compiler follows the existing Adea organization Apache-2.0
policy. Upstream plugin code and metadata retain their upstream license and
copyright; this repository does not relicense upstream content. The current
snapshot records `Unknown` when a plugin does not declare a license.
