import { z } from 'zod'

export const DIGEST_RE = /^sha256:[a-f0-9]{64}$/
export const SHA_RE = /^[a-f0-9]{40}$/

export const DigestSchema = z.string().regex(DIGEST_RE)
export const ShaSchema = z.string().regex(SHA_RE)
export const TimestampSchema = z.string().datetime({ offset: true })

export const MarketplaceDialectSchema = z.enum(['openai', 'cursor', 'claude'])
export const TrustClassificationSchema = z.enum(['official'])
export const SyncStatusSchema = z.enum(['synchronized', 'unchanged', 'failed'])

export const CapabilityTypeSchema = z.enum([
  'skill',
  'mcp-server',
  'connector',
  'command',
  'agent',
  'hook',
  'rule',
  'browser',
  'scheduled-task',
  'ui-component',
  'executable',
  'unknown',
])

export const HarnessSchema = z.enum([
  'codex',
  'claude-code',
  'cursor',
  'pi',
  'hermes',
  'opencode',
  'generic-skill-mcp',
])
export type Harness = z.output<typeof HarnessSchema>

export const CompatibilityStatusSchema = z.enum([
  'native',
  'portable',
  'requires-translation',
  'partially-supported',
  'unsupported',
  'blocked-by-policy',
  'unknown',
])

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
)

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema)

export const CatalogSourceSchema = z
  .object({
    sourceId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    displayName: z.string().min(1).max(160),
    repositoryUrl: z.string().url(),
    marketplaceDialect: MarketplaceDialectSchema,
    manifestPath: z.string().min(1).max(512),
    defaultBranch: z.string().regex(/^[A-Za-z0-9._/-]+$/),
    resolvedCommitSha: ShaSchema,
    retrievalTimestamp: TimestampSchema,
    trustClassification: TrustClassificationSchema,
    sourceManifestDigest: DigestSchema,
    synchronizationStatus: SyncStatusSchema,
  })
  .strict()

export const CapabilitySchema = z
  .object({
    type: CapabilityTypeSchema,
    name: z.string().min(1).max(200),
    paths: z.array(z.string().min(1).max(512)).max(512),
    metadata: JsonObjectSchema,
    securityImpact: z.enum(['none', 'review', 'sensitive']),
  })
  .strict()

export const HarnessCompatibilitySchema = z
  .object({
    status: CompatibilityStatusSchema,
    reasons: z.array(z.string().min(1).max(500)).max(64),
    responsibleCapabilities: z.array(CapabilityTypeSchema).max(32),
  })
  .strict()

export const LicenseMetadataSchema = z
  .object({
    name: z.string().min(1).max(200),
    spdxId: z.string().min(1).max(100).optional(),
    url: z.string().url().optional(),
    source: z.enum(['plugin-manifest', 'package-manifest', 'marketplace-entry', 'unknown']),
  })
  .strict()

export const SecurityClassificationSchema = z
  .object({
    level: z.enum(['low', 'review', 'sensitive']),
    reasons: z.array(z.string().min(1).max(500)).max(64),
    permissionSensitiveChanges: z.array(z.string().min(1).max(200)).max(64),
    contentResolution: z.enum(['complete', 'metadata-only']),
  })
  .strict()

export const PluginProvenanceSchema = z
  .object({
    sourceId: z.string().min(1),
    repositoryUrl: z.string().url(),
    manifestPath: z.string().min(1),
    pluginSubdirectory: z.string().min(1),
    resolvedCommitSha: ShaSchema,
    sourceManifestDigest: DigestSchema,
    upstreamEntryDigest: DigestSchema,
  })
  .strict()

export const PluginReleaseSchema = z
  .object({
    releaseId: z.string().regex(/^release:[a-f0-9]{64}$/),
    upstreamVersion: z.string().min(1).max(128).optional(),
    resolvedRepositoryUrl: z.string().url(),
    resolvedCommitSha: ShaSchema,
    pluginSubdirectory: z.string().min(1).max(512),
    canonicalContentDigest: DigestSchema,
    manifestDigest: DigestSchema,
    contentResolution: z.enum(['complete', 'metadata-only']),
    releaseMetadata: JsonObjectSchema,
    capabilities: z.array(CapabilitySchema).max(1024),
    requiredConnectors: z.array(z.string().min(1).max(200)).max(128),
    requiredCredentials: z.array(z.string().min(1).max(200)).max(128),
    permissionSensitiveChanges: z.array(z.string().min(1).max(200)).max(128),
    fileIndex: z.array(z.string().min(1).max(512)).max(4096),
    publicationTimestamp: TimestampSchema,
  })
  .strict()

