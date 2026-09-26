# Catalog contract

The contract is versioned independently from the marketplace dialects. Zod
schemas in `packages/plugins/src/schema.ts` are the runtime source of truth; the JSON
schemas in `schemas/` are language-neutral validation references.

Stable identities have two levels:

- `plugin:<source-id>:<normalized-upstream-name>` keeps OpenAI Gmail and Cursor
  Gmail distinct while allowing a shared `productGroupingKey`.
- `release:<sha256>` is derived from canonical repository URL, plugin
  subdirectory, resolved commit, and canonical content digest.

Exact release duplicates require all of canonical repository URL, subdirectory,
and content digest to match. Arrays are sorted at publication boundaries and
object keys are canonicalized for digests.

`sources.lock.json` records a pin for every marketplace entry, including the
resolved repository URL, plugin subdirectory, and commit SHA. A lock replay
must use those plugin pins and must not resolve a mutable upstream ref again.

`Capability` preserves normalized type, source-relative paths, metadata, and a
security impact. Supported types are skill, MCP server, connector, command,
agent, hook, rule, browser, scheduled task, UI component, executable, and
unknown.

`HarnessCompatibility` is descriptive, not an execution grant. It reports the
status, human-readable reason, and responsible capability types. A plan from
`materialize-plan` contains intended file actions and policy requirements only;
it never copies files or starts a process.
