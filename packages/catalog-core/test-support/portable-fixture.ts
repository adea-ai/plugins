import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SyncInput } from '../src/index.js'
import { PLUGIN_SCHEMA_ID, MCP_SCHEMA_ID } from '@adea-ai/catalog-schema/agent-plugins'

export async function withPortableFixture(
  run: (input: SyncInput, root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'adea-portable-'))
  const input: SyncInput = {
    mode: 'offline',
    fixtureRoot: join(root, 'fixtures'),
    sources: [
      {
        sourceId: 'test-source',
        displayName: 'Test Source',
        marketplaceDialect: 'claude',
        repositoryUrl: 'https://github.com/example/portable-fixture',
        manifestPath: 'marketplace.json',
        defaultBranch: 'main',
        trustClassification: 'official',
        fixturePath: 'source',
        fixtureCommitSha: 'a'.repeat(40),
      },
    ],
    categoryMap: { aliases: {}, fallback: 'other' },
    productAliases: { aliases: {} },
    policy: {
      allowedRepositoryHosts: ['github.com'],
      allowedRepositoryProtocols: ['https:'],
      maxFilesPerPlugin: 4096,
      maxBytesPerPlugin: 50 * 1024 * 1024,
      maxFileBytes: 5 * 1024 * 1024,
      maxMarketplacePlugins: 4096,
      denyExecutableLifecycleScripts: true,
      publishRequiresCompleteContent: false,
      sensitiveCapabilityTypes: ['mcp-server', 'hook', 'executable'],
    },
  }
  const files: Record<string, string> = {
    'config/sources.json': JSON.stringify({ sources: input.sources }),
    'config/category-map.json': JSON.stringify(input.categoryMap),
    'config/product-aliases.json': JSON.stringify(input.productAliases),
    'config/policy.json': JSON.stringify(input.policy),
    'fixtures/source/marketplace.json': JSON.stringify({
      name: 'fixture',
      plugins: [{ name: 'review-kit', source: './plugins/review-kit' }],
    }),
    'fixtures/source/plugins/review-kit/plugin.json': JSON.stringify({
      $schema: PLUGIN_SCHEMA_ID,
      name: 'review-kit',
      description: 'Fixture only',
    }),
    'fixtures/source/plugins/review-kit/mcp.json': JSON.stringify({
      $schema: MCP_SCHEMA_ID,
      mcpServers: {
        local: { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/bin/server.mjs'] },
      },
    }),
    'fixtures/source/plugins/review-kit/bin/server.mjs': '// Fixture only; never executed.\n',
    'fixtures/source/plugins/review-kit/skills/review/SKILL.md':
      '---\nname: review\ndescription: Review changes.\n---\nSee references/checklist.md.\n',
    'fixtures/source/plugins/review-kit/skills/review/references/checklist.md':
      'Keep complete resources.\n',
  }
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    await run(input, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
