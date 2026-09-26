# Control Plane integration

The exact artifact URLs, immutable tag format, and consumer field contract are
maintained in [`consumer-contract.md`](consumer-contract.md).

Control Plane remains the authority for workspace installations, policy,
credentials, and execution. It should fetch an immutable catalog snapshot,
verify `integrity.json`, parse `catalog.v1.json`, and resolve an exact
`pluginId` plus `releaseId`.

For the existing Control Plane domain contracts, map a plugin release as follows:

| Marketplace field        | Control Plane use                                                               |
| ------------------------ | ------------------------------------------------------------------------------- |
| `releaseId`              | immutable external version reference in a SkillVersion or execution input       |
| `canonicalContentDigest` | exact content digest retained with the version and later ExecutionPlan          |
| `capabilities`           | normalized capability/tool requirements, subject to policy evaluation           |
| `requiredConnectors`     | connector requirements, never credentials                                       |
| `requiredCredentials`    | setup requirements only; resolve values through the credential vault            |
| `harnessCompatibility`   | projection selection and preflight explanation                                  |
| `provenance`             | source URL, manifest, upstream name, commit, and entry digest in audit metadata |

The Control Plane `ExecutionPlanPin` already requires an `executionPlanId`, a
`contentDigest`, and a schema version. Preserve the marketplace release ID and
digest alongside that pin so retries and audits cannot drift to a newer release.
The existing SkillVersion contract similarly retains manifest content digest and
required capability/tool declarations.

Before materialization, Control Plane should reject a missing, revoked, or
superseded release; reject `metadata-only` content when policy requires complete
content; re-evaluate capability compatibility for the selected harness; and keep
reusable connector credentials outside catalog artifacts. Catalog availability
does not grant execution authority.
