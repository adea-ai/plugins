import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileAgentPackage } from './agent-plugins-catalog.js'
import {
  PLUGIN_SCHEMA_ID,
  MCP_SCHEMA_ID,
  type HarnessProfile,
  type McpServer,
} from './agent-plugins-schema.js'
import {
  createInstallationPlan,
  resolveMcpBinding,
  expandPluginPaths,
  verifyBindingPaths,
} from './agent-plugins-harness.js'

function profile(overrides: Partial<HarnessProfile> = {}): HarnessProfile {
  return {
    profileVersion: 1,
    harness: 'example-harness',
    runtimeVersion: 'fixture-1',
    adapterVersion: 'fixture-1',
    agentPlugins: {
      versions: ['1.0.0'],
      skills: true,
      mcpTransports: ['stdio', 'streamable-http'],
    },
    components: { skillDirectories: true, mcpTransports: ['stdio', 'streamable-http'] },
    ...overrides,
  }
}
function packageFixture(extra: Record<string, string> = {}) {
  const files = new Map(
    Object.entries({
      'plugin.json': JSON.stringify({ $schema: PLUGIN_SCHEMA_ID, name: 'issues' }),
      'skills/issues/SKILL.md':
        '---\nname: issues\ndescription: Work with issues.\n---\nInstructions.',
      'mcp.json': JSON.stringify({
        $schema: MCP_SCHEMA_ID,
        mcpServers: {
          api: { type: 'streamable-http', url: 'https://example.test/mcp' },
          local: { type: 'stdio', command: 'node' },
        },
      }),
      ...extra,
    }).map(([path, text]) => [path, new TextEncoder().encode(text)])
  )
  return compileAgentPackage({ files, name: 'issues' })
}
function input(pkg = packageFixture()) {
  return {
    pluginId: 'plugin:test:issues',
    releaseId: `release:${'a'.repeat(64)}`,
    instanceId: 'workspace-a/user-a',
    source: {
      repositoryUrl: 'https://github.com/example/issues',
      commitSha: 'b'.repeat(40),
      pluginSubdirectory: '.',
      contentDigest: pkg.sourceDigest,
    },
    package: pkg,
    profile: profile(),
  }
}

