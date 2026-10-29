# Generated artifact and release policy

`generated/` is a reproducible snapshot, not a cache. A source lock is sufficient
to reconstruct the manifest inputs without querying mutable branch heads:

```sh
bun run catalog sync --offline --from-lock generated/sources.lock.json --dry-run
```

The checked-in fixture snapshot and its first bootstrap release are labeled by
their fixture timestamps and fixture SHAs. They are useful for deterministic
development and bootstrapping only; they are not a live production catalog.
Successful live synchronization replaces them with a snapshot whose
`generatedAt`, source locks, and plugin release pins come from the live run.

For a real repository snapshot, use `bun run catalog sync --from-lock PATH`;
the immutable commit is fetched directly. Rebuilding from the same lock and
same source bytes must produce byte-identical JSON.

The scheduled workflow compares source heads first. If all four configured
repository heads equal the lock, it exits successfully without touching
generated files. When any head
changes, it builds a temporary catalog, validates schemas, integrity, and every
configured curated shelf name, and writes a JSON change report. It publishes the
snapshot to `catalog-assets` under `catalogs/<catalogId-suffix>/`, where
`<catalogId-suffix>` is the catalog's own digest, then verifies the published
bytes by reading them back. After verification, it commits the generated
replacement to a bot-owned branch and opens or updates a pull request to `main`.
Artifacts declared in the `files` map and the `integrity.json` manifest go into
that directory. Mirrored brand marks, listed separately in `integrity.json`'s
`assets[]`, go to the branch root where their content-addressed names resolve.
The byte-identical `catalog-latest.v1.json` pointer is written at the root. Because
the path is derived from the content, no build that produced different bytes can
write over an existing snapshot, and previously published snapshots are fetched
and preserved so pinned URLs keep resolving. A force-push carries no immutability
guarantee, so the workflow reads the published bytes back from the URLs a
consumer will use and compares them against what it staged before reporting
success.

This workflow publishes static catalog metadata and mirrored marks only. It
does not install plugin files or execute a plugin, lifecycle script, MCP server,
binary, or command. Versioned npm package releases use a separate workflow.

Verification commands validate manifest names before reading files. Their input
directories must still be trusted staging directories: a flat name can refer to
a symlink, and another process able to change the directories during verification
can change what is read. These commands do not provide filesystem confinement
against a hostile local writer.

The curated-shelf check runs before the workflow writes the asset branch. A
missing curated product therefore fails the sync while the existing mutable
pointer and immutable snapshots remain intact.

If parsing, source resolution, policy, classification, integrity, or artifact
publication fails, the workflow fails and the previously published snapshot
remains available. Recovery is to fix the source or policy issue and rerun
`workflow_dispatch`; no human approval queue is created.

The published set has a fixed core and two derived families:

- core: `catalog.v1.json`, `catalog-summary.v1.json`, `sources.lock.json`,
  `compatibility.v1.json`, `categories.v1.json`, `integrity.json`;
- consumer shards: `catalog-index.v1.json`, `shelf-<category>.v1.json` and
  `category-<category>.v1.json`, one shelf and one list per configured category;
- brand marks: `icon-<digest>.<ext>` assets, staged outside `generated/` so the
  repository keeps only text artifacts and the release carries the bytes.

`categories.v1.json` is navigation: the category list, each category's display
order, its curated `topProductKeys` shelf, the shard names to fetch for full
records, and a `diagnostics` list of curated names that no longer resolve.
Product records live in the shards, with one entry per product and its canonical
plugin ID, its source variants, and its `icon`, licence, capability summary and
compatibility statuses. Everything is derived from `catalog.v1.json` and never
adds or removes plugins; `verify-integrity` rejects a set whose membership,
counts, shelves, shards or declared asset digests contradict it. `integrity.json`
enumerates every artifact and every mirrored asset, so the release inventory is
self-describing and the workflow uploads exactly what the catalog declares.

An unsafe individual plugin does not become executable content. When its
snapshot contains symlinks, unsafe paths, unsupported submodules, invalid
plugin metadata, or exceeds a content limit, it is skipped and the JSON change
report records its source-qualified `pluginId`, reason code, security reason,
affected paths, and `incompleteContent: true`. Other safe plugins can still be
included in the catalog. A skipped plugin is not present and
must not be materialized by Adea or Control Plane.
