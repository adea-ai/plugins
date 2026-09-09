import { it } from 'node:test'
import assert from 'node:assert/strict'
import { synchronizePortable } from '@adea-ai/catalog-core/portable-catalog'
import { withPortableFixture } from '../../catalog-core/test-support/portable-fixture.js'
import { createCatalogInstallationPlan } from './agent-plugins.js'

it('selects exact immutable catalog releases and requires canonical metadata', () =>
  withPortableFixture(async (input) => {
    const result = await synchronizePortable(input)
    const args = {
      catalog: result.catalog!,
      pluginId: 'plugin:test-source:review-kit',
      instanceId: 'user-a/workspace-a',
      profile: {
        profileVersion: 1 as const,
        harness: 'test-harness',
        runtimeVersion: 'test-1',
        adapterVersion: 'test-1',
        agentPlugins: { versions: [], skills: false, mcpTransports: [] },
        components: { skillDirectories: true, mcpTransports: ['stdio' as const] },
      },
    }
    const plan = createCatalogInstallationPlan(args)
    assert.equal(plan.releaseId, result.catalog?.plugins[0]?.currentReleaseId)
    assert.equal(plan.strategy, 'component-adapter')
    assert.equal(plan.compatibility, 'full')
    assert.equal(plan.allowedToActivate, false)
    assert.throws(
      () => createCatalogInstallationPlan({ ...args, releaseId: 'missing' }),
      /RELEASE_NOT_FOUND/
    )
    assert.throws(
      () => createCatalogInstallationPlan({ ...args, pluginId: 'missing' }),
      /PLUGIN_NOT_FOUND/
    )
    const tampered = structuredClone(args.catalog)
    tampered.plugins[0]!.description = 'Modified without rehashing'
    assert.throws(
      () => createCatalogInstallationPlan({ ...args, catalog: tampered }),
      /CATALOG_ID_MISMATCH/
    )
  }))
