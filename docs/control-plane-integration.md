# Control Plane integration

The Control Plane is the server-side catalog and installation-state authority
for Adea. It reads the public catalog publication, verifies the selected
snapshot, and serves catalog metadata through an authenticated API. Adea calls
that API through its same-origin server route; its browser and desktop clients
do not fetch plugin source files or upstream archives.

The publisher exposes a stable latest pointer and immutable catalog snapshots.
The exact artifact URLs and v1 field contracts are maintained in
[`consumer-contract.md`](consumer-contract.md). Control Plane fetches
`catalog-latest.v1.json`, resolves its `catalogId` to
`catalogs/<catalogId-suffix>/`, and verifies the artifacts before returning
them. Adea verifies the returned catalog bundle again before rendering it.
`catalog-index.v1.json` is an optional verified artifact for older snapshots;
the publisher may also expose it at the public URL named by
`categories.v1.json`. Adea checks that URL's index digest against
`integrity.json` before using the smaller browsing index. Mirrored icon bytes
are served from their immutable public asset URLs. The Adea UI also supports an
upstream icon URL and Google favicon or Simple Icons fallbacks. The index digest
checks the index JSON, not every image response.

## API flow

The current integration uses three Control Plane operations:

| Control Plane operation                                     | Purpose                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /v1/marketplace/catalog` (`marketplace:read`)         | Return verified catalog artifact JSON and the workspace's sanitized installation states.      |
| `POST /v1/marketplace/install-plan` (`marketplace:install`) | Produce an Agent Plugins `planVersion: 2` proposal for a verified runtime profile.            |
| `POST /v1/marketplace/install` (`marketplace:install`)      | Accept an idempotent request for one exact plugin release and persist its installation state. |

Adea's same-origin routes proxy these operations using a server-side Control
Plane service credential. Catalog reads are streamed through the proxy. The
browser does not receive the service credential or registry write credentials.

An install-plan request names an exact `pluginId`, `releaseId`, installation
instance, requested harness, and Adea workspace/user identity. Control Plane
obtains the runtime profile from its tested adapter authority; callers must not
infer capability support from a harness brand or accept a profile from the
browser. The response is advisory: `allowedToActivate` is always `false` and
`approvalRequired` is always `true`. A plan describes selected components and
preconditions. It is not permission to install files, resolve credentials, or
start a runtime.

An install request carries the exact `pluginId`, `releaseId`,
`canonicalContentDigest`, requested harness, stable installation instance, and
workspace/user identity. The request is idempotent. Control Plane checks the
catalog entry and digest, content completeness, compatibility, revocation and
supersession state, workspace policy, and required connector and credential
availability before recording a state. The API returns state and pins, not
plugin source files. This compiler repository does not implement a protected
filesystem installer or activate a runtime.

## Persisted references

Control Plane keeps marketplace identity and provenance in its marketplace
installation records and execution references. Preserve these exact values:

| Marketplace field                            | Control Plane use                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `catalogId`                                  | Immutable catalog snapshot used to resolve the request.                  |
| `pluginId`                                   | Source-qualified plugin identity.                                        |
| `releaseId`                                  | Exact immutable plugin release.                                          |
| `canonicalContentDigest`                     | Exact normalized release content digest.                                 |
| `releaseMetadata.agentPlugins.packageDigest` | Derived canonical package recipe digest when present.                    |
| `capabilities`                               | Normalized requirements for policy and adapter planning.                 |
| `requiredConnectors`                         | Connector requirements, never credentials.                               |
| `requiredCredentials`                        | Setup requirements; resolve values through the credential authority.     |
| `harnessCompatibility`                       | Descriptive compatibility evidence, not an execution grant.              |
| `provenance`                                 | Source URL, manifest, upstream name, commit, and entry digest for audit. |

The install-state response can be `pending-authorization`, `unavailable`,
`rejected-by-policy`, `installed`, or `superseded`. `installed` records the
Control Plane's accepted state for the exact release; it does not mean this
repository installed files or launched a harness. Execution records retain
the exact marketplace plugin references so later policy and audit work can
resolve the same source release.

For security details, see [the security boundary](security.md) and the
[Agent Plugins contract](agent-plugins.md). Control Plane owns policy,
credential authority, and runtime activation. Catalog availability,
compatibility metadata, and a valid plan do not grant execution authority.
