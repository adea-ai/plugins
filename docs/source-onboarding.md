# Adding an official marketplace source

New discovery sources are intentionally explicit. Add one entry to
`config/sources.json`, provide an adapter dialect and a checked-in fixture
manifest, then add category aliases and product aliases only when the source
requires them. The source repository and every external plugin repository must
remain HTTPS GitHub URLs under the allow-list.

A new source usually republishes products the other sources already carry, as a
second `google-calendar` or `github`. Add its `sourceId` to `sourcePreference`
in `config/product-preference.json` so the consumer index still resolves one
canonical variant per product; see
[categories and ranking](categories-and-ranking.md).

Before publication, run the offline fixture sync and the complete validation
gates. A live sync must resolve the source manifest and every mutable plugin
ref to commit SHAs. The generated lock records those per-plugin pins so a
replay is independent of branch movement.

Do not add private caches, undocumented endpoints, credentials, executable
install hooks, or unreviewed source hosts. If a new source expands sensitive
capabilities, include the policy impact in the change report and require an
explicit review before enabling publication.