export const PluginSchema = z
  .object({
    pluginId: z.string().regex(/^plugin:[a-z0-9-]+:[a-z0-9][a-z0-9-]{1,127}$/),
    displayName: z.string().min(1).max(200),
    description: z.string().max(4096),
    productGroupingKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,127}$/),
    categories: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(32),
    keywords: z.array(z.string().min(1).max(100)).max(128),
    authors: z.array(z.string().min(1).max(200)).max(32),
    homepage: z.string().url().optional(),
    icons: z.array(z.string().min(1).max(1024)).max(16),
    sourceId: z.string().min(1),
    upstreamPluginName: z.string().min(1).max(200),
    currentReleaseId: z.string().regex(/^release:[a-f0-9]{64}$/),
    availableReleases: z.array(PluginReleaseSchema).min(1).max(128),
    capabilitySummary: z.partialRecord(CapabilityTypeSchema, z.number().int().nonnegative()),
    harnessCompatibility: z.record(HarnessSchema, HarnessCompatibilitySchema),
    license: LicenseMetadataSchema,
    provenance: PluginProvenanceSchema,
    securityClassification: SecurityClassificationSchema,
  })
  .strict()

export const CatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogId: z.string().regex(/^catalog:[a-f0-9]{64}$/),
    generatedAt: TimestampSchema,
    sources: z.array(CatalogSourceSchema).min(1).max(64),
    plugins: z.array(PluginSchema).max(4096),
  })
  .strict()

export const SourceLockEntrySchema = z
  .object({
    sourceId: z.string().min(1),
    repositoryUrl: z.string().url(),
    defaultBranch: z.string().min(1),
    resolvedCommitSha: ShaSchema,
    manifestPath: z.string().min(1),
    marketplaceDialect: MarketplaceDialectSchema,
    sourceManifestDigest: DigestSchema,
    retrievedAt: TimestampSchema,
    synchronizationStatus: SyncStatusSchema,
    pluginPins: z
      .array(
        z
          .object({
            pluginName: z.string().min(1).max(200),
            repositoryUrl: z.string().url(),
            pluginSubdirectory: z.string().max(512),
            resolvedCommitSha: ShaSchema,
          })
          .strict()
      )
      .max(4096),
  })
  .strict()

export const SourcesLockSchema = z
  .object({
    schemaVersion: z.literal(1),
    lockId: z.string().regex(/^lock:[a-f0-9]{64}$/),
    sources: z.array(SourceLockEntrySchema).min(1).max(64),
  })
  .strict()

export const MaterializationPlanSchema = z
  .object({
    planVersion: z.literal(1),
    pluginId: PluginSchema.shape.pluginId,
    releaseId: PluginReleaseSchema.shape.releaseId,
    harness: HarnessSchema,
    source: z
      .object({
        repositoryUrl: z.string().url(),
        commitSha: ShaSchema,
        pluginSubdirectory: z.string().min(1),
        contentDigest: DigestSchema,
      })
      .strict(),
    targetLayout: z
      .object({
        root: z.string().min(1),
        notes: z.array(z.string().min(1)).max(32),
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            sourcePath: z.string().min(1),
            targetPath: z.string().min(1),
            action: z.enum(['copy', 'translate', 'ignore', 'unsupported']),
            reason: z.string().min(1).max(500),
          })
          .strict()
      )
      .max(4096),
    configuration: JsonObjectSchema,
    requiredConnectors: z.array(z.string().min(1)).max(128),
    requiredCredentials: z.array(z.string().min(1)).max(128),
    policyConstraints: z.array(z.string().min(1)).max(128),
  })
  .strict()

export type CatalogSource = z.output<typeof CatalogSourceSchema>
export type Capability = z.output<typeof CapabilitySchema>
export type HarnessCompatibility = z.output<typeof HarnessCompatibilitySchema>
export type LicenseMetadata = z.output<typeof LicenseMetadataSchema>
export type SecurityClassification = z.output<typeof SecurityClassificationSchema>
export type PluginProvenance = z.output<typeof PluginProvenanceSchema>
export type PluginRelease = z.output<typeof PluginReleaseSchema>
export type Plugin = z.output<typeof PluginSchema>
export type Catalog = z.output<typeof CatalogSchema>
export type SourceLockEntry = z.output<typeof SourceLockEntrySchema>
export type SourcesLock = z.output<typeof SourcesLockSchema>
export type MaterializationPlan = z.output<typeof MaterializationPlanSchema>

export function parseCatalog(input: unknown): Catalog {
  return CatalogSchema.parse(input)
}

export function parseSourcesLock(input: unknown): SourcesLock {
  return SourcesLockSchema.parse(input)
}
