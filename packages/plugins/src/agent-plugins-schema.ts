import { z } from 'zod'

// Locally pinned contracts. Never fetch a schema while inspecting a plugin.
export const AGENT_PLUGINS_VERSION = '1.0.0' as const
export const PLUGIN_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
export const MCP_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
export const NORMALIZER_VERSION = 'adea-agent-plugins/1' as const
export const PluginNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/)
const Strings = z.record(z.string(), z.string())
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const Path = z
  .string()
  .min(1)
  .max(1024)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\:\u0000-\u001f\u007f/]+(?:\/[^\\:\u0000-\u001f\u007f/]+)*$/
  )

export const AgentManifestSchema = z
  .object({
    $schema: z.literal(PLUGIN_SCHEMA_ID),
    name: PluginNameSchema,
    version: z.string().optional(),
    description: z.string().optional(),
    author: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
        url: z.string().optional(),
      })
      .strict()
      .optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    license: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    extensions: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .strict()

export const McpServerSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('stdio'),
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      env: Strings.optional(),
      cwd: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('streamable-http'),
      url: z.string().min(1),
      headers: Strings.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal('sse'), url: z.string().min(1), headers: Strings.optional() })
    .strict(),
])
export const AgentMcpSchema = z
  .object({ $schema: z.literal(MCP_SCHEMA_ID), mcpServers: z.record(z.string(), McpServerSchema) })
  .strict()

export const SkillFrontmatterSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    description: z.string().min(1).max(1024),
    license: z.string().optional(),
    compatibility: z.string().min(1).max(500).optional(),
    metadata: Strings.optional(),
    'allowed-tools': z.string().optional(),
  })
  .strict()

export const DiagnosticSchema = z
  .object({
    code: z.string().min(1),
    scope: z.enum(['plugin', 'skills', 'skill', 'mcp', 'server', 'extension', 'translation']),
    path: z.string(),
    severity: z.enum(['warning', 'error']),
    message: z.string().min(1),
  })
  .strict()
export const PackageFileSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('copy'),
      sourcePath: Path,
      targetPath: Path,
      digest: Digest,
      preserveMode: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('write'),
      targetPath: Path,
      digest: Digest,
      content: z.string(),
      mode: z.literal('0644'),
    })
    .strict(),
])
export const AgentPackageSchema = z
  .object({
    contractVersion: z.literal(1),
    normalizerVersion: z.literal(NORMALIZER_VERSION),
    format: z.literal('agent-plugins'),
    specVersion: z.literal(AGENT_PLUGINS_VERSION),
    originFormat: z.enum(['agent-plugins', 'legacy']),
    sourceDigest: Digest,
    status: z.enum(['portable', 'partial', 'unavailable']),
    manifest: AgentManifestSchema.optional(),
    packageDigest: Digest.optional(),
    files: z.array(PackageFileSchema).max(8192),
    skills: z.array(
      z
        .object({
          name: z.string(),
          path: Path,
          description: z.string(),
          compatibility: z.string().optional(),
          allowedTools: z.string().optional(),
        })
        .strict()
    ),
    mcpServers: z.record(z.string(), McpServerSchema),
    nonPortable: z.array(
      z.object({ kind: z.string(), paths: z.array(Path), reason: z.string() }).strict()
    ),
    diagnostics: z.array(DiagnosticSchema),
    requirements: z
      .object({
        skills: z.boolean(),
        mcpTransports: z.array(z.enum(['stdio', 'streamable-http', 'sse'])),
        executables: z.array(z.string()),
        environmentReview: z.boolean(),
      })
      .strict(),
  })
  .strict()

/** Reported by the actual Control Plane harness adapter, not inferred from a brand name. */
export const HarnessProfileSchema = z
  .object({
    profileVersion: z.literal(1),
    harness: z.string().min(1).max(128),
    runtimeVersion: z.string().min(1).max(128),
    adapterVersion: z.string().min(1).max(128),
    agentPlugins: z
      .object({
        versions: z.array(z.string()),
        skills: z.boolean(),
        mcpTransports: z.array(z.enum(['stdio', 'streamable-http', 'sse'])),
      })
      .strict(),
    components: z
      .object({
        skillDirectories: z.boolean(),
        mcpTransports: z.array(z.enum(['stdio', 'streamable-http', 'sse'])),
      })
      .strict(),
  })
  .strict()

export const InstallationPlanSchema = z
  .object({
    planVersion: z.literal(2),
    pluginId: z.string().min(1),
    releaseId: z.string().min(1),
    instanceId: z.string().min(1).max(256),
    profile: HarnessProfileSchema,
    source: z
      .object({
        repositoryUrl: z.string().url(),
        commitSha: z.string().regex(/^[a-f0-9]{40}$/),
        pluginSubdirectory: z.string().min(1).max(1024),
        contentDigest: Digest,
      })
      .strict(),
    package: AgentPackageSchema,
    packageKey: z.string(),
    dataKey: z.string(),
    preserveDataAcrossUpdates: z.literal(true),
    strategy: z.enum(['native-agent-plugin', 'component-adapter', 'unavailable']),
    compatibility: z.enum(['full', 'partial', 'unsupported']),
    allowedToActivate: z.literal(false),
    approvalRequired: z.literal(true),
    selection: z
      .object({
        skillDirectories: z.array(Path),
        mcpServers: z.record(z.string(), McpServerSchema),
      })
      .strict(),
    disabled: z.array(z.object({ component: z.string(), reason: z.string() }).strict()),
    requiredConnectors: z.array(z.string()),
    requiredCredentials: z.array(z.string()),
    preconditions: z.array(z.string()),
  })
  .strict()

export type AgentManifest = z.infer<typeof AgentManifestSchema>
export type McpServer = z.infer<typeof McpServerSchema>
export type AgentPackage = z.infer<typeof AgentPackageSchema>
export type PackageFile = z.infer<typeof PackageFileSchema>
export type Diagnostic = z.infer<typeof DiagnosticSchema>
export type HarnessProfile = z.infer<typeof HarnessProfileSchema>
export type InstallationPlan = z.infer<typeof InstallationPlanSchema>
