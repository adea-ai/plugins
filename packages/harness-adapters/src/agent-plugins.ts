import { isAbsolute, resolve, relative, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  HarnessProfileSchema,
  InstallationPlanSchema,
  type HarnessProfile,
  type McpServer,
  type InstallationPlan,
} from '@adea-ai/catalog-schema/agent-plugins'
import type { Catalog } from '@adea-ai/catalog-schema'
import { verifyPortableCatalog, PACKAGE_METADATA_KEY } from '@adea-ai/catalog-core/portable-catalog'
import { verifyAgentPackage, validateServer } from '@adea-ai/catalog-core/agent-plugins'

export interface InstallationInput {
  readonly pluginId: string
  readonly releaseId: string
  readonly instanceId: string
  readonly source: InstallationPlan['source']
  readonly package: unknown
  readonly profile: HarnessProfile
  readonly requiredCredentials?: readonly string[]
  readonly requiredConnectors?: readonly string[]
  readonly allowPartial?: boolean
}
export interface CatalogInstallationInput {
  readonly catalog: Catalog
  readonly pluginId: string
  readonly releaseId?: string
  readonly instanceId: string
  readonly profile: HarnessProfile
  readonly allowPartial?: boolean
}

/** Resolve the exact catalog release before planning. The caller must also authenticate
 * the catalog publisher and verify its artifact integrity before invoking this API.
 */
export function createCatalogInstallationPlan(input: CatalogInstallationInput): InstallationPlan {
  verifyPortableCatalog(input.catalog)
  const plugin = input.catalog.plugins.find((entry) => entry.pluginId === input.pluginId)
  if (!plugin) throw new Error(`PLUGIN_NOT_FOUND: ${input.pluginId}`)
  const release = plugin.availableReleases.find(
    (entry) => entry.releaseId === (input.releaseId ?? plugin.currentReleaseId)
  )
  if (!release) throw new Error('RELEASE_NOT_FOUND')
  if (release.contentResolution !== 'complete') throw new Error('COMPLETE_SOURCE_REQUIRED')
  const pkg = release.releaseMetadata[PACKAGE_METADATA_KEY]
  if (pkg === undefined)
    throw new Error(
      'PORTABLE_RESYNC_REQUIRED: run a full catalog sync before planning portable installation'
    )
  return createInstallationPlan({
    pluginId: plugin.pluginId,
    releaseId: release.releaseId,
    instanceId: input.instanceId,
    profile: input.profile,
    package: pkg,
    allowPartial: input.allowPartial === true,
    source: {
      repositoryUrl: release.resolvedRepositoryUrl,
      commitSha: release.resolvedCommitSha,
      pluginSubdirectory: release.pluginSubdirectory,
      contentDigest: release.canonicalContentDigest,
    },
    requiredCredentials: release.requiredCredentials,
    requiredConnectors: release.requiredConnectors,
  })
}

