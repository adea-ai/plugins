# Architecture

The marketplace is a stateless compiler. GitHub Actions supplies the periodic
trigger; Git commits, release assets, and static JSON are the persistence layer.

```text
official marketplace manifests
              |
  immutable source-head resolver
              |
  dialect adapter + strict JSON parser
              |
safe Git tree/raw snapshotter ---- source lock
              |
  metadata normalization + capability classifier
              |
 deterministic catalog and indexes
              |
 Adea browsing     Control Plane exact resolution
```

The source lock contains one resolved commit per configured official repository.
Local plugin sources inherit that commit. External Git and Git-subdirectory
sources retain their URL, subdirectory, ref, and pinned SHA; an unpinned ref is
resolved with `git ls-remote` before it is accepted.

Live retrieval uses GitHub's immutable tree endpoint and raw content URLs. The
adapter enforces file count, file size, total size, relative paths, HTTPS, and
the configured host allow-list. It does not run repository files. Fixture mode
uses the same normalizer with local directories and is the required deterministic
test path.

`metadata-only` mode is intended for safe discovery and dry runs. It produces a
stable source-reference digest and marks each release and security record as
`metadata-only`; a consumer must not treat that marker as proof that plugin
bytes were inspected. Complete-content builds hash sorted path/byte pairs.

Publication is fail-closed: all data is built in memory and written to a
temporary directory. The existing generated directory is moved aside only when
the replacement is ready, then swapped atomically. A failed build leaves the
previous catalog untouched.
