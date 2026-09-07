# @adea-ai/harness-adapters

Harness materialization for AI agent plugin marketplaces: turn a validated
catalog plugin into a per-harness installation plan for **Codex, Claude
Code, Cursor, Pi, Hermes, OpenCode**, and generic skill/MCP targets.

A materialization plan is a deterministic, reviewable translation of "this
plugin, for this harness" — files to write, compatibility status, and policy
blocks. It never installs or executes anything.

## What's inside

- **Materialization plans** — `createMaterializationPlan` compiles a plugin
  release for one harness into a typed plan.
- **Compatibility status** — `native`, `portable`, `requires-translation`,
  `partially-supported`, `unsupported`, `blocked-by-policy`.
- **Policy gates** — plan generation refuses unsupported or policy-blocked
  combinations with structured error codes (`PLUGIN_NOT_FOUND`, …).

## Install

```sh
bun add @adea-ai/harness-adapters
```

## Usage

```ts
import { createMaterializationPlan } from '@adea-ai/harness-adapters'

const plan = createMaterializationPlan({ catalog, pluginId, harness: 'codex' })
```

## License

Apache-2.0
