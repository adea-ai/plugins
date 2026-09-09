# Agent Plugins and Control Plane installation

Canonical portable packages and capability-negotiated installation plans for Adea.

**Status:** Implemented compiler and planning contract; runtime activation belongs to Control Plane.
**Package standard:** Agent Plugins 1.0.0.
**Catalog contract:** Existing v1 envelope with versioned `releaseMetadata.agentPlugins`.
**Installation contract:** `planVersion: 2`.

## Boundaries

Adea installs a plugin once into an approved installation instance. Control Plane makes its
portable components available to the selected harness. Switching harnesses does not require a
separate marketplace product or a different credential store.

The marketplace retrieves immutable source snapshots, validates and normalizes packages, emits
integrity-protected metadata, and produces installation recipes. It does not run plugin code,
install dependencies, invoke lifecycle scripts, start MCP servers, or grant permissions.

Agent Plugins standardizes skills and MCP configuration. It does not make hooks, proprietary
commands, agents, rules, schedules, or user interfaces interchangeable. Neither a recognized
manifest nor a marketplace's name proves runtime compatibility. An installation plan is a
proposal, not an authorization decision.

## Canonical package

```text
plugin.json
mcp.json
skills/
  review/
    SKILL.md
    references/
    scripts/
other package resources...
```

Only root `plugin.json`, root `mcp.json`, and immediate `skills/<name>/SKILL.md` locations have
portable discovery semantics. Supporting files keep their original paths and bytes. A skill's
references and scripts are not flattened, renamed, stripped of extensions, or installed twice.
Copy operations preserve source file modes; generated control files use mode `0644`.

The compiler pins its manifest, server, and frontmatter contracts locally. It does not retrieve
or execute arbitrary schemas from upstream `$schema` URLs. Unknown root schemas fail closed;
there is no fallback that reinterprets a malformed standardized package as a legacy package.
Unknown top-level manifest fields are diagnosed and ignored. Invalid skills and MCP entries
are isolated to those components. A malformed MCP document does not disable valid skills.

Marketplace policy also rejects symlinks, path traversal, file/directory conflicts,
case/Unicode-normalization aliases, Windows-reserved names, and oversized snapshots. These are
marketplace safety restrictions, not a claim that the standard requires all of them.

### Legacy sources

Existing marketplace source adapters and source configurations are retained. The canonical
compiler accepts conventional skill directories, translates explicitly declared legacy HTTP
MCP types to `streamable-http`, and translates known legacy plugin-root placeholders. It does
not infer a remote transport from a URL, guess custom skill locations, or turn arbitrary legacy
credential interpolation into portable environment substitution.

Unsupported declarations receive component diagnostics. Proprietary hooks, commands, agents,
rules and client-extension content remain visible in `nonPortable`; the planner will not
silently activate them. Packages containing these features require explicit acceptance of a
partial installation or a future, tested semantic adapter. Existing v1 adapters remain available
for migration, not as evidence that every proprietary feature is already translated correctly.

Layout validation does not prove that a skill's prose, scripts, dependencies or remote service
behave identically on every harness or operating system. Review skill `compatibility` metadata
and perform runtime acceptance testing for the selected adapter.

## Catalog compatibility and provenance

The six published artifact names, catalog v1 schema, source-qualified plugin IDs, and immutable
source release IDs are unchanged. New metadata is stored in the existing extensible field:

```text
plugin.availableReleases[n].releaseMetadata.agentPlugins
```

The descriptor contains `contractVersion`, `normalizerVersion`, `originFormat`, `specVersion`,
`sourceDigest`, `packageDigest`, component inventories, requirements, diagnostics, nonportable
features, and a deterministic `copy`/`write` recipe. Status is `portable`, `partial`, or
`unavailable`. An unavailable descriptor has no activatable files or components.

The published JSON Schemas are structural serialization contracts, not a substitute for the
runtime safety checks. Consumers must call `verifyAgentPackage` and `validateServer`, verify
catalog/source provenance, and perform realpath containment checks immediately before activation.
The schemas intentionally do not encode every filesystem, URL, header, or race-safety rule.
The compiler's snapshot and in-memory materialization APIs carry bytes and recipes, not file
modes; `preserveMode: true` is an installer requirement. Control Plane must obtain modes from
the immutable source store and pass them to its protected installer, rather than assuming a
byte-only materialization preserves executability.

`canonicalContentDigest` still identifies upstream source bytes. `packageDigest` identifies the
derived canonical file recipe; the two must not be substituted for each other. Installers must
verify exact source provenance and byte digests before applying the recipe. Source commit
identity also binds Git executable modes; the v1 byte-only digest alone does not.