function identity(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}
/** A declarative proposal, never an execution grant. No brand-based support assumptions. */
export function createInstallationPlan(input: InstallationInput): InstallationPlan {
  const profile = HarnessProfileSchema.parse(input.profile)
  const pkg = verifyAgentPackage(input.package)
  if (pkg.sourceDigest !== input.source.contentDigest)
    throw new Error('Package recipe does not match the selected immutable release.')
  if (!input.instanceId || input.instanceId.length > 256)
    throw new Error('A stable installation instanceId is required.')
  const disabled: InstallationPlan['disabled'] = []
  for (const item of pkg.nonPortable) disabled.push({ component: item.kind, reason: item.reason })
  for (const item of pkg.diagnostics.filter((entry) => entry.severity === 'error'))
    disabled.push({ component: item.path, reason: item.message })

  const nativeEligible =
    profile.agentPlugins.versions.includes(pkg.specVersion) &&
    pkg.nonPortable.length === 0 &&
    !Object.keys(pkg.manifest?.extensions ?? {}).length
  const nativeCoverage =
    (profile.agentPlugins.skills ? pkg.skills.length : 0) +
    Object.values(pkg.mcpServers).filter((server) =>
      profile.agentPlugins.mcpTransports.includes(server.type)
    ).length
  const adapterCoverage =
    (profile.components.skillDirectories ? pkg.skills.length : 0) +
    Object.values(pkg.mcpServers).filter((server) =>
      profile.components.mcpTransports.includes(server.type)
    ).length
  const native = nativeEligible && nativeCoverage > 0 && nativeCoverage >= adapterCoverage
  const strategy =
    pkg.status === 'unavailable'
      ? 'unavailable'
      : native
        ? 'native-agent-plugin'
        : 'component-adapter'
  let skillDirectories: string[] = []
  const servers = new Map<string, McpServer>()
  if (strategy !== 'unavailable') {
    if (native ? profile.agentPlugins.skills : profile.components.skillDirectories)
      skillDirectories = pkg.skills.map((skill) => skill.path)
    else
      for (const skill of pkg.skills)
        disabled.push({
          component: `skill:${skill.name}`,
          reason: 'The selected adapter cannot expose skill directories.',
        })
    for (const [name, server] of Object.entries(pkg.mcpServers)) {
      if (
        (native ? profile.agentPlugins.mcpTransports : profile.components.mcpTransports).includes(
          server.type
        )
      )
        servers.set(name, server)
      else
        disabled.push({
          component: `mcp:${name}`,
          reason: `No ${server.type} MCP binding on this harness adapter.`,
        })
    }
  }
  const hasContent = skillDirectories.length > 0 || servers.size > 0
  const compatibility = !hasContent ? 'unsupported' : disabled.length > 0 ? 'partial' : 'full'
  const selectedStrategy =
    !hasContent || (compatibility === 'partial' && !input.allowPartial) ? 'unavailable' : strategy
  return InstallationPlanSchema.parse({
    planVersion: 2,
    pluginId: input.pluginId,
    releaseId: input.releaseId,
    instanceId: input.instanceId,
    profile,
    source: input.source,
    package: pkg,
    // Git source identity also pins executable modes, which the v1 byte snapshot omits.
    packageKey: pkg.packageDigest
      ? `packages/${identity(input.source.repositoryUrl, input.source.commitSha, input.source.pluginSubdirectory, pkg.packageDigest)}`
      : '',
    // Deliberately excludes release, package digest and harness. Switching harnesses or updating
    // the same approved instance preserves data; distinct scopes use distinct instance IDs.
    dataKey: `instances/${identity(input.pluginId, input.instanceId)}`,
    preserveDataAcrossUpdates: true,
    strategy: selectedStrategy,
    compatibility,
    allowedToActivate: false,
    approvalRequired: true,
    selection:
      selectedStrategy === 'unavailable'
        ? { skillDirectories: [], mcpServers: {} }
        : { skillDirectories, mcpServers: Object.fromEntries(servers) },
    disabled,
    requiredCredentials: [...(input.requiredCredentials ?? [])],
    requiredConnectors: [...(input.requiredConnectors ?? [])],
    preconditions: [
      'Verify catalog integrity/provenance and exact source digest before applying the package recipe.',
      'Use an immutable package root; preserve source file modes and complete skill directories/resources.',
      'Create a writable data directory for this instance; never key it by release or copy credentials between instances.',
      'Control Plane must authorize activation, filesystem/network access, executables and credential bindings.',
      'Recheck the actual harness/runtime/adapter profile and realpath containment immediately before activation.',
      'Native mode registers exactly one package root. Component mode registers only the selected skill directories and MCP bindings, never legacy hooks/config files.',
      'Do not install dependencies or run lifecycle scripts implicitly; review required executables and skill compatibility requirements.',
      'Skill allowed-tools metadata is advisory and never grants permission.',
      'Namespace registrations by installation identity; detect skill/server name collisions instead of overwriting existing harness configuration.',
      'Remote authorization is client-managed. Do not expand remote URLs/headers or forward configured headers to another origin without authorization.',
    ],
  })
}

