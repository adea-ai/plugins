# Adea Plugin Marketplace

This repository is a deterministic, static marketplace compiler for three
source dialects (OpenAI, Cursor, and Claude) across four public repositories.
Anthropic maintains two of those sources: its official Claude plugin list and
its knowledge-work plugin list. Its canonical portable package format is
**Agent Plugins 1.0**: skills and MCP configuration, with supporting files
preserved.

This repository remains a compiler and planning boundary. It reads pinned
upstream snapshots and publishes catalog metadata, canonical package
descriptors, and installation plans. It never installs upstream files into a
harness, runs plugin code or lifecycle scripts, starts MCP servers, or invokes
binaries or commands. Compatibility and execution authorization are separate;
the plans produced here do not grant activation.

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

Live synchronization resolves the four configured repository heads (one
OpenAI source, one Cursor source, and two Anthropic sources), fetches only
manifests in dry-run mode, and reports whether a source changed. A full
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
plans require explicit `--allow-partial`; missing capabilities are not
silently accepted.

## Architecture

The toolkit ships as one npm package, `@adea-ai/plugins`, so that a consumer
installs a single version and a release means one thing. Its internals stay
separately addressable through subpath exports.

- `@adea-ai/plugins/schema`: Zod-backed versioned contracts and runtime parsing.
- `@adea-ai/plugins/sources`: OpenAI, Cursor, and Claude marketplace dialects,
  source-reference normalization, duplicate-key JSON parsing, and path/URL gates.
- `@adea-ai/plugins`: immutable ref resolution, safe snapshots,
  canonical package recipes, component diagnostics, deterministic artifacts,
  integrity, and atomic last-known-good publication.
- `@adea-ai/plugins/harness`: capability-negotiated v2 installation plans,
  stable instance data keys, and MCP launch/connect descriptors. These are
  planning data for consuming integrations; this package does not write files
  or start processes. Original v1 materialization APIs remain available for
  migration.
- `packages/cli`: the `plugins` command surface, kept repository-internal.

The full boundary and data flow are in [`docs/architecture.md`](docs/architecture.md).
Existing catalog URL/field contracts remain in
[`docs/consumer-contract.md`](docs/consumer-contract.md); the new package and
activation-planning contract is in [`docs/agent-plugins.md`](docs/agent-plugins.md).

## Commands

| Command                                                          | Purpose                                                                                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`                                                           | Resolve immutable sources and compile canonical packages; supports `--offline`, `--dry-run`, `--metadata-only`, `--from-lock`, `--output`, and `--force-rebuild`.           |
| `validate`                                                       | Validate catalog, lock and integrity; `--require-portable` additionally requires complete sources and canonical descriptors.                                                |
| `inspect <plugin-id>`                                            | Show normalized metadata and component diagnostics.                                                                                                                         |
| `diff <old-lock> <new-lock>`                                     | Compare immutable source pins.                                                                                                                                              |
| `materialize-plan --plugin ID --capabilities PATH --instance ID` | Produce a v2 native-package or component-adapter plan without installing.                                                                                                   |
| `build-catalog`                                                  | Alias for synchronization; dry-run and metadata-only remain nonwriting.                                                                                                     |
| `verify-integrity`                                               | Verify generated artifact digests and canonical metadata.                                                                                                                   |
| `verify:brand-sites`                                             | Re-resolve every curated site override in `config/product-icons.json`; a site that stops yielding a mark silently costs that product a monogram (`--strict` fails the run). |

`--force-rebuild` rebuilds and republishes even when every source pin is
unchanged, which is how a curation or build-logic change (a new brand mark, a
changed resolution rule) becomes publishable. The sync otherwise exits
unchanged and republishes nothing.

`--legacy-catalog` selects the original compiler. `materialize-plan --legacy-plan
--plugin ID --harness H` retains the v1 planning path. These switches are for
migration, not claims of universal legacy feature support.

Every command supports `--json` where a machine-readable response is useful.

## Generated artifacts

The published artifact set contains:

- `catalog.v1.json`: source-qualified plugins, releases, capabilities,
  compatibility, licenses, and provenance; canonical synchronization adds versioned
  `releaseMetadata.agentPlugins` recipes.
- `catalog-summary.v1.json`: counts, categories, product groups, and search text.
- `sources.lock.json`: resolved immutable marketplace commits and manifest digests.
- `compatibility.v1.json`: per-plugin harness compatibility index.
- `categories.v1.json`: the browsing index with category navigation, curated shelf
  order and the shard names to fetch. See
  [categories and ranking](docs/categories-and-ranking.md) and
  [consumer fetch patterns](docs/consumer-fetch-patterns.md).
- `catalog-index.v1.json`, `shelf-<category>.v1.json`,
  `category-<category>.v1.json`: the consumer shards with deduplicated product
  records, pre-sorted and ready to render.
- `icon-<digest>.<ext>` assets: brand marks mirrored at publish time from the
  plugin's own content, or from the product site's icon when the plugin ships
  none. Compiled marks use content-addressed public asset URLs. Adea's icon
  resolver can use an upstream icon URL first, then a compiled mark, and then
  a Google favicon or Simple Icons URL if neither earlier source applies. The
  index digest does not verify every image response.
- `integrity.json`: SHA-256 digests for every artifact except itself, plus
  digests for mirrored asset bytes.

`generated/` is replaced using a temporary directory swap only after parsing,
integrity, and deterministic generation complete. This is the last-known-good
gate used by scheduled synchronization. Source byte digests and derived package
digests remain distinct. No new public artifact URL is required; catalog v1
readers can continue parsing the existing extensible metadata field.

## Automation

`.github/workflows/marketplace-sync.yml` runs every six hours and on manual
dispatch. The canonical compiler also detects old catalogs without package
metadata and replays verified source pins once, even when source heads are
unchanged. After migration, unchanged sources remain no-ops. The workflow builds and validates
changed artifacts, publishes a snapshot to the content-addressed
`catalog-assets` branch, and opens a pull request with the generated artifacts
for `main`. Each catalog snapshot
lives at `catalogs/<catalogId-suffix>/` and a byte-identical
`catalog-latest.v1.json` pointer sits at the root. CI reads the published bytes
back from the URLs consumers use and compares them against what it staged, since
a force-push gives no immutability guarantee of its own. Releases are reserved
for versions, so the repository publishes one `vX.Y.Z` per release. CI runs
formatting, lint, type checking, tests, build, schema/integrity, determinism,
and generated artifact consistency checks. Original fixture goldens are preserved with
`--legacy-catalog`; a separate canonical fixture pass validates package metadata
and determinism. Applying a source patch does not itself regenerate or publish
catalog data. Review the [staged migration procedure](docs/agent-plugins.md#cli-and-migration)
before switching consumers to v2 plans. The synchronization workflow publishes
static catalog artifacts; it does not install or execute a listed plugin.

The separate `.github/workflows/publish-packages.yml` workflow publishes
`@adea-ai/plugins` after relevant package, schema, or publishing-workflow
changes reach `main`, skipping versions already on npm. It uses npm trusted
publishing; configure a trusted publisher for repository `adea-ai/plugins`,
workflow `publish-packages.yml`, and direct `npm publish` permission. No
long-lived npm token is used.

For first publication, `workflow_dispatch` supports `bootstrap-only`, which
validates and publishes the checked-in last-known-good catalog without live
upstream retrieval.

## Licensing

The marketplace compiler follows the existing Adea organization Apache-2.0
policy. Upstream plugin code and metadata retain their upstream license and
copyright; this repository does not relicense upstream content. The current
snapshot records `Unknown` when a plugin does not declare a license.
