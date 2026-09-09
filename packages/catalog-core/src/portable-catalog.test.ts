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
import { verifyAgentPackage, materializeAgentPackage } from './agent-plugins.js'
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