describe('Control Plane installation plan v2', () => {
  it('selects a single native package root without copying into harness-specific directories', () => {
    const plan = createInstallationPlan(input())
    assert.equal(plan.planVersion, 2)
    assert.equal(plan.strategy, 'native-agent-plugin')
    assert.equal(plan.compatibility, 'full')
    assert.deepEqual(plan.selection.skillDirectories, ['skills/issues'])
    assert.equal(plan.allowedToActivate, false)
    assert.equal(plan.approvalRequired, true)
    assert.ok(plan.packageKey.startsWith('packages/'))
  })
  it('uses component bindings for a non-native harness without changing package bytes', () => {
    const original = input()
    const native = createInstallationPlan(original)
    const adapted = createInstallationPlan({
      ...original,
      profile: profile({ agentPlugins: { versions: [], skills: false, mcpTransports: [] } }),
    })
    assert.equal(adapted.strategy, 'component-adapter')
    assert.equal(adapted.package.packageDigest, native.package.packageDigest)
    assert.deepEqual(adapted.selection, native.selection)
  })
  it('does not treat a harness name as proof of support', () => {
    const plan = createInstallationPlan({
      ...input(),
      profile: profile({
        harness: 'codex',
        agentPlugins: { versions: [], skills: false, mcpTransports: [] },
        components: { skillDirectories: false, mcpTransports: [] },
      }),
    })
    assert.equal(plan.compatibility, 'unsupported')
    assert.equal(plan.strategy, 'unavailable')
  })
  it('supports explicit partial adoption but requires opt-in before selecting components', () => {
    const p = profile({
      agentPlugins: { versions: ['1.0.0'], skills: true, mcpTransports: [] },
      components: { skillDirectories: false, mcpTransports: [] },
    })
    const blocked = createInstallationPlan({ ...input(), profile: p })
    assert.equal(blocked.compatibility, 'partial')
    assert.equal(blocked.strategy, 'unavailable')
    assert.deepEqual(blocked.selection.skillDirectories, [])
    const accepted = createInstallationPlan({ ...input(), profile: p, allowPartial: true })
    assert.equal(accepted.strategy, 'native-agent-plugin')
    assert.deepEqual(accepted.selection.skillDirectories, ['skills/issues'])
    assert.equal(accepted.disabled.length, 2)
  })
  it('chooses a complete component adapter over a native loader with weaker capabilities', () => {
    const plan = createInstallationPlan({
      ...input(),
      profile: profile({ agentPlugins: { versions: ['1.0.0'], skills: true, mcpTransports: [] } }),
    })
    assert.equal(plan.strategy, 'component-adapter')
    assert.equal(plan.compatibility, 'full')
  })
  it('does not activate proprietary extras accidentally through a native loader', () => {
    const pkg = packageFixture({ 'hooks/hooks.json': '{}' })
    const plan = createInstallationPlan({ ...input(pkg), allowPartial: true })
    assert.equal(plan.strategy, 'component-adapter')
    assert.equal(plan.compatibility, 'partial')
    assert.ok(plan.disabled.some((item) => item.component === 'hooks'))
  })
  it('preserves instance data across releases and harnesses but isolates other instances', () => {
    const first = createInstallationPlan(input())
    const updatedPkg = packageFixture({ 'CHANGELOG.md': 'A new release.' })
    const updated = createInstallationPlan({
      ...input(updatedPkg),
      releaseId: `release:${'c'.repeat(64)}`,
      profile: profile({ harness: 'another-harness' }),
    })
    assert.equal(first.dataKey, updated.dataKey)
    assert.notEqual(first.packageKey, updated.packageKey)
    assert.notEqual(
      first.dataKey,
      createInstallationPlan({ ...input(), instanceId: 'workspace-b/user-a' }).dataKey
    )
    assert.notEqual(
      first.dataKey,
      createInstallationPlan({ ...input(), pluginId: 'plugin:other:issues' }).dataKey
    )
  })
  it('does not reuse a package cache across source commits with potentially different file modes', () => {
    const original = input()
    const other = { ...original, source: { ...original.source, commitSha: 'c'.repeat(40) } }
    assert.notEqual(
      createInstallationPlan(original).packageKey,
      createInstallationPlan(other).packageKey
    )
    assert.equal(createInstallationPlan(original).dataKey, createInstallationPlan(other).dataKey)
  })
  it('rejects mismatched source provenance and unversioned capability claims', () => {
    const args = input()
    assert.throws(() =>
      createInstallationPlan({
        ...args,
        source: { ...args.source, contentDigest: `sha256:${'f'.repeat(64)}` },
      })
    )
    assert.throws(() =>
      createInstallationPlan({ ...args, profile: { ...args.profile, runtimeVersion: '' } })
    )
  })
})

