# Control Plane read-only alignment notes

The sibling Adea and Control Plane source repositories were inspected without
modification to align this repository's integration documentation.

Control Plane fetches the publisher's latest pointer, resolves the immutable
catalog snapshot, verifies its artifacts, and returns catalog JSON through its
authenticated API. Adea proxies catalog requests through a same-origin server
route and verifies the response. Its client may fetch the public browsing index
and compiled icon assets from the immutable URLs in catalog metadata. Its icon
resolver can also select an upstream icon URL or a Google favicon or Simple
Icons fallback. The index digest does not verify image response bytes.

Control Plane's v2 plan endpoint resolves a profile from its runtime adapter
authority and returns an advisory plan with `allowedToActivate: false` and
`approvalRequired: true`. Its install endpoint verifies the exact release and
policy requirements, then persists an idempotent marketplace installation
record. That endpoint does not return plugin files, install them into a
harness, or launch a runtime. The public compiler and planning APIs in this
repository do not perform those runtime operations either.

The cross-repository consumer contract is in
[`control-plane-integration.md`](control-plane-integration.md) and
[`adea-integration.md`](adea-integration.md).