The old per-brand `harnessCompatibility` field remains present for v1 readers, but the canonical
path no longer infers native support from a source dialect. It reports that runtime negotiation
is required, or flags partial/unavailable packages. The definitive decision is a v2 plan for a
specific harness/runtime/adapter profile.

A valid hash is not proof of a trusted publisher. Authenticate the catalog's distribution and
provenance separately, then verify its artifacts. Do not execute a caller-supplied recipe merely
because it contains matching checksums.

## Harness profile and strategy

Control Plane supplies a profile for the actual runtime and adapter version:

```ts
import type { HarnessProfile } from '@adea-ai/catalog-schema/agent-plugins'

// Obtain this from the selected, tested adapter. Do not infer it from a brand name.
const profile: HarnessProfile = adapter.capabilities()
```

Its required fields are `profileVersion: 1`, `harness`, `runtimeVersion`, `adapterVersion`,
`agentPlugins: { versions, skills, mcpTransports }`, and
`components: { skillDirectories, mcpTransports }`. Supported transports are `stdio`,
`streamable-http`, and `sse`. The schema supports future harness names without catalog changes.

The planner selects native Agent Plugins loading when the adapter supports the package version
and has at least as much component coverage as its fallback. Otherwise it selects a component
adapter. Component mode exposes complete skill directories and selected MCP configurations,
not guessed `.claude`, `.cursor`, or other file layouts. The actual adapter remains responsible
for binding those components to its harness.

A native loader is not used when it could implicitly activate preserved proprietary extras.
Without `allowPartial: true`, missing capabilities or nonportable features produce an
`unavailable` strategy and an empty selection. Partial support is always reported. No strategy
sets `allowedToActivate` to true; every plan requires a separate approval.

## Control Plane API

```ts
import { createCatalogInstallationPlan } from '@adea-ai/harness-adapters/agent-plugins'
import { materializeAgentPackage } from '@adea-ai/catalog-core/agent-plugins'
import { resolveMcpBinding, verifyBindingPaths } from '@adea-ai/harness-adapters/agent-plugins'

const plan = createCatalogInstallationPlan({
  catalog: verifiedCatalog,
  pluginId: selectedPluginId,
  releaseId: selectedReleaseId,
  instanceId: installationInstanceId,
  profile: adapter.capabilities(),
  allowPartial: false,
})

// Application-owned authorization is mandatory; these names illustrate integration points.
await policy.authorizeInstallation(plan)
if (plan.strategy === 'unavailable') throw new Error('Plugin cannot satisfy this selection')

// Fetch the exact source commit/subdirectory, rejecting symlinks and preserving Git modes.
const source = await verifiedSourceStore.read(plan.source)
const bytes = materializeAgentPackage(plan.package, source.files)
// Materialization above is pure/in-memory and rechecks deterministic normalization.
// Use a protected, atomic filesystem installer, not unchecked writes into a user workspace.
const roots = await approvedInstaller.install(plan, bytes, source.modes)

if (plan.strategy === 'native-agent-plugin') {
  // Exactly one package registration: do not also add its tools or skills separately.
  await adapter.registerAgentPlugin(roots)
} else {
  await adapter.registerSkillDirectories(roots.pluginRoot, plan.selection.skillDirectories)
  for (const [name, server] of Object.entries(plan.selection.mcpServers)) {
    await verifyBindingPaths(server, roots)
    const binding = resolveMcpBinding(server, roots, approvedEnvironment)
    await adapter.registerMcpServer(plan.instanceId, name, binding)
  }
}
```

Only the imported functions are implemented by this repository. `adapter`, `policy`, source
retrieval, protected filesystem installation, and activation APIs are Control Plane-owned
integration points shown as pseudocode, not additional implementations included here.
The concrete activation must recheck policy and capabilities and prevent filesystem mutation
between preflight and launch. A separate realpath check alone does not eliminate TOCTOU races.

For non-catalog integrations, `createInstallationPlan` accepts an already verified package and
immutable source identity directly. `compileAgentPackage`, `verifyAgentPackage` and
`materializeAgentPackage` are exported from `@adea-ai/catalog-core/agent-plugins`.
`synchronizePortable` and `verifyPortableCatalog` are exported from
`@adea-ai/catalog-core/portable-catalog`. Original root APIs remain available.

## Persistent data and MCP execution descriptors

The plan's `packageKey` binds source repository, commit, subdirectory, and derived digest.
Its `dataKey` binds source-qualified plugin identity and an installation `instanceId`, not the
release or harness. Control Plane should make `instanceId` a stable opaque identifier for the
approved user/workspace scope; different scopes must not share it accidentally. Upgrades and
harness switches retain the same data. This does not automatically authorize cross-scope sharing.