describe('MCP binding preparation', () => {
  const roots = { pluginRoot: '/packages/with spaces', pluginData: '/data/with spaces' }
  it('keeps command and arguments separate and overrides reserved variables last', () => {
    const server: McpServer = {
      type: 'stdio',
      command: 'node',
      args: ['${PLUGIN_ROOT}/run.mjs', '${UNRECOGNIZED}', '${PLUGIN_DATA}'],
      env: { CONFIG: '${PLUGIN_ROOT}/config.json' },
    }
    const binding = resolveMcpBinding(server, roots, {
      PLUGIN_ROOT: 'wrong',
      PLUGIN_DATA: 'wrong',
      SAFE: 'yes',
    })
    assert.equal(binding.type, 'stdio')
    if (binding.type !== 'stdio') return
    assert.equal(binding.command, 'node')
    assert.equal(binding.shell, false)
    assert.equal(binding.cwd, roots.pluginRoot)
    assert.deepEqual(binding.args, [
      '/packages/with spaces/run.mjs',
      '${UNRECOGNIZED}',
      '/data/with spaces',
    ])
    assert.equal(binding.env.PLUGIN_ROOT, roots.pluginRoot)
    assert.equal(binding.env.PLUGIN_DATA, roots.pluginData)
    assert.equal(binding.env.SAFE, 'yes')
  })
  it('expands once, leaving replacement text and unrelated placeholders literal', () => {
    assert.equal(
      expandPluginPaths('${PLUGIN_ROOT}/${PLUGIN_DATA}/${HOME}', {
        pluginRoot: '/root/${PLUGIN_DATA}',
        pluginData: '/state',
      }),
      '/root/${PLUGIN_DATA}//state/${HOME}'
    )
  })
  it('handles case-insensitive environment overlays without reserved-name shadowing', () => {
    const binding = resolveMcpBinding(
      { type: 'stdio', command: 'node', env: { Path: '/safe' } },
      roots,
      { PATH: '/old', plugin_root: 'wrong', Plugin_Data: 'wrong' },
      'win32'
    )
    assert.equal(binding.type, 'stdio')
    if (binding.type !== 'stdio') return
    assert.equal(binding.env.PATH, undefined)
    assert.equal(binding.env.Path, '/safe')
    assert.equal(binding.env.plugin_root, undefined)
    assert.equal(binding.env.Plugin_Data, undefined)
    assert.equal(binding.env.PLUGIN_ROOT, roots.pluginRoot)
  })
  it('never expands remote URLs or headers and requires same-origin redirects', () => {
    const binding = resolveMcpBinding(
      {
        type: 'streamable-http',
        url: 'https://example.test/mcp',
        headers: { 'X-Literal': '${PLUGIN_DATA}' },
      },
      roots
    )
    assert.deepEqual(binding, {
      type: 'streamable-http',
      url: 'https://example.test/mcp',
      headers: { 'X-Literal': '${PLUGIN_DATA}' },
      redirectPolicy: 'same-origin',
      authorization: 'control-plane',
    })
  })
  it('rejects filesystem-resolved escapes before activation', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'adea-binding-'))
    try {
      const pluginRoot = join(temporary, 'package')
      const pluginData = join(temporary, 'data')
      await mkdir(pluginRoot)
      await mkdir(pluginData)
      await writeFile(join(temporary, 'outside'), 'never execute')
      await symlink(join(temporary, 'outside'), join(pluginRoot, 'server'))
      const canonical = {
        pluginRoot: await realpath(pluginRoot),
        pluginData: await realpath(pluginData),
      }
      await assert.rejects(
        verifyBindingPaths({ type: 'stdio', command: './server' }, canonical),
        /outside/
      )
      await symlink(temporary, join(pluginData, 'escape'))
      await assert.rejects(
        verifyBindingPaths(
          { type: 'stdio', command: 'node', cwd: '${PLUGIN_DATA}/escape' },
          canonical
        ),
        /outside/
      )
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
})

/** A package built from an explicit file map, so every shape is explicit. */
function packageFrom(files: Record<string, string>) {
  return compileAgentPackage({
    files: new Map(
      Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)])
    ),
    name: 'issues',
  })
}

const MANIFEST = JSON.stringify({ $schema: PLUGIN_SCHEMA_ID, name: 'issues' })
const SKILL = '---\nname: issues\ndescription: Work with issues.\n---\nInstructions.'
const MCP_BOTH = JSON.stringify({
  $schema: MCP_SCHEMA_ID,
  mcpServers: {
    api: { type: 'streamable-http', url: 'https://example.test/mcp' },
    local: { type: 'stdio', command: 'node' },
  },
})

/** The package shapes the compatibility matrix is exercised over. */
const PACKAGES = {
  full: packageFrom({
    'plugin.json': MANIFEST,
    'skills/issues/SKILL.md': SKILL,
    'mcp.json': MCP_BOTH,
  }),
  skillsOnly: packageFrom({
    'plugin.json': MANIFEST,
    'skills/issues/SKILL.md': SKILL,
  }),
  mcpOnly: packageFrom({
    'plugin.json': MANIFEST,
    'mcp.json': MCP_BOTH,
  }),
  withHooks: packageFrom({
    'plugin.json': MANIFEST,
    'skills/issues/SKILL.md': SKILL,
    'mcp.json': MCP_BOTH,
    'hooks/hooks.json': '{}',
  }),
  bare: packageFrom({ 'plugin.json': MANIFEST }),
} as const