export interface RuntimeRoots {
  readonly pluginRoot: string
  readonly pluginData: string
}
/** Exact, single-pass expansion. Replacement text is never scanned recursively. */
export function expandPluginPaths(value: string, roots: RuntimeRoots): string {
  return value.replace(/\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g, (_match, name: string) =>
    name === 'PLUGIN_ROOT' ? roots.pluginRoot : roots.pluginData
  )
}
function within(path: string, root: string): boolean {
  const suffix = relative(root, path)
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}
export type McpBinding =
  | {
      type: 'stdio'
      command: string
      args: string[]
      cwd: string
      env: Record<string, string>
      shell: false
    }
  | {
      type: 'streamable-http' | 'sse'
      url: string
      headers: Record<string, string>
      redirectPolicy: 'same-origin'
      authorization: 'control-plane'
    }

/** Produce concrete Control Plane launch/connect descriptors, without launching or connecting. */
export function resolveMcpBinding(
  input: McpServer,
  roots: RuntimeRoots,
  baseEnv: Readonly<Record<string, string>> = {},
  platform: 'posix' | 'win32' = process.platform === 'win32' ? 'win32' : 'posix'
): McpBinding {
  const server = validateServer(input)
  if (!isAbsolute(roots.pluginRoot) || !isAbsolute(roots.pluginData))
    throw new Error('Runtime plugin roots must be absolute paths.')
  if (server.type !== 'stdio')
    return {
      type: server.type,
      url: server.url,
      headers: { ...server.headers },
      redirectPolicy: 'same-origin',
      authorization: 'control-plane',
    }
  const command = server.command.startsWith('./')
    ? resolve(roots.pluginRoot, server.command)
    : server.command
  if (server.command.startsWith('./') && !within(command, roots.pluginRoot))
    throw new Error('Executable escapes the plugin root.')
  const cwdInput = server.cwd ?? '${PLUGIN_ROOT}'
  const cwdRoot = cwdInput.startsWith('${PLUGIN_DATA}') ? roots.pluginData : roots.pluginRoot
  const expanded = expandPluginPaths(cwdInput, roots)
  const cwd = resolve(roots.pluginRoot, expanded)
  if (!within(cwd, cwdRoot)) throw new Error('Working directory escapes its declared root.')
  const env: Record<string, string> = {}
  const overlay = (name: string, value: string): void => {
    if (platform === 'win32')
      for (const existing of Object.keys(env))
        if (existing.toUpperCase() === name.toUpperCase()) delete env[existing]
    Object.defineProperty(env, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  for (const [key, value] of Object.entries(baseEnv)) overlay(key, value)
  for (const [key, value] of Object.entries(server.env ?? {}))
    overlay(key, expandPluginPaths(value, roots))
  overlay('PLUGIN_ROOT', roots.pluginRoot)
  overlay('PLUGIN_DATA', roots.pluginData)
  return {
    type: 'stdio',
    command,
    args: (server.args ?? []).map((arg) => expandPluginPaths(arg, roots)),
    cwd,
    env,
    shell: false,
  }
}

/** Mandatory filesystem preflight for Control Plane callers after safe materialization.
 * Call immediately before activation inside the same protected installation boundary;
 * a separate preflight is not a substitute for preventing concurrent filesystem mutation.
 */
export async function verifyBindingPaths(input: McpServer, roots: RuntimeRoots): Promise<void> {
  const binding = resolveMcpBinding(input, roots)
  if (binding.type !== 'stdio' || input.type !== 'stdio') return
  const root = await realpath(roots.pluginRoot)
  const data = await realpath(roots.pluginData)
  if (root !== roots.pluginRoot || data !== roots.pluginData)
    throw new Error('Supply canonical filesystem-resolved runtime roots.')
  const cwd = await realpath(binding.cwd)
  const expected = input.cwd?.startsWith('${PLUGIN_DATA}') ? data : root
  if (!within(cwd, expected))
    throw new Error('Working directory resolves outside its declared root.')
  if (input.command.startsWith('./') && !within(await realpath(binding.command), root))
    throw new Error('Executable resolves outside the package root.')
}
