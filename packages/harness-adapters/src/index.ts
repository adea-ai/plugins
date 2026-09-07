import {
  HarnessSchema,
  MaterializationPlanSchema,
  type Catalog,
  type Harness,
  type MaterializationPlan,
  type Plugin,
  type PluginRelease,
} from '@adea-ai/catalog-schema'

export class MaterializationError extends Error {
  constructor(
    readonly code: string,
    readonly details: readonly string[] = []
  ) {
    super(`${code}${details.length ? `: ${details.join(', ')}` : ''}`)
    this.name = 'MaterializationError'
  }
}

export function createMaterializationPlan(input: {
  readonly catalog: Catalog
  readonly pluginId: string
  readonly harness: Harness
  readonly releaseId?: string
}): MaterializationPlan {
  const plugin = input.catalog.plugins.find((candidate) => candidate.pluginId === input.pluginId)
  if (!plugin) throw new MaterializationError('PLUGIN_NOT_FOUND', [input.pluginId])
  const release = plugin.availableReleases.find(
    (candidate) => candidate.releaseId === (input.releaseId ?? plugin.currentReleaseId)
  )
  if (!release)
    throw new MaterializationError('RELEASE_NOT_FOUND', [
      input.releaseId ?? plugin.currentReleaseId,
    ])
  const compatibility = plugin.harnessCompatibility[input.harness]
  if (!compatibility) throw new MaterializationError('HARNESS_UNSUPPORTED', [input.harness])
  return MaterializationPlanSchema.parse({
    planVersion: 1,
    pluginId: plugin.pluginId,
    releaseId: release.releaseId,
    harness: input.harness,
    source: {
      repositoryUrl: release.resolvedRepositoryUrl,
      commitSha: release.resolvedCommitSha,
      pluginSubdirectory: release.pluginSubdirectory,
      contentDigest: release.canonicalContentDigest,
    },
    targetLayout: targetLayout(input.harness),
    files: release.fileIndex
      .map((sourcePath) => filePlan(release, sourcePath, input.harness, compatibility.status))
      .sort(
        (left, right) =>
          left.targetPath.localeCompare(right.targetPath) ||
          left.sourcePath.localeCompare(right.sourcePath)
      ),
    configuration: {
      compatibilityStatus: compatibility.status,
      sourceDialect: release.releaseMetadata.sourceDialect ?? 'unknown',
      executeInstallation: false,
    },
    requiredConnectors: release.requiredConnectors,
    requiredCredentials: release.requiredCredentials,
    policyConstraints: [
      'This plan describes files and translation only; it does not install or execute upstream code.',
      ...release.permissionSensitiveChanges.map(
        (type) => `Control Plane must authorize ${type} capability explicitly.`
      ),
    ],
  })
}

function targetLayout(harness: Harness): { root: string; notes: string[] } {
  switch (harness) {
    case 'codex':
      return {
        root: '.agents',
        notes: [
          'Skills and instructions map to the Codex .agents layout.',
          'MCP and executable capabilities require Control Plane policy.',
        ],
      }
    case 'claude-code':
      return {
        root: '.claude',
        notes: [
          'Claude Code-native files can be copied when the source dialect is Claude.',
          'Hooks and MCP configuration still require explicit runtime authorization.',
        ],
      }
    case 'cursor':
      return {
        root: '.cursor',
        notes: [
          'Cursor rules and skills map to the .cursor layout.',
          'MCP configuration is declarative and is not executed by this plan.',
        ],
      }
    case 'pi':
      return {
        root: '.pi',
        notes: [
          'Pi receives portable SKILL.md and MCP metadata only.',
          'No Pi process or package lifecycle is invoked.',
        ],
      }
    case 'hermes':
      return {
        root: '.hermes',
        notes: [
          'Hermes receives portable skill and MCP metadata only.',
          'Harness-specific translation remains explicit in each file action.',
        ],
      }
    case 'opencode':
      return {
        root: '.opencode',
        notes: [
          'OpenCode receives portable instruction and MCP metadata only.',
          'Executable capabilities are excluded.',
        ],
      }
    case 'generic-skill-mcp':
      return {
        root: '.agent',
        notes: ['Generic SKILL.md and MCP-compatible files are copied when recognized.'],
      }
  }
}

function filePlan(
  release: PluginRelease,
  sourcePath: string,
  harness: Harness,
  status: Plugin['harnessCompatibility'][Harness]['status']
) {
  const type = capabilityTypeForPath(release, sourcePath)
  const directory = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : ''
  if (status === 'unsupported' || type === 'executable' || type === 'unknown') {
    return {
      sourcePath,
      targetPath: sourcePath,
      action: 'unsupported' as const,
      reason: `${type} capability is not executable through a materialization plan.`,
    }
  }
  if (
    type === 'hook' ||
    type === 'browser' ||
    type === 'scheduled-task' ||
    type === 'ui-component'
  ) {
    return {
      sourcePath,
      targetPath: sourcePath,
      action: 'ignore' as const,
      reason: `${type} is cataloged but has no portable target layout for ${harness}.`,
    }
  }
  const targetPath = targetForType(type, sourcePath, directory, harness)
  const action =
    type === 'skill' || type === 'rule' || (type === 'mcp-server' && status === 'native')
      ? 'copy'
      : 'translate'
  return {
    sourcePath,
    targetPath,
    action: action as 'copy' | 'translate',
    reason:
      action === 'copy'
        ? `Copy recognized ${type} content.`
        : `Translate ${type} metadata into the ${harness} layout.`,
  }
}

function capabilityTypeForPath(release: PluginRelease, path: string): string {
  const match = release.capabilities.find((capability) => capability.paths.includes(path))
  return match?.type ?? 'unknown'
}

function targetForType(type: string, path: string, directory: string, harness: Harness): string {
  if (type === 'skill')
    return `${targetLayout(harness).root}/skills/${directory || basenameWithoutExtension(path)}/${path.endsWith('SKILL.md') ? 'SKILL.md' : basenameWithoutExtension(path)}`
  if (type === 'rule')
    return `${targetLayout(harness).root}/rules/${basenameWithoutExtension(path)}.md`
  if (type === 'command')
    return `${targetLayout(harness).root}/commands/${basenameWithoutExtension(path)}.md`
  if (type === 'agent')
    return `${targetLayout(harness).root}/agents/${basenameWithoutExtension(path)}.md`
  if (type === 'mcp-server')
    return `${targetLayout(harness).root}/mcp/${basenameWithoutExtension(path)}.json`
  return `${targetLayout(harness).root}/${path}`
}

function basenameWithoutExtension(path: string): string {
  const basename = path.split('/').at(-1) ?? path
  return basename.replace(/\.[^.]+$/, '')
}

export function supportedHarnesses(): readonly Harness[] {
  return HarnessSchema.options
}