/** The profile shapes the compatibility matrix is exercised over. */
const PROFILES = {
  native: profile({
    agentPlugins: {
      versions: ['1.0.0'],
      skills: true,
      mcpTransports: ['stdio', 'streamable-http'],
    },
    components: { skillDirectories: true, mcpTransports: ['stdio', 'streamable-http'] },
  }),
  versionUnsupported: profile({
    agentPlugins: {
      versions: ['9.9.9'],
      skills: true,
      mcpTransports: ['stdio', 'streamable-http'],
    },
    components: { skillDirectories: true, mcpTransports: ['stdio', 'streamable-http'] },
  }),
  nativeSkillsOff: profile({
    agentPlugins: {
      versions: ['1.0.0'],
      skills: false,
      mcpTransports: ['stdio', 'streamable-http'],
    },
    components: { skillDirectories: true, mcpTransports: ['stdio', 'streamable-http'] },
  }),
  adapterStronger: profile({
    agentPlugins: { versions: ['1.0.0'], skills: true, mcpTransports: ['stdio'] },
    components: { skillDirectories: true, mcpTransports: ['stdio', 'streamable-http'] },
  }),
  nothingCovered: profile({
    agentPlugins: { versions: ['1.0.0'], skills: false, mcpTransports: [] },
    components: { skillDirectories: false, mcpTransports: [] },
  }),
  nativeWithoutHttp: profile({
    agentPlugins: { versions: ['1.0.0'], skills: true, mcpTransports: ['stdio'] },
    components: { skillDirectories: false, mcpTransports: [] },
  }),
} as const

/**
 * The compatibility matrix.
 *
 * Every row states the package shape, the profile shape, whether a partial
 * adoption was allowed, and what the plan must then contain. The expectations
 * are the EXISTING contract: the native loader is used only when the profile
 * supports the package version and the native path covers at least as much as
 * the adapter; a partial plan is refused unless the caller opts in; a plan that
 * covers nothing is unsupported.
 */
const MATRIX: {
  name: string
  pkg: keyof typeof PACKAGES
  profile: keyof typeof PROFILES
  allowPartial?: boolean
  strategy: string
  compatibility: string
  skills: string[]
  mcp: string[]
  disabled: string[]
}[] = [
  {
    name: 'supported version, native covers everything',
    pkg: 'full',
    profile: 'native',
    strategy: 'native-agent-plugin',
    compatibility: 'full',
    skills: ['skills/issues'],
    mcp: ['api', 'local'],
    disabled: [],
  },
  {
    name: 'unsupported package version falls back to the component adapter',
    pkg: 'full',
    profile: 'versionUnsupported',
    strategy: 'component-adapter',
    compatibility: 'full',
    skills: ['skills/issues'],
    mcp: ['api', 'local'],
    disabled: [],
  },
  {
    name: 'a native loader without skills yields to the stronger adapter',
    pkg: 'full',
    profile: 'nativeSkillsOff',
    strategy: 'component-adapter',
    compatibility: 'full',
    skills: ['skills/issues'],
    mcp: ['api', 'local'],
    disabled: [],
  },
  {
    name: 'an adapter that covers more wins over a weaker native loader',
    pkg: 'full',
    profile: 'adapterStronger',
    strategy: 'component-adapter',
    compatibility: 'full',
    skills: ['skills/issues'],
    mcp: ['api', 'local'],
    disabled: [],
  },
  {
    name: 'a profile that covers nothing is unsupported',
    pkg: 'full',
    profile: 'nothingCovered',
    strategy: 'unavailable',
    compatibility: 'unsupported',
    skills: [],
    mcp: [],
    disabled: ['skill:issues', 'mcp:api', 'mcp:local'],
  },
  {
    name: 'a transport the native loader lacks is disabled, and a partial plan is refused',
    pkg: 'full',
    profile: 'nativeWithoutHttp',
    strategy: 'unavailable',
    compatibility: 'partial',
    skills: [],
    mcp: [],
    disabled: ['mcp:api'],
  },
  {
    name: 'the same package is adopted partially when the caller opts in',
    pkg: 'full',
    profile: 'nativeWithoutHttp',
    allowPartial: true,
    strategy: 'native-agent-plugin',
    compatibility: 'partial',
    skills: ['skills/issues'],
    mcp: ['local'],
    disabled: ['mcp:api'],
  },
  {
    name: 'a skills-only package plans natively',
    pkg: 'skillsOnly',
    profile: 'native',
    strategy: 'native-agent-plugin',
    compatibility: 'full',
    skills: ['skills/issues'],
    mcp: [],
    disabled: [],
  },
  {
    name: 'an mcp-only package plans natively',
    pkg: 'mcpOnly',
    profile: 'native',
    strategy: 'native-agent-plugin',
    compatibility: 'full',
    skills: [],
    mcp: ['api', 'local'],
    disabled: [],
  },
  {
    name: 'a non-portable extra keeps the package off the native loader',
    pkg: 'withHooks',
    profile: 'native',
    strategy: 'unavailable',
    compatibility: 'partial',
    skills: [],
    mcp: [],
    disabled: ['hooks'],
  },
  {
    name: 'the same package is adopted partially when the caller opts in',
    pkg: 'withHooks',
    profile: 'native',
    allowPartial: true,
    strategy: 'component-adapter',
    compatibility: 'partial',
    skills: ['skills/issues'],
    mcp: ['api', 'local'],
    disabled: ['hooks'],
  },
  {
    name: 'a package with no skills and no servers is unsupported',
    pkg: 'bare',
    profile: 'native',
    strategy: 'unavailable',
    compatibility: 'unsupported',
    skills: [],
    mcp: [],
    disabled: [],
  },
]

