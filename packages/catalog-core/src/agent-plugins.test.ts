import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PLUGIN_SCHEMA_ID, MCP_SCHEMA_ID } from '@adea-ai/catalog-schema/agent-plugins'
import {
  compileAgentPackage,
  materializeAgentPackage,
  verifyAgentPackage,
  parsePluginJson,
  validateServer,
  sourceDigest,
  packageDigest,
  sha256,
} from './agent-plugins.js'

const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array | undefined) => new TextDecoder().decode(value)
const skill = (name = 'review') =>
  `---\nname: ${name}\ndescription: Review changes.\n---\nSee [guide](references/guide.md).\n`
function fixture(extra: Record<string, string> = {}): Map<string, Uint8Array> {
  return new Map(
    Object.entries({
      'plugin.json': JSON.stringify({ $schema: PLUGIN_SCHEMA_ID, name: 'review-kit' }),
      'skills/review/SKILL.md': skill(),
      'skills/review/references/guide.md': 'A reference.\n',
      'skills/review/scripts/check.py': 'print("fixture only")\n',
      'bin/server.mjs': '// An inert fixture; tests never execute it.\n',
      'mcp.json': JSON.stringify({
        $schema: MCP_SCHEMA_ID,
        mcpServers: {
          local: {
            type: 'stdio',
            command: 'node',
            args: ['${PLUGIN_ROOT}/bin/server.mjs'],
            env: { CACHE: '${PLUGIN_DATA}/cache' },
          },
          remote: { type: 'streamable-http', url: 'https://example.test/mcp' },
        },
      }),
      ...extra,
    }).map(([path, value]) => [path, bytes(value)])
  )
}
function compile(files = fixture()) {
  return compileAgentPackage({ files, name: 'review-kit' })
}

