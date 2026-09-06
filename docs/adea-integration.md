# Adea integration

The exact artifact URLs and field contract are maintained in
[`consumer-contract.md`](consumer-contract.md).

Adea should consume static JSON over a pinned catalog release or the stable
latest artifact. It can use:

- `catalog-summary.v1.json` for counts and search text;
- `categories.v1.json` for category navigation;
- `productGroupingKey` to group variants without merging their identities;
- `icons`, `homepage`, `authors`, `sourceId`, and provenance for cards and badges;
- `harnessCompatibility` to explain availability per harness;
- release version, content digest, and `securityClassification` for update state;
- connector and credential requirements to explain setup before requesting install.

Adea must not download and execute upstream content. An install or enable
button should submit the stable `pluginId`, exact `releaseId`, and requested
harness to Control Plane. The `metadata-only` marker should be shown as
“source metadata only” and must not be presented as a completed security review.
