import { it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
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
import { withPortableFixture } from '../test-support/portable-fixture.js'

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
