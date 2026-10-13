# Agent instructions: plugins

This is the deterministic Bun/TypeScript marketplace compiler, not a plugin
runtime. It produces catalogs, canonical packages and installation plans from
pinned source snapshots; consumers own installation and execution.

## Navigation

- [README.md](README.md): CLI usage and offline/live catalog flows.
- [docs/agent-plugins.md](docs/agent-plugins.md): Agent Plugins 1.0 and v2 plans.
- [docs/consumer-contract.md](docs/consumer-contract.md): consumer artifacts and
  publication contract; [docs/generated-artifacts.md](docs/generated-artifacts.md)
  explains generated snapshots.
- [packages/plugins](packages/plugins): compiler, schemas, adapters and tests.
- [packages/cli/src/index.ts](packages/cli/src/index.ts): CLI entry point.
- [fixtures](fixtures): upstream examples and expected offline snapshots.
  Fixture `SKILL.md` files are compiler input, not instructions for this checkout.
- [scripts](scripts): schema, publication and catalog-branch verification.

## Working drafts

Before editing, read the nearest README, manifest and tests plus any nested
`AGENTS.md` for the affected directory. Preserve unrelated checkout changes.
This file's draft-WIP sequence refines the generic contribution sequence for
authorized agent work; explicit user instructions take precedence.

For authorized repository work, proceed with ordinary edits, checks, commits and
draft pushes without repeated confirmation. Use checked-in conventions for
routine choices; ask only when a consequential decision or authority is missing.

- Branch from current `main`. Reuse a suitable focused draft PR, or open one;
  keep working on that branch throughout the task.
- Commit and push WIP during work and before stopping or handing off. Incomplete
  work and failing checks do not block draft pushes; record results and gaps.
- Verify the remote head before and after pushing. Preserve another contributor's
  changes; use a separate handoff branch when needed instead of force-pushing.
- Keep auto-merge off while pushing unreviewed work. Review and applicable passing
  checks gate readiness and merge, rather than WIP publication.

## Commands and validation

Run from the repository root. [package.json](package.json) pins Bun 1.4.0 and
Node 24.x; [bun.lock](bun.lock) is the dependency lock. There is no local mise
configuration. The checked-in Marketplace CI workflow also selects Bun 1.4.0.

```sh
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run type-check
bun run test
bun run build
bun run schema:check
bun run verify:integrity
```

Tests live beside compiler/CLI source. For focused work, use
`bun test packages/plugins/src/agent-plugins-schema.test.ts --timeout 30000`,
then select the other tests relevant to the change. For docs-only edits, verify local links and command names, check Markdown
formatting, and run `git diff --check`.

Use an explicit temporary output when checking fixture generation, as in the
README, so it can be compared without replacing the live `generated/` snapshot:

```sh
bun run catalog sync --offline --fixture-root fixtures --output /tmp/adea-fixture-catalog
bun run catalog validate --output /tmp/adea-fixture-catalog --require-portable
bun run catalog verify-integrity --output /tmp/adea-fixture-catalog
```

[Marketplace CI](.github/workflows/marketplace-ci.yml) checks schema, integrity,
fixture consistency and canonical determinism. The separate
[sync workflow](.github/workflows/marketplace-sync.yml) owns live catalogs and
catalog-asset publication; [package publication](.github/workflows/publish-packages.yml)
is another distinct workflow. A fixture result is not a live publication result.

## Code Foundry and contribution guidance

[`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) retains the baseline
contribution, review, security and release guidance. Configuration and workflow
pins live in [`.github/code-foundry.yml`](.github/code-foundry.yml); overlay and
custom-workflow behavior is explained in [docs/EXTENSIONS.md](docs/EXTENSIONS.md).
The generated hook is [`.githooks/pre-commit`](.githooks/pre-commit).

Use Conventional Commits. The configured workflow targets `main` with squash
merges, including Release Please version PRs. Ordinary PRs start as drafts;
Release Please owns its version PR state. Check the relevant workflow rather
than assuming all drafts or change types run the same CI lanes.

Use Bun's native test runner for unit/integration tests rather than introducing
Vitest. Add focused regression coverage for behavior changes; keep the configured
coverage thresholds in `.github/code-foundry.yml`. Report unavailable checks as
skipped, not passed. A passing pre-commit hook is not full validation: its
change-aware gate formats/lints staged files, typechecks typed-source/config
changes and builds only when `pre_commit_build` enables it.

For CI edits, preserve canonical job/gate names and configured action/runtime
pins. Cancel superseded PR runs, while main/release/publication runs queue;
keep `always()` on lightweight aggregate gates rather than heavy jobs. Keep
validation, security and release concerns distinct. Optional checks depend on
repository visibility and plan support; retain their existing enablement rules.
The configuration controls dependency caches and optional Turbo remote caching;
cache dependency downloads, not credentials, `node_modules` or unmeasured broad
build output. Update the corresponding required-check configuration when job
names change.

## Handoff

Report changed files, exact check commands/results, skipped checks and remaining
work, plus the branch, PR link and verified remote SHA. Distinguish draft WIP
from reviewed work ready for the next gate.