describe('canonical Agent Plugins package compiler', () => {
  it('preserves complete skill resources and source file modes without executing helpers', () => {
    const source = fixture()
    const pkg = compile(source)
    const materialized = materializeAgentPackage(pkg, source)
    assert.equal(pkg.status, 'portable')
    assert.equal(pkg.skills.length, 1)
    assert.equal(pkg.sourceDigest, sourceDigest(source))
    assert.equal(pkg.packageDigest, packageDigest(pkg.files))
    for (const path of [
      'skills/review/references/guide.md',
      'skills/review/scripts/check.py',
      'bin/server.mjs',
    ]) {
      assert.deepEqual(materialized.get(path), source.get(path))
      assert.equal(pkg.files.find((file) => file.targetPath === path)?.action, 'copy')
    }
    assert.equal(
      pkg.files.some((file) => file.targetPath.includes('skills/skills/')),
      false
    )
    assert.equal(pkg.requirements.environmentReview, true)
  })
  it('is byte-deterministic independent of snapshot insertion order', () => {
    const source = fixture()
    const reversed = new Map([...source].toReversed())
    assert.deepEqual(compile(source), compile(reversed))
  })
  it('treats canonical root metadata as authoritative over nested client manifests', () => {
    const pkg = compile(
      fixture({
        '.claude-plugin/plugin.json': '{invalid',
        'plugin.json': JSON.stringify({
          $schema: PLUGIN_SCHEMA_ID,
          name: 'root-wins',
          version: 'dev-build',
          homepage: 'not a url',
          author: { email: 'not an email' },
        }),
      })
    )
    assert.equal(pkg.manifest?.name, 'root-wins')
    assert.equal(pkg.manifest?.version, 'dev-build')
  })
  it('reports and ignores unknown manifest fields rather than using alternate discovery paths', () => {
    const pkg = compile(
      fixture({
        'plugin.json': JSON.stringify({
          $schema: PLUGIN_SCHEMA_ID,
          name: 'review-kit',
          skills: './elsewhere',
          mcpServers: { forged: { command: 'no' } },
        }),
      })
    )
    assert.equal(pkg.skills.length, 1)
    assert.equal(Object.keys(pkg.mcpServers).length, 2)
    assert.equal(pkg.diagnostics.filter((item) => item.code === 'UNKNOWN_MANIFEST_FIELD').length, 2)
    assert.equal('skills' in pkg.manifest!, false)
  })
  for (const raw of [
    { name: 'bad', $schema: 'https://agent-plugins.org/schemas/9/plugin.schema.json' },
    { name: 'Bad', $schema: PLUGIN_SCHEMA_ID },
    { name: 'good', $schema: PLUGIN_SCHEMA_ID, version: 5 },
    [],
    { name: 'good', $schema: PLUGIN_SCHEMA_ID, author: { unknown: 'x' } },
  ]) {
    it(`rejects invalid native metadata without a legacy fallback: ${JSON.stringify(raw)}`, () => {
      const pkg = compile(fixture({ 'plugin.json': JSON.stringify(raw) }))
      // A root array is a malformed legacy manifest, also unavailable.
      assert.equal(pkg.status, 'unavailable')
      assert.deepEqual(pkg.files, [])
    })
  }
  it('ignores non-object extensions and does not recursively validate unknown namespace data', () => {
    assert.notEqual(
      compile(
        fixture({
          'plugin.json': JSON.stringify({
            $schema: PLUGIN_SCHEMA_ID,
            name: 'x',
            extensions: false,
          }),
        })
      ).status,
      'unavailable'
    )
    const pkg = compile(
      fixture({
        'plugin.json': JSON.stringify({
          $schema: PLUGIN_SCHEMA_ID,
          name: 'x',
          extensions: { 'com.example.client': { arbitrary: [1, false] } },
        }),
      })
    )
    assert.equal(pkg.status, 'partial')
    assert.equal(pkg.nonPortable[0]?.kind, 'client-extension')
  })
  it('discovers only immediate skill directories and retains deeper SKILL.md as support content', () => {
    const pkg = compile(fixture({ 'skills/review/references/nested/SKILL.md': skill('nested') }))
    assert.deepEqual(
      pkg.skills.map((item) => item.name),
      ['review']
    )
    assert.ok(
      pkg.files.some((file) => file.targetPath === 'skills/review/references/nested/SKILL.md')
    )
  })
  for (const bad of [
    '---\nname: wrong\ndescription: x\n---\n',
    '---\nname: review\nname: review\ndescription: x\n---\n',
    '---\nname: review\ndescription: x\nmetadata:\n  enabled: true\n---\n',
    '---\nname: review\ndescription: !untrusted x\n---\n',
    'no yaml',
  ]) {
    it(`isolates invalid skill frontmatter: ${bad.slice(0, 32)}`, () => {
      const pkg = compile(
        fixture({ 'skills/review/SKILL.md': bad, 'skills/good/SKILL.md': skill('good') })
      )
      assert.equal(pkg.status, 'partial')
      assert.deepEqual(
        pkg.skills.map((item) => item.name),
        ['good']
      )
      assert.equal(
        pkg.files.some((file) => file.targetPath === 'skills/review/SKILL.md'),
        false
      )
      assert.equal(Object.keys(pkg.mcpServers).length, 2)
    })
  }
  it('supports folded YAML descriptions and CRLF without rewriting skill bytes', () => {
    const raw =
      '---\r\nname: review\r\ndescription: >-\r\n  Review changes\r\n  carefully.\r\n---\r\nbody\r\n'
    const files = fixture({ 'skills/review/SKILL.md': raw })
    const pkg = compile(files)
    assert.equal(pkg.skills[0]?.description, 'Review changes carefully.')
    assert.equal(text(materializeAgentPackage(pkg, files).get('skills/review/SKILL.md')), raw)
  })
  it('disables only MCP on top-level schema mismatch', () => {
    const pkg = compile(
      fixture({ 'mcp.json': JSON.stringify({ $schema: 'unsupported', mcpServers: {} }) })
    )
    assert.equal(pkg.skills.length, 1)
    assert.deepEqual(pkg.mcpServers, {})
    assert.ok(pkg.diagnostics.some((item) => item.code === 'INVALID_MCP_CONFIGURATION'))
  })
  it('isolates individual invalid MCP entries', () => {
    const pkg = compile(
      fixture({
        'mcp.json': JSON.stringify({
          $schema: MCP_SCHEMA_ID,
          mcpServers: {
            good: { type: 'stdio', command: 'node' },
            bad: { type: 'stdio', command: 'node --flag' },
            mixed: { type: 'stdio', command: 'node', url: 'https://example.test' },
          },
        }),
      })
    )
    assert.deepEqual(Object.keys(pkg.mcpServers), ['good'])
    assert.equal(pkg.skills.length, 1)
    assert.equal(pkg.diagnostics.filter((item) => item.code === 'INVALID_MCP_SERVER').length, 2)
  })
  it('does not treat missing component locations as invalid', () => {
    const files = new Map([
      ['plugin.json', bytes(JSON.stringify({ $schema: PLUGIN_SCHEMA_ID, name: 'minimal' }))],
    ])
    const pkg = compile(files)
    assert.equal(pkg.status, 'portable')
    assert.equal(pkg.diagnostics.length, 0)
  })
  it('handles wrong component filesystem kinds without invalidating other component types', () => {
    const files = fixture()
    files.delete('mcp.json')
    files.set('mcp.json/not-a-file', bytes('x'))
    const pkg = compile(files)
    assert.equal(pkg.skills.length, 1)
    assert.equal(pkg.status, 'partial')
    assert.doesNotThrow(() => verifyAgentPackage(pkg))
  })
  it('normalizes explicit legacy HTTP and package-root stdio references', () => {
    const files = fixture()
    files.delete('plugin.json')
    files.delete('mcp.json')
    files.set(
      '.claude-plugin/plugin.json',
      bytes(JSON.stringify({ name: 'review-kit', version: '1' }))
    )
    files.set(
      '.mcp.json',
      bytes(
        JSON.stringify({
          mcpServers: {
            remote: { type: 'http', url: 'https://example.test/mcp' },
            local: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/bin/server.mjs'] },
          },
        })
      )
    )
    const pkg = compile(files)
    assert.equal(pkg.originFormat, 'legacy')
    assert.equal(pkg.status, 'portable')
    assert.equal(pkg.mcpServers.remote?.type, 'streamable-http')
    assert.equal(
      pkg.mcpServers.local?.type === 'stdio' && pkg.mcpServers.local.args?.[0],
      '${PLUGIN_ROOT}/bin/server.mjs'
    )
    assert.doesNotThrow(() => materializeAgentPackage(pkg, files))
  })
  it('does not silently convert credential interpolation or infer a URL transport', () => {
    const files = fixture()
    files.delete('plugin.json')
    files.delete('mcp.json')
    files.set(
      '.mcp.json',
      bytes(
        JSON.stringify({
          mcpServers: {
            credential: {
              type: 'http',
              url: 'https://example.test',
              headers: { Authorization: 'Bearer ${TOKEN}' },
            },
            ambiguous: { url: 'https://example.test/sse' },
          },
        })
      )
    )
    const pkg = compile(files)
    assert.deepEqual(pkg.mcpServers, {})
    assert.equal(pkg.status, 'partial')
  })
  it('reports nonportable hooks/commands without disabling skills or granting execution', () => {
    const pkg = compile(fixture({ 'hooks/hooks.json': '{}', 'commands/run.md': 'legacy command' }))
    assert.equal(pkg.status, 'partial')
    assert.equal(pkg.skills.length, 1)
    assert.deepEqual(
      pkg.nonPortable.map((item) => item.kind),
      ['commands', 'hooks']
    )
  })
  it('rejects source and generated-byte tampering', () => {
    const source = fixture()
    const pkg = compile(source)
    source.set('bin/server.mjs', bytes('changed'))
    assert.throws(() => materializeAgentPackage(pkg, source), /digest/)
    const changed = structuredClone(pkg)
    const file = changed.files.find((item) => item.action === 'write')!
    if (file.action === 'write') file.content += ' '
    assert.throws(() => verifyAgentPackage(changed), /digest/)
  })
  it('rejects a hidden skill inventory even if the file-set digest has not changed', () => {
    const pkg = compile()
    pkg.skills = []
    pkg.requirements.skills = false
    assert.throws(() => verifyAgentPackage(pkg), /inventory/)
  })
  for (const path of ['../escape', '/absolute', 'C:/windows', 'a\\b', 'a/../b', 'null\0byte']) {
    it(`rejects unsafe snapshot path ${JSON.stringify(path)}`, () => {
      assert.equal(compile(fixture({ [path]: 'x' })).status, 'unavailable')
    })
  }
  it('rejects case aliases, symlinks and file/directory collisions', () => {
    assert.equal(compile(fixture({ 'BIN/server.mjs': 'x' })).status, 'unavailable')
    assert.equal(compile(fixture({ bin: 'not a directory' })).status, 'unavailable')
    assert.equal(
      compileAgentPackage({ files: fixture(), name: 'x', symlinks: ['skills/outside'] }).status,
      'unavailable'
    )
  })
  it('isolates generated control-file aliases and cross-platform path collisions', () => {
    for (const path of [
      'Plugin.json',
      'Mcp.json',
      'BIN/other.mjs',
      'nul.txt',
      'resources/a.',
      'resources/a ',
    ]) {
      const pkg = compile(fixture({ [path]: 'x' }))
      assert.equal(pkg.status, 'unavailable', path)
      assert.doesNotThrow(() => verifyAgentPackage(pkg))
    }
  })
  it('rejects duplicate escaped JSON keys without prototype mutation', () => {
    assert.throws(() => parsePluginJson('{"x":1,"\\u0078":2}'))
    assert.throws(() => parsePluginJson('{"a":{"x":1,"x":2}}'))
    const value = parsePluginJson('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    assert.equal(Object.prototype.hasOwnProperty.call(value, '__proto__'), true)
    assert.equal(Object.prototype.hasOwnProperty.call({}, 'polluted'), false)
  })
})

describe('MCP configuration semantics', () => {
  for (const server of [
    { type: 'stdio', command: '/usr/bin/node' },
    { type: 'stdio', command: '${PLUGIN_ROOT}/server' },
    { type: 'stdio', command: 'node --flag' },
    { type: 'stdio', command: 'node', env: { PLUGIN_DATA: 'override' } },
    { type: 'stdio', command: 'node', env: { plugin_root: 'override' } },
    { type: 'stdio', command: 'node', cwd: '${PLUGIN_DATA}/../../escape' },
    { type: 'stdio', command: 'node', cwd: 'relative' },
    { type: 'streamable-http', url: 'http://example.test/mcp' },
    { type: 'streamable-http', url: 'https://user:password@example.test/mcp' },
    { type: 'streamable-http', url: 'https://example.test/mcp#' },
    {
      type: 'streamable-http',
      url: 'https://example.test/mcp',
      headers: { Tenant: 'a', tenant: 'b' },
    },
    {
      type: 'streamable-http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer secret' },
    },
    { type: 'streamable-http', url: 'https://example.test/mcp', headers: { Host: 'other.test' } },
    { type: 'streamable-http', url: 'https://example.test/mcp', headers: { Tenant: 'a\r\nb' } },
  ])
    it(`rejects invalid server ${JSON.stringify(server)}`, () =>
      assert.throws(() => validateServer(server)))
  it('accepts loopback and keeps declared transport, args, and literal remote headers', () => {
    for (const url of ['http://localhost/mcp', 'http://127.0.0.2/mcp', 'http://[::1]/mcp'])
      assert.equal(validateServer({ type: 'sse', url }).type, 'sse')
    assert.deepEqual(
      validateServer({
        type: 'streamable-http',
        url: 'https://example.test/mcp',
        headers: { 'X-Literal': '${PLUGIN_DATA}' },
      }),
      {
        type: 'streamable-http',
        url: 'https://example.test/mcp',
        headers: { 'X-Literal': '${PLUGIN_DATA}' },
      }
    )
    assert.doesNotThrow(() =>
      validateServer({
        type: 'stdio',
        command: './bin/../server',
        args: ['space in argument', '--flag'],
      })
    )
  })
  it('detects rehashed control-file/descriptor disagreement', () => {
    const pkg = compile()
    const file = pkg.files.find((item) => item.targetPath === 'mcp.json')!
    if (file.action === 'write') {
      file.content = '{}\n'
      file.digest = sha256(file.content)
    }
    pkg.packageDigest = packageDigest(pkg.files)
    assert.throws(() => verifyAgentPackage(pkg), /MCP descriptor/)
  })
})
