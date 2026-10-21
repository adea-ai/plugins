# Adea integration

Adea consumes marketplace metadata through Control Plane. The browser and
desktop client call Adea's same-origin `/api/marketplace/catalog` route; that
server route calls the authenticated Control Plane catalog API. Control Plane
fetches the public `catalog-assets` pointer, resolves its immutable snapshot,
and verifies the published artifact set. Adea then independently verifies the
catalog bundle before mapping it into the workspace UI.

The publisher's artifact URLs and field contracts are documented in
[`consumer-contract.md`](consumer-contract.md). Adea uses:

- `catalog-summary.v1.json` for counts and flat search text;
- `categories.v1.json` for category navigation, shelf order, shard names, and
  optional public browsing-index and icon URLs;
- `catalog-index.v1.json`, when the category artifact names it, as a smaller
  browsing catalog. Adea fetches it from that public immutable URL and accepts
  it only when the digest in `integrity.json` and the `catalogId` match. If the
  URL is absent, fails, or has a digest mismatch, Adea renders from the full
  catalog returned through Control Plane;
- icon resolution prefers a URL in the upstream plugin's `icons` field, then a
  compiled mark when one is published, then may use the company's favicon via
  Google's favicon service or a Simple Icons brand URL. Compiled marks use
  content-addressed public asset URLs. Catalog and index digest checks verify
  JSON artifacts; they do not automatically verify every image response;
- `harnessCompatibility` to explain descriptive availability per harness;
- release version, content digest, and `securityClassification` for update and
  safety state;
- connector and credential requirement names to explain setup before an
  installation request.

Product records keep source-qualified `pluginId` and `releaseId` values even
when the browsing index groups marketplace variants as one product. The exact
variant selected for an action is the one Adea submits to Control Plane.
`metadata-only` entries are shown as unavailable metadata and cannot be enabled.
A cached last-known-good catalog is labeled stale; a failed verification is
fail-closed.

For releases with `releaseMetadata.agentPlugins`, Adea calls its same-origin
`/api/marketplace/install-plan` route before submitting an install request. The
Control Plane profile comes from its tested runtime adapter authority. Adea
checks that the advisory plan matches the requested `pluginId`, `releaseId`,
and installation instance, with `allowedToActivate: false` and
`approvalRequired: true`. A plan is not installation approval and does not
activate a plugin. Releases without Agent Plugins metadata use the existing
v1-compatible request path.

Add or Enable submits the exact `pluginId`, `releaseId`,
`canonicalContentDigest`, requested harness, stable installation instance, and
workspace/user identity through Adea's same-origin `/api/marketplace/install`
route. Control Plane owns release verification, policy and credential checks,
the idempotent installation record, and execution references. Adea does not
claim installation from local storage, download plugin source files, or execute
plugin content. The compiler in this repository produces catalog metadata and
plans; it does not install files or start an MCP server or command.