describe('the compatibility matrix across package and profile capabilities', () => {
  for (const row of MATRIX) {
    it(row.name, () => {
      const pkg = PACKAGES[row.pkg]
      const plan = createInstallationPlan({
        pluginId: 'plugin:test:issues',
        releaseId: `release:${'a'.repeat(64)}`,
        instanceId: 'workspace-a/user-a',
        source: {
          repositoryUrl: 'https://github.com/example/issues',
          commitSha: 'b'.repeat(40),
          pluginSubdirectory: '.',
          contentDigest: pkg.sourceDigest,
        },
        package: pkg,
        profile: PROFILES[row.profile],
        ...(row.allowPartial === undefined ? {} : { allowPartial: row.allowPartial }),
      })
      assert.equal(plan.strategy, row.strategy)
      assert.equal(plan.compatibility, row.compatibility)
      assert.deepEqual(plan.selection.skillDirectories, row.skills)
      assert.deepEqual(Object.keys(plan.selection.mcpServers).toSorted(), row.mcp.toSorted())
      for (const component of row.disabled)
        assert.ok(
          plan.disabled.some((entry) => entry.component === component),
          `expected ${component} to be disabled, got ${JSON.stringify(plan.disabled)}`
        )
      if (row.disabled.length === 0) assert.deepEqual(plan.disabled, [])
      // A refused plan selects nothing, and no plan ever activates by itself.
      assert.equal(plan.allowedToActivate, false)
      assert.equal(plan.approvalRequired, true)
      if (row.strategy === 'unavailable') {
        assert.deepEqual(plan.selection.skillDirectories, [])
        assert.deepEqual(plan.selection.mcpServers, {})
      }
    })
  }
})

describe('upgrade identity isolation', () => {
  it('isolates instances and plugins, and pins the package identity across upgrades', () => {
    const base = input()
    const first = createInstallationPlan(base)

    // A distinct instance of the same plugin owns its own data.
    assert.notEqual(
      first.dataKey,
      createInstallationPlan({ ...base, instanceId: 'workspace-b/user-a' }).dataKey
    )
    // A distinct plugin under the same instance id owns its own data.
    assert.notEqual(
      first.dataKey,
      createInstallationPlan({ ...base, pluginId: 'plugin:other:issues' }).dataKey
    )

    // An upgraded package (new bytes) is a different PACKAGE, under the same
    // instance data: the data is preserved across the upgrade.
    const upgraded = createInstallationPlan({
      ...input(packageFixture({ 'CHANGELOG.md': 'A new release.' })),
      releaseId: `release:${'c'.repeat(64)}`,
    })
    assert.notEqual(first.packageKey, upgraded.packageKey)
    assert.equal(first.dataKey, upgraded.dataKey)
    assert.equal(upgraded.preserveDataAcrossUpdates, true)

    // A new release id over the SAME bytes is the same package identity: the
    // package key pins the source and the package bytes, and the release is
    // deliberately excluded from the data key.
    const rereleased = createInstallationPlan({ ...base, releaseId: `release:${'d'.repeat(64)}` })
    assert.equal(first.packageKey, rereleased.packageKey)
    assert.equal(first.dataKey, rereleased.dataKey)
    assert.notEqual(first.releaseId, rereleased.releaseId)

    // A different source commit is a different package identity under the same
    // instance data.
    const otherCommit = createInstallationPlan({
      ...base,
      source: { ...base.source, commitSha: 'c'.repeat(40) },
    })
    assert.notEqual(first.packageKey, otherCommit.packageKey)
    assert.equal(first.dataKey, otherCommit.dataKey)
  })
})