`PLUGIN_ROOT` is the immutable installed package root. `PLUGIN_DATA` is the writable persistent
instance directory. `resolveMcpBinding` applies the standard's single-pass substitutions to
local args, env values, and cwd only. Commands remain a bare executable or a contained
`./package-relative` path, never a shell command string. Unknown placeholders stay literal;
there is no recursive expansion. Reserved root/data variables are supplied last, including
case-insensitive environment handling on Windows. `shell` is always false.

A concrete stdio descriptor does not install Node, Python, dependencies, or the executable it
names. Control Plane must verify prerequisites and authorize execution. Dependency resolution
and lifecycle scripts are not implicitly enabled by package installation.

Remote URL/header values are not interpolated. HTTP is restricted to loopback; other endpoints
require HTTPS without URL credentials or fragments. Authorization remains client-managed,
configured headers must not override protocol/auth-owned headers, and credentials must not be
forwarded across origins without explicit approval. The returned descriptor specifies
`redirectPolicy: 'same-origin'`; the consuming transport must enforce it. No network client is
started by the planner.

## CLI and migration

Repository runtime requirements remain Bun 1.4.0 and Node 24. Install from the existing lockfile:

```sh
bun install --frozen-lockfile
bun run schema:plugins
bun run format:check
bun run lint
bun run type-check
bun test --timeout 30000
bun run build
```

The default `sync` and `build-catalog` now emit canonical package metadata. Neither `--dry-run`
nor `--metadata-only` writes artifacts, even when `--write` is supplied. `--output DIR` provides
an isolated output directory, leaving `generated/` untouched.

For a controlled migration, replay the current immutable source lock into staging:

```sh
bun run catalog sync --from-lock generated/sources.lock.json --output /absolute/staging-catalog
bun run catalog validate --output /absolute/staging-catalog --require-portable
bun run catalog verify-integrity --output /absolute/staging-catalog
```

`--require-portable` requires complete source records and a valid canonical descriptor for each
release. It does not mean every package is fully functional: inspect `status`, `diagnostics`,
`nonPortable`, and the negotiated plan. Invalid components are still reported, never hidden.

Without staging, a normal full sync detects an existing catalog missing the canonical contract
and replays its verified pins once, even if source heads did not change. Subsequent unchanged
runs remain no-ops. The source release IDs stay unchanged, while catalog IDs change to cover
new normalized metadata. Existing snapshots are not rewritten by applying this source patch;
the chosen sync/publication flow performs regeneration.

A v2 plan requires an actual adapter profile and a stable instance:

```sh
bun run catalog materialize-plan \
  --plugin plugin:openai-official:linear \
  --capabilities /absolute/path/to/control-plane-harness-profile.json \
  --instance user-workspace-installation-id \
  --output /absolute/staging-catalog \
  --json
```

Use `--version RELEASE_ID` to select an exact release and `--allow-partial` only after explicitly
accepting disabled components. `--harness` is optional and, when provided, must match the profile.
The legacy CLI routes are opt-in:

```sh
bun run catalog sync --offline --legacy-catalog
bun run catalog materialize-plan --legacy-plan --plugin PLUGIN_ID --harness HARNESS
```

Old consumers may continue parsing the v1 catalog envelope, but adopting package installation
requires consuming v2 plans and the new package descriptor. Do not deploy the new CLI default
under a caller that still assumes `planVersion: 1`. Coordinate that consumer change explicitly.

## Tests, schemas and publication

The new test suites cover normalization, resource preservation, invalid component isolation,
source/recipe tampering, duplicate keys, unsafe paths, legacy translations, capability
negotiation, persistent instance identity, path expansion, realpath containment, unchanged-lock
migration, bounded snapshot loading, CLI behavior, and deterministic artifacts. JSON Schema
artifacts are checked against their Zod runtime definitions.

```sh
bun run scripts/agent-plugin-schemas.ts        # regenerate schemas after contract changes
bun run format
bun run schema:plugins
```

Versioned schemas live under `schemas/` and are included in the schema package's existing
publication staging flow. Their `$id` values identify schemas; they do not require network
retrieval. Package build order is schema, source adapters, catalog core, then harness adapters.
The existing v1 golden fixtures remain tested via `--legacy-catalog`; a separate CI step checks
canonical fixture determinism and contract validation without replacing the live snapshot.

No third-party harness installation, authenticated MCP call, lifecycle execution, or consumer
rollout is implied by these compiler tests. Test those in Control Plane before advertising a
specific runtime/adapter combination as supported.
