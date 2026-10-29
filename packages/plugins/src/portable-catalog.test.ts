import { it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { writeFile, mkdir, readFile, readdir, mkdtemp, symlink, rm, chmod } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { synchronize, verifyArtifacts, digest } from './index.js'
import {
  synchronizePortable,
  verifyPortableCatalog,
  PACKAGE_METADATA_KEY,
} from './portable-catalog.js'
import { verifyAgentPackage, materializeAgentPackage } from './agent-plugins-catalog.js'
import { createCatalogInstallationPlan, createInstallationPlan } from './agent-plugins-harness.js'
import type { HarnessProfile } from './agent-plugins-schema.js'
import { snapshotFromDirectory } from './index.js'
import {
  copyDependency,
  nodeCandidates,
  packageLifecycleScripts,
  selectPinnedNode,
  withPackedConsumerFixture,
  withPortableFixture,
} from '../test-support/portable-fixture.js'

it('normalizes a real offline catalog and preserves source/release identity', () =>
  withPortableFixture(async (input, root) => {
    const legacy = await synchronize(input)
    const portable = await synchronizePortable(input)
    assert.ok(portable.catalog && portable.artifacts && legacy.catalog)
    verifyArtifacts(portable.artifacts)
    verifyPortableCatalog(portable.catalog, true)
    assert.equal(portable.catalog.schemaVersion, 1)
    const plugin = portable.catalog.plugins[0]!
    const release = plugin.availableReleases[0]!
    assert.equal(release.releaseId, legacy.catalog.plugins[0]?.currentReleaseId)
    assert.equal(
      release.canonicalContentDigest,
      legacy.catalog.plugins[0]?.availableReleases[0]?.canonicalContentDigest
    )
    assert.equal(plugin.harnessCompatibility['claude-code'].status, 'unknown')
    const pkg = verifyAgentPackage(release.releaseMetadata[PACKAGE_METADATA_KEY])
    const snapshot = await snapshotFromDirectory(
      join(root, 'fixtures/source'),
      'plugins/review-kit'
    )
    assert.ok(
      materializeAgentPackage(pkg, snapshot.files).has('skills/review/references/checklist.md')
    )
  }))
it('produces deterministic catalog and integrity artifacts', () =>
  withPortableFixture(async (input) => {
    assert.deepEqual(
      (await synchronizePortable(input)).artifacts,
      (await synchronizePortable(input)).artifacts
    )
  }))
it('migrates unchanged v1 pins once, then returns unchanged for the canonical contract', () =>
  withPortableFixture(async (input) => {
    const legacy = await synchronize(input)
    const migrated = await synchronizePortable({
      ...input,
      existingLock: legacy.lock!,
      existingCatalog: legacy.catalog!,
    })
    assert.equal(migrated.changed, true)
    assert.deepEqual(migrated.lock, legacy.lock)
    assert.deepEqual(migrated.changeReport.changedSources, [])
    assert.deepEqual(migrated.changeReport.changedPlugins, ['plugin:test-source:review-kit'])
    const unchanged = await synchronizePortable({
      ...input,
      existingLock: migrated.lock!,
      existingCatalog: migrated.catalog!,
    })
    assert.equal(unchanged.changed, false)
  }))
it('never loads plugin content for metadata-only or dry-run', () =>
  withPortableFixture(async (input) => {
    for (const flags of [{ metadataOnly: true }, { dryRun: true }]) {
      const result = await synchronizePortable({
        ...input,
        ...flags,
        snapshotLoader: {
          async load() {
            throw new Error('Must not retrieve content')
          },
        },
      })
      assert.ok(result.catalog)
      assert.equal(
        result.catalog.plugins[0]?.availableReleases[0]?.contentResolution,
        'metadata-only'
      )
      assert.equal(
        result.catalog.plugins[0]?.availableReleases[0]?.releaseMetadata[PACKAGE_METADATA_KEY],
        undefined
      )
      assert.throws(() => verifyPortableCatalog(result.catalog!, true), /COMPLETE_SOURCE_REQUIRED/)
    }
  }))
it('reports nonportable extras while keeping valid skills available', () =>
  withPortableFixture(async (input, root) => {
    await mkdir(join(root, 'fixtures/source/plugins/review-kit/hooks'))
    await writeFile(join(root, 'fixtures/source/plugins/review-kit/hooks/hooks.json'), '{}')
    const result = await synchronizePortable(input)
    const pkg = verifyAgentPackage(
      result.catalog!.plugins[0]!.availableReleases[0]!.releaseMetadata[PACKAGE_METADATA_KEY]
    )
    assert.equal(pkg.status, 'partial')
    assert.equal(pkg.skills.length, 1)
    assert.ok(pkg.nonPortable.some((item) => item.kind === 'hooks'))
  }))
it('rejects metadata tampering before taking the unchanged-source fast path', () =>
  withPortableFixture(async (input) => {
    const first = await synchronizePortable(input)
    const catalog = structuredClone(first.catalog!)
    catalog.plugins[0]!.description = 'tampered'
    await assert.rejects(
      synchronizePortable({ ...input, existingLock: first.lock!, existingCatalog: catalog }),
      /CATALOG_ID_MISMATCH/
    )
  }))
it('rejects canonical recipes attached to another source digest', () =>
  withPortableFixture(async (input) => {
    const result = await synchronizePortable(input)
    const catalog = structuredClone(result.catalog!)
    const release = catalog.plugins[0]!.availableReleases[0]!
    release.canonicalContentDigest = `sha256:${'f'.repeat(64)}`
    const { catalogId: _oldId, ...body } = catalog
    catalog.catalogId = `catalog:${digest(body).slice(7)}`
    assert.throws(() => verifyPortableCatalog(catalog), /PACKAGE_PROVENANCE_MISMATCH/)
  }))

it('normalizes each fetched snapshot once without a second pass over source bytes', () =>
  withPortableFixture(async (input, root) => {
    let reads = 0
    let transforms = 0
    const result = await synchronizePortable({
      ...input,
      snapshotLoader: {
        async load(_repository, _commit, subdirectory) {
          reads += 1
          return snapshotFromDirectory(join(root, 'fixtures/source'), subdirectory)
        },
      },
      transformRelease(release) {
        transforms += 1
        return release
      },
    })
    assert.equal(reads, 1)
    assert.equal(transforms, 1)
    assert.ok(result.catalog)
    verifyPortableCatalog(result.catalog, true)
  }))

it('does not allow a composed release transform to rewrite immutable source identity', () =>
  withPortableFixture(async (input) => {
    await assert.rejects(
      synchronizePortable({
        ...input,
        transformRelease(release) {
          return { ...release, resolvedCommitSha: 'b'.repeat(40) }
        },
      }),
      /SOURCE_IDENTITY_CHANGED_BY_TRANSFORM/
    )
  }))

it('makes the root manifest authoritative even when nested legacy manifests are malformed', () =>
  withPortableFixture(async (input, root) => {
    const directory = join(root, 'fixtures/source/plugins/review-kit/examples/.claude-plugin')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'plugin.json'), '{not-a-manifest')
    const result = await synchronizePortable(input)
    assert.equal(result.catalog?.plugins.length, 1)
    assert.equal(result.changeReport.skippedPlugins.length, 0)
    verifyPortableCatalog(result.catalog!, true)
  }))

