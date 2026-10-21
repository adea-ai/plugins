# Architecture

This repository is a stateless catalog compiler and planning library. Four
public source repositories use three marketplace dialects: OpenAI, Cursor, and
Claude. GitHub Actions supplies the periodic trigger; Git commits and the
`catalog-assets` branch hold the generated metadata and static artifacts.

```text
four configured source repositories
              |
 immutable source-head resolver
              |
 dialect adapter + strict JSON parser
              |
safe Git tree/raw snapshotter ---- source lock
              |
 metadata normalization + capability classifier
              |
 deterministic catalog and consumer artifacts
              |
 publish immutable snapshot + latest pointer to catalog-assets
              |
 open draft PR with generated artifacts for main

Control Plane server -- fetches and verifies --> catalog-assets publication
       |
       | authenticated /v1/marketplace/catalog response
       v
Adea same-origin /api/marketplace/catalog route ---> Adea UI verifies bundle
                                                        |
                                                        +--> optional public index URL
                                                        +--> immutable icon URLs

Adea same-origin plan/install routes -----------> Control Plane API
                                                   (policy and installation state)
```

The source lock contains one resolved commit per configured repository. Local
plugin sources inherit that commit. External Git and Git-subdirectory sources
retain their URL, subdirectory, ref, and pinned SHA; an unpinned ref is resolved
with `git ls-remote` before it is accepted.

Live retrieval uses GitHub's immutable tree endpoint and raw content URLs. The
adapter enforces file count, file size, total size, relative paths, HTTPS, and
the configured host allow-list. It does not run repository files. Fixture mode
uses the same normalizer with local directories and is the required deterministic
test path.

The compiler emits metadata, package descriptors, plans, and MCP binding
descriptors. It does not install plugin files into a harness, run plugin or
lifecycle code, or start servers or commands. The Control Plane fetches and
verifies the published catalog server-side. Adea receives the catalog response
through its same-origin route and verifies it again. The browsing index may be
fetched from its public immutable URL and checked against the digest declared in
`integrity.json`; compiled brand marks use their content-addressed public URLs.
Adea's icon resolver may instead use an upstream icon URL or a Google favicon or
Simple Icons fallback. The index digest does not verify image response bytes.
Adea routes installation and plan requests back through Control Plane.

`metadata-only` mode is intended for safe discovery and dry runs. It produces a
stable source-reference digest and marks each release and security record as
`metadata-only`; a consumer must not treat that marker as proof that plugin
bytes were inspected. Complete-content builds hash sorted path/byte pairs.

Publication is fail-closed: all data is built in memory and written to a
temporary directory. The existing generated directory is moved aside only when
the replacement is ready, then swapped atomically. A failed build leaves the
previous catalog untouched.
