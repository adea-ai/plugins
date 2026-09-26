# Adea integration

The exact artifact URLs and field contract are maintained in
[`consumer-contract.md`](consumer-contract.md).

Adea should consume static JSON over a pinned catalog snapshot or the stable
latest artifact. The fetch pattern per screen, with sizes and cache lifetimes,
is defined in [consumer fetch patterns](consumer-fetch-patterns.md): navigation
and one shelf per visible category for the default view, one category artifact
for "view more", `catalog-index.v1.json` for the complete list, and
`catalog.v1.json` only for detail or install. It can use:

- `catalog-summary.v1.json` for counts and flat search text;
- `categories.v1.json` for category navigation, its `topProductKeys` shelf
  order and the shard artifact names to fetch
  (see [categories and ranking](categories-and-ranking.md));
- `productGroupingKey` to group variants without merging their identities, and
  `variantPluginIds` to offer an alternative source for the same product;
- each product's `icon` for a brand mark mirrored into the release, plus
  `homepage`, `authors`, `sourceId` and provenance for cards and badges. Icons
  need no favicon lookup, no upstream fetch and no fallback search: a product
  with no conventional mark reports `icon: null` and should render its display
  name;
- `harnessCompatibility` to explain availability per harness;
- release version, content digest, and `securityClassification` for update state;
- connector and credential requirements to explain setup before requesting install.

Adea must not download and execute upstream content. An install or enable
button should submit the stable `pluginId`, exact `releaseId`, and requested
harness to Control Plane. The `metadata-only` marker should be shown as
“source metadata only” and must not be presented as a completed security review.