it('advertises where it is published once the publication is known', () =>
  withPortableFixture(async (input) => {
    // The default compiler replaces the artifacts the legacy pass produced, so it
    // must repeat every option it needs: dropping this one silently strips the
    // brand-mark and browsing-index URLs from a published catalog.
    const result = await synchronizePortable({
      ...input,
      publicationRepositoryUrl: 'https://github.com/adea-ai/plugins',
    })
    const navigation = JSON.parse(result.artifacts!['categories.v1.json']) as {
      catalogIndexUrl?: string
      brandMarks?: Record<string, string>
    }
    assert.match(navigation.catalogIndexUrl ?? '', /\/catalog-assets\/catalogs\/[a-f0-9]{64}\//)
    // The fixture plugin ships no mark, so the map is present and empty.
    assert.deepEqual(navigation.brandMarks, {})
  }))

it('preserves the configured snapshot URL when rebuilding portable artifacts', () =>
  withPortableFixture(async (input) => {
    const base = 'https://example.com/snapshots'
    const result = await synchronizePortable({
      ...input,
      publicationAssetsBaseUrl: 'https://example.com/assets',
      publicationCatalogsBaseUrl: base,
    })
    const navigation = JSON.parse(result.artifacts!['categories.v1.json']) as {
      catalogIndexUrl?: string
    }
    assert.equal(
      navigation.catalogIndexUrl,
      `${base}/${result.catalog!.catalogId.slice('catalog:'.length)}/catalog-index.v1.json`
    )
    verifyArtifacts(result.artifacts!)
  }))

/** The capability profile a packed consumer presents to the planner. */
function harnessProfile(overrides: Partial<HarnessProfile> = {}): HarnessProfile {
  return {
    profileVersion: 1,
    harness: 'example-harness',
    runtimeVersion: 'fixture-1',
    adapterVersion: 'fixture-1',
    agentPlugins: {
      versions: ['1.0.0'],
      skills: true,
      mcpTransports: ['stdio'],
    },
    components: { skillDirectories: true, mcpTransports: ['stdio'] },
    ...overrides,
  }
}

it('gives a packed consumer the same installation plan as the direct package path', () =>
  withPortableFixture(async (input) => {
    const result = await synchronizePortable(input)
    const catalog = result.catalog!
    const plugin = catalog.plugins[0]!
    const release = plugin.availableReleases[0]!
    const fromCatalog = createCatalogInstallationPlan({
      catalog,
      pluginId: plugin.pluginId,
      instanceId: 'workspace-a/user-a',
      profile: harnessProfile(),
    })
    const direct = createInstallationPlan({
      pluginId: plugin.pluginId,
      releaseId: release.releaseId,
      instanceId: 'workspace-a/user-a',
      profile: harnessProfile(),
      package: release.releaseMetadata[PACKAGE_METADATA_KEY],
      source: {
        repositoryUrl: release.resolvedRepositoryUrl,
        commitSha: release.resolvedCommitSha,
        pluginSubdirectory: release.pluginSubdirectory,
        contentDigest: release.canonicalContentDigest,
      },
      requiredCredentials: release.requiredCredentials,
      requiredConnectors: release.requiredConnectors,
    })
    // The import path and the direct path must plan the SAME installation.
    assert.deepEqual(fromCatalog, direct)
    // The plan is deterministic: the same catalog and profile serialize the
    // same bytes, every time.
    const again = createCatalogInstallationPlan({
      catalog,
      pluginId: plugin.pluginId,
      instanceId: 'workspace-a/user-a',
      profile: harnessProfile(),
    })
    assert.equal(JSON.stringify(again), JSON.stringify(fromCatalog))
    // The upgrade identity: the instance data key is stable and the package
    // key is pinned to the exact source and package bytes.
    assert.equal(fromCatalog.dataKey, direct.dataKey)
    assert.ok(fromCatalog.packageKey.startsWith('packages/'))
  }))

it('selects the component adapter when the profile does not support the package version', () =>
  withPortableFixture(async (input) => {
    const result = await synchronizePortable(input)
    const catalog = result.catalog!
    const plugin = catalog.plugins[0]!
    const release = plugin.availableReleases[0]!
    const plan = createInstallationPlan({
      pluginId: plugin.pluginId,
      releaseId: release.releaseId,
      instanceId: 'workspace-a/user-a',
      profile: harnessProfile({
        agentPlugins: { versions: ['9.9.9'], skills: true, mcpTransports: ['stdio'] },
      }),
      package: release.releaseMetadata[PACKAGE_METADATA_KEY],
      source: {
        repositoryUrl: release.resolvedRepositoryUrl,
        commitSha: release.resolvedCommitSha,
        pluginSubdirectory: release.pluginSubdirectory,
        contentDigest: release.canonicalContentDigest,
      },
    })
    // The package version is not supported natively, so the adapter plans it.
    assert.equal(plan.strategy, 'component-adapter')
    assert.equal(plan.compatibility, 'full')
    // The same package on a profile that supports its version goes native.
    const native = createInstallationPlan({
      pluginId: plugin.pluginId,
      releaseId: release.releaseId,
      instanceId: 'workspace-a/user-a',
      profile: harnessProfile(),
      package: release.releaseMetadata[PACKAGE_METADATA_KEY],
      source: {
        repositoryUrl: release.resolvedRepositoryUrl,
        commitSha: release.resolvedCommitSha,
        pluginSubdirectory: release.pluginSubdirectory,
        contentDigest: release.canonicalContentDigest,
      },
    })
    assert.equal(native.strategy, 'native-agent-plugin')
  }))

it('refuses a malformed provenance descriptor with one typed line naming the plugin', () =>
  withPortableFixture(async (input) => {
    const result = await synchronizePortable(input)
    const catalog = structuredClone(result.catalog!)
    const release = catalog.plugins[0]!.availableReleases[0]!
    release.releaseMetadata[PACKAGE_METADATA_KEY] = { normalizerVersion: 1, files: 'not-an-array' }
    const { catalogId: _oldId, ...body } = catalog
    catalog.catalogId = `catalog:${digest(body).slice(7)}`
    assert.throws(
      () => verifyPortableCatalog(catalog),
      (error: Error) => {
        // One typed line, naming the plugin — the catalog's refusal contract.
        assert.match(
          error.message,
          /^PACKAGE_PROVENANCE_INVALID: plugin:test-source:review-kit \(.+\)$/
        )
        assert.equal(error.message.includes('\n'), false)
        return true
      }
    )
    // The packed consumer's import path refuses it the same way.
    assert.throws(
      () =>
        createCatalogInstallationPlan({
          catalog,
          pluginId: catalog.plugins[0]!.pluginId,
          instanceId: 'workspace-a/user-a',
          profile: harnessProfile(),
        }),
      /PACKAGE_PROVENANCE_INVALID: plugin:test-source:review-kit/
    )
  }))

const CONSUMER_SCRIPT = `import { readFileSync } from 'node:fs'
import { createCatalogInstallationPlan } from '@adea-ai/plugins/agent-plugins/harness'
import { synchronizePortable } from '@adea-ai/plugins/portable-catalog'
import { digest } from '@adea-ai/plugins'
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const result = await synchronizePortable(request.input)
let catalog = result.catalog
if (request.mode === 'malformed') {
  const copy = structuredClone(catalog)
  const release = copy.plugins[0].availableReleases[0]
  release.releaseMetadata.agentPlugins = { normalizerVersion: 1, files: 'not-an-array' }
  const { catalogId: _oldId, ...body } = copy
  copy.catalogId = 'catalog:' + digest(body).slice(7)
  catalog = copy
}
try {
  const plan = createCatalogInstallationPlan({
    catalog,
    pluginId: catalog.plugins[0].pluginId,
    instanceId: request.instanceId,
    profile: request.profile,
  })
  process.stdout.write(
    JSON.stringify({
      ok: true,
      plan,
      catalogId: result.catalog.catalogId,
      resolvedHarness: import.meta.resolve('@adea-ai/plugins/agent-plugins/harness'),
      resolvedCatalog: import.meta.resolve('@adea-ai/plugins/portable-catalog'),
    })
  )
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) })
  )
}
`

it('gives a PACKED consumer the same installation plan as the workspace path', () =>
  withPackedConsumerFixture(async (consumer) => {
    const source = await synchronizePortable(consumer.input)
    assert.ok(source.catalog)
    const sourcePlan = createCatalogInstallationPlan({
      catalog: source.catalog,
      pluginId: source.catalog.plugins[0]!.pluginId,
      instanceId: 'workspace-a/user-a',
      profile: harnessProfile(),
    })

    // The consumer imports the package by its PUBLIC specifiers, from its own
    // directory, and compiles and plans from the packed artifact alone.
    await writeFile(join(consumer.consumerRoot, 'consume.mjs'), CONSUMER_SCRIPT)
    const requestPath = join(consumer.consumerRoot, 'request.json')
    await writeFile(
      requestPath,
      JSON.stringify({
        input: consumer.input,
        profile: harnessProfile(),
        instanceId: 'workspace-a/user-a',
      })
    )
    const underNode = consumer.runUnderNode(join(consumer.consumerRoot, 'consume.mjs'), requestPath)
    assert.equal(underNode.status, 0, underNode.stderr)
    const nodeResult = JSON.parse(underNode.stdout) as {
      ok: boolean
      plan: typeof sourcePlan
      catalogId: string
      resolvedHarness: string
      resolvedCatalog: string
    }
    assert.equal(nodeResult.ok, true)
    // The compiler output is identical across the packaging boundary.
    assert.equal(nodeResult.catalogId, source.catalog.catalogId)
    // The import path and the workspace path plan the SAME installation, and
    // the independently constructed plan serializes to the same bytes: the
    // determinism claim is about the artifact and about two independent
    // constructions, not about one in-memory object.
    assert.deepEqual(nodeResult.plan, sourcePlan)
    assert.equal(JSON.stringify(nodeResult.plan), JSON.stringify(sourcePlan))
    // And the plan carries the real content, not an empty one.
    assert.equal(nodeResult.plan.strategy, 'native-agent-plugin')
    assert.equal(nodeResult.plan.compatibility, 'full')
    assert.deepEqual(nodeResult.plan.selection.skillDirectories, ['skills/review'])
    assert.deepEqual(Object.keys(nodeResult.plan.selection.mcpServers), ['local'])
    assert.equal(nodeResult.plan.allowedToActivate, false)
    assert.equal(nodeResult.plan.approvalRequired, true)
    // The compiled artifact was reached through the PUBLIC specifier: the
    // resolved module lives in the packed package's dist, not in the
    // workspace source.
    const physicalConsumerRootUrl = pathToFileURL(
      `${realpathSync(consumer.consumerRoot)}${sep}`
    ).href
    assert.ok(nodeResult.resolvedHarness.startsWith(physicalConsumerRootUrl))
    assert.ok(nodeResult.resolvedHarness.includes('@adea-ai/plugins'))
    assert.ok(nodeResult.resolvedHarness.includes('/dist/'))
    assert.ok(nodeResult.resolvedCatalog.startsWith(physicalConsumerRootUrl))
    assert.ok(nodeResult.resolvedCatalog.includes('@adea-ai/plugins'))
    assert.ok(nodeResult.resolvedCatalog.includes('/dist/'))

    // Bun is qualified separately: the package's bun export condition
    // intentionally selects src/*.ts, so it exercises the source condition and
    // must still reach the same plan.
    const underBun = consumer.runUnderBun(join(consumer.consumerRoot, 'consume.mjs'), requestPath)
    assert.equal(underBun.status, 0, underBun.stderr)
    const bunResult = JSON.parse(underBun.stdout) as {
      ok: boolean
      plan: typeof sourcePlan
      resolvedHarness: string
      resolvedCatalog: string
    }
    assert.equal(bunResult.ok, true)
    assert.deepEqual(bunResult.plan, sourcePlan)
    assert.ok(bunResult.resolvedHarness.startsWith(physicalConsumerRootUrl))
    assert.ok(bunResult.resolvedHarness.includes('@adea-ai/plugins'))
    assert.ok(bunResult.resolvedHarness.includes('/src/'))
    assert.ok(bunResult.resolvedCatalog.startsWith(physicalConsumerRootUrl))
    assert.ok(bunResult.resolvedCatalog.includes('@adea-ai/plugins'))
    assert.ok(bunResult.resolvedCatalog.includes('/src/'))
  }))

it('keeps the packed consumer inside the packed artifact and its own dependencies', () =>
  withPackedConsumerFixture(async (consumer) => {
    // The packed artifact was built from the CURRENT source: a stale build
    // would still carry the sentinel the rebuild removes.
    assert.equal(consumer.builtFromCurrentSource, true)
    assert.equal(existsSync(join(consumer.packedRoot, 'dist', 'agent-plugins-harness.js')), true)
    // Every copied dependency really resolves INSIDE the consumer: the
    // workspace installs them as links into the package manager's store, so
    // a copy that kept the link would resolve outside the consumer.
    const consumerRoot = realpathSync(consumer.consumerRoot)
    for (const real of consumer.dependencyRealpaths)
      assert.ok(real.startsWith(consumerRoot + '/'), `${real} resolves outside the consumer`)
    assert.ok(consumer.packageRealpath.startsWith(consumerRoot + '/'))
    // The consumer's dependency closure is the PACKED manifest's own
    // dependencies, and never the whole workspace.
    const packedManifest = JSON.parse(
      await readFile(join(consumer.packedRoot, 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string> }
    const declared = Object.keys(packedManifest.dependencies ?? {})
    for (const name of declared) assert.ok(consumer.linkedDependencies.includes(name))
    const installed = await readdir(join(consumer.consumerRoot, 'node_modules'))
    for (const name of installed) {
      if (name.startsWith('@')) continue
      assert.ok(
        consumer.linkedDependencies.includes(name),
        `the consumer must not resolve ${name}: it is not a declared dependency`
      )
    }
    // The packing step cannot build: the package declares no lifecycle, and
    // the workspace prepare only wires git hooks.
    const packageManifest = JSON.parse(
      await readFile(join(consumer.packedRoot, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> }
    const lifecycle = packageLifecycleScripts({ package: packageManifest })
    assert.deepEqual(lifecycle, {})

    const requestPath = join(consumer.consumerRoot, 'request.json')
    await writeFile(
      requestPath,
      JSON.stringify({
        input: consumer.input,
        profile: harnessProfile(),
        instanceId: 'workspace-a/user-a',
      })
    )

    // NEGATIVE CONTROL — a broken export. The consumer resolves the packed
    // package's OWN exports, so a specifier the packed manifest does not
    // export must not resolve.
    const brokenExport = join(consumer.consumerRoot, 'broken-export.mjs')
    await writeFile(brokenExport, "import '@adea-ai/plugins/not-an-export-of-this-package'\n")
    const broken = consumer.runUnderNode(brokenExport, requestPath)
    assert.notEqual(broken.status, 0)
    assert.match(
      broken.stderr,
      /ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_MODULE_NOT_FOUND|Cannot find module/
    )

    // NEGATIVE CONTROL — an undeclared package. The consumer's install holds
    // only the packed manifest's declared closure, so a package the workspace
    // happens to have must NOT resolve from the consumer.
    const undeclared = join(consumer.consumerRoot, 'undeclared.mjs')
    await writeFile(undeclared, "import 'oxlint'\n")
    const undeclaredRun = consumer.runUnderNode(undeclared, requestPath)
    assert.notEqual(undeclaredRun.status, 0)
    assert.match(undeclaredRun.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/)
  }))

it('refuses a malformed provenance descriptor for a PACKED consumer too', () =>
  withPackedConsumerFixture(async (consumer) => {
    await writeFile(join(consumer.consumerRoot, 'consume.mjs'), CONSUMER_SCRIPT)
    const requestPath = join(consumer.consumerRoot, 'request.json')
    await writeFile(
      requestPath,
      JSON.stringify({
        mode: 'malformed',
        input: consumer.input,
        profile: harnessProfile(),
        instanceId: 'workspace-a/user-a',
      })
    )
    const underNode = consumer.runUnderNode(join(consumer.consumerRoot, 'consume.mjs'), requestPath)
    assert.equal(underNode.status, 0, underNode.stderr)
    const result = JSON.parse(underNode.stdout) as { ok: boolean; error?: string }
    assert.equal(result.ok, false)
    // One typed line, naming the plugin — the catalog's refusal contract.
    assert.match(
      result.error ?? '',
      /^PACKAGE_PROVENANCE_INVALID: plugin:test-source:review-kit \(.+\)$/
    )
    assert.equal((result.error ?? '').includes('\n'), false)
  }))

it('copies a symlinked dependency as self-contained content', async () => {
  // The workspace installs the package's dependencies as SYMLINKS into the
  // package manager's store, and a recursive copy keeps a link as a link.
  // The consumer must receive the CONTENT, and the copy must resolve inside
  // the consumer.
  const workspace = await mkdtemp(join(tmpdir(), 'adea-symlink-dependency-'))
  try {
    const real = join(workspace, 'real-pkg')
    await mkdir(real)
    await writeFile(
      join(real, 'package.json'),
      JSON.stringify({ name: 'real-pkg', version: '1.0.0' })
    )
    const link = join(workspace, 'linked-pkg')
    await symlink(real, link)
    const consumer = join(workspace, 'consumer')
    await mkdir(consumer, { recursive: true })

    const copied = await copyDependency(link, 'linked-pkg', consumer)
    // The copy is a real directory, not a link.
    assert.equal(lstatSync(copied.path).isSymbolicLink(), false)
    // And it resolves inside the consumer, not at the workspace's target.
    assert.ok(copied.realpath.startsWith(realpathSync(consumer) + '/'))
    assert.notEqual(copied.realpath, realpathSync(real))
    // The workspace's own link is untouched.
    assert.equal(lstatSync(link).isSymbolicLink(), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

it('qualifies the compiled artifact only on Node 24', async () => {
  // The qualification exists because the package's `bun` export condition
  // selects src/*.ts: a Node that is not 24 would change WHICH artifact is
  // under test, so it is not a candidate.
  const directory = await mkdtemp(join(tmpdir(), 'adea-node-candidate-'))
  try {
    const node24 = join(directory, 'node24')
    const node20 = join(directory, 'node20')
    await writeFile(node24, '#!/bin/sh\necho v24.21.0\n')
    await writeFile(node20, '#!/bin/sh\necho v20.11.0\n')
    await chmod(node24, 0o755)
    await chmod(node20, 0o755)
    assert.equal(selectPinnedNode([node20, node24]), node24)
    assert.throws(() => selectPinnedNode([node20]), /needs Node 24/)
    assert.throws(() => selectPinnedNode([]), /needs Node 24/)
    // The discovery ends with the `node` on PATH, which is where a CI
    // runner's pinned setup action puts Node 24.
    const candidates = nodeCandidates()
    assert.ok(candidates.includes('node'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
