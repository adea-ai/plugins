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

The scheduled workflow compares source heads first. If all four heads equal the
lock, it exits successfully without touching generated files. When any head
changes, it builds a temporary catalog, validates schemas and integrity, writes
a JSON change report, commits the replacement to `main`, and creates a release
tag whose name is derived from the catalog digest. The workflow attaches the
six required versioned artifacts plus the byte-identical
`catalog-latest.v1.json` pointer to a draft, then publishes it. GitHub immutable
releases are enabled for this repository, so a published catalog tag and its
assets cannot be replaced in place.

If parsing, source resolution, policy, classification, integrity, or artifact
publication fails, the workflow fails and the previous generated snapshot and
release remain available. Recovery is to fix the source or policy issue and
rerun `workflow_dispatch`; no human approval queue is created.

An unsafe individual plugin does not become executable content. When its
snapshot contains symlinks, unsafe paths, unsupported submodules, invalid
plugin metadata, or exceeds a content limit, it is skipped and the JSON change
report records its source-qualified `pluginId`, reason code, security reason,
affected paths, and `incompleteContent: true`. The rest of the four-source
catalog may still publish. A skipped plugin is not present in the catalog and
must not be materialized by Adea or Control Plane.
