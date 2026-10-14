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
- Keep auto-merge off while pushing unreviewed work. Personal review of the exact
  head gates readiness; mark reviewed drafts ready to trigger CI. Applicable
  passing checks and protections gate merge, rather than WIP publication.

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

## Handoff

Report changed files, exact check commands/results, skipped checks and remaining
work, plus the branch, PR link and verified remote SHA. Distinguish draft WIP
from reviewed work ready for the next gate.

## Relationship to the managed baseline

The managed core below matches the official [Code Foundry v1.47.3 release](https://github.com/0xPlayerOne/code-foundry/tree/v1.47.3).
Refresh the generated core from the latest official release first, then
personalize outside its managed blocks. For an AGENTS-only update, preview sync
in a disposable checkout and retain only the generated AGENTS.md core.

The working-draft workflow above takes precedence for authorized agent work:
publish WIP to the same draft during the task and before handoff. Personal review
of the exact head gates readiness; mark reviewed drafts ready to trigger CI.
Applicable passing checks and protections gate merge. Repository-specific commands
above apply to this checkout instead of generic examples for other stacks.

# Agent Instructions

<!-- code-foundry-managed: config-aware-policy -->

These instructions are the repository-level operating contract for coding agents, including Hermes, OpenCode, and other automation.

They complement `CONTRIBUTING.md`. More specific instructions in nested `AGENTS.md` files and project documentation take precedence for their directory.

<!-- /code-foundry-managed: config-aware-policy -->

<!-- code-foundry-managed: mission -->

## Mission

- Keep formatting, linting, type checking, builds, tests, and coverage reproducible locally and in CI.
- Prefer the repository's configured toolchain; `toolchain: auto` uses native
  tools unless an existing `.mise.toml` is present.
- Do not commit secrets, generated credentials, local environment files, or machine-specific paths.
- Add tests for behavior changes and keep coverage thresholds explicit in the project configuration.
- Make the smallest complete, well-tested change that solves the requested problem without disturbing unrelated work.

This repository may contain TypeScript, Rust, Python, or any combination of them. Detect the active stack from the files present; do not assume every check applies.

<!-- /code-foundry-managed: mission -->

<!-- code-foundry-managed: contributing-back -->

## Contributing back

Consumers are encouraged to help improve this open-source project. Open a small,
focused pull request for bug fixes, performance improvements, documentation, or
other narrowly scoped changes. For larger feature requests or architectural
changes, create an issue first so the proposal can be discussed and scoped.
Contributions should help make the tool as performant, reliable, and helpful as
possible for everyone.

<!-- /code-foundry-managed: contributing-back -->

<!-- code-foundry-managed: read-before-acting -->

## Read before acting

Before editing:

1. Read this file and `.github/CONTRIBUTING.md`.
2. Find and read any nested `AGENTS.md` that covers the files you will touch.
3. Read the nearest README, package manifest, build configuration, and relevant tests.
4. Inspect the current branch, worktree, remotes, and recent history:

   ```sh
   git status --short --branch
   git remote -v
   git log -5 --oneline
   ```

5. Identify the repository's package manager, lockfile, runtime versions, test commands, deployment assumptions, and generated files.

If the worktree is dirty, preserve existing changes and avoid overlapping edits until their ownership is clear.

<!-- /code-foundry-managed: read-before-acting -->

<!-- code-foundry-managed: priorities -->

## Priorities

When instructions conflict, use this order:

1. System and user instructions
2. This repository's instructions and explicit task scope
3. Nested directory instructions
4. Existing project conventions
5. General best practices

Ask for clarification when a missing decision would materially change the implementation. Otherwise make the smallest reasonable assumption and document it.

<!-- /code-foundry-managed: priorities -->

<!-- code-foundry-managed: safety-boundaries -->

## Safety boundaries

- Do not discard, reset, overwrite, or rewrite user-owned changes.
- Do not expose or commit secrets, credentials, tokens, private keys, local environment files, or personal machine paths.
- Do not modify production resources, repository settings, branch protections, secrets, deployments, or external systems unless explicitly requested.
- Do not add organization- or product-specific details to this reusable baseline.
- Do not change dependency managers or lockfiles unnecessarily.
- Do not bypass hooks, tests, review requirements, or required checks to hide a failure.
- Do not claim completion while required validation, review, deployment, or user decisions remain pending.
- Publishing, committing, or opening a pull request requires explicit task scope or user authorization.

<!-- /code-foundry-managed: safety-boundaries -->

<!-- code-foundry-managed: standard-workflow -->

## Standard workflow

1. Restate the desired outcome and identify the files or systems in scope.
2. Inspect before editing; preserve unrelated work.
3. Plan the smallest coherent change.
4. Implement with existing project patterns.
5. Run `npx code-foundry init` for a new checkout, or `npx code-foundry doctor` to diagnose setup drift.
6. Run focused checks while iterating.
7. Inspect the final diff for accidental changes, secrets, formatting, and generated files.
8. Run the broadest applicable validation available.
9. Report what changed, exact checks and results, skipped checks with reasons, risks, and remaining work.

For normal feature work, branch from `main` and target pull requests at `main`. Treat `main` as the protected release branch. Follow `.github/CONTRIBUTING.md` for the complete internal and external contribution flow.

<!-- /code-foundry-managed: standard-workflow -->

<!-- code-foundry-managed: git-workflow-and-merging -->

## Git workflow and merging

This repository uses the `direct` workflow: topic branches **squash** directly into `main`, and the Release Please version PR **squashes** into `main` (`release_merge_strategy: squash`). Feature and release PRs land on `main` with squash merges. No integration branch exists; all pull requests target `main`.

Merge only with the repository's canonical method. Never merge with `--admin`, never default or auto-select a merge method, and never use a method the branch ruleset does not allow. When in doubt, prefer the merge button's configured method and verify the ruleset after merging. Check `.github/CONTRIBUTING.md` for the complete flow and merge table.

### Branch and commit policy

Branch rulesets enforce deletions, force-pushes, required status checks, pull
requests, conversation resolution, and linear history where the repository's
plan supports them. Mirror those rules even where the plan cannot enforce
them:

- Branch from the default branch using
  `feat/*`, `fix/*`, `chore/*`, `refactor/*`, `docs/*`, or `test/*` names.
- Never push directly to protected branches; open a pull request.
- Use Conventional Commit subjects (`feat:`, `fix:`, `chore:`, …); Release
  Please depends on them to version releases.
- Keep pull requests focused; merge with the canonical method only after
  required checks pass.

<!-- /code-foundry-managed: git-workflow-and-merging -->

<!-- code-foundry-managed: pull-request-policy -->

## Code Foundry workflow policy (mandatory)

This repository uses the `direct` workflow. Topic pull requests target `main`.

- Open every ordinary pull request as a draft. Use `gh pr create --draft` or
  set `draft: true` in the GitHub API; never create a ready ordinary pull
  request as a shortcut.
- Keep ordinary pull requests in draft while preparing them. The generated
  Draft Guard converts ready ordinary pull requests to draft when they are
  opened or reopened, and runner-heavy validation starts only after an
  explicit `ready_for_review` transition unless `draft_protection: false` is
  configured for generated callers. That opt-out does not disable Draft Guard
  or draft-PR automation. Cloudflare reusable callers use
  `draft-protection: false`.
- Run local validation and finish review preparation before marking an ordinary
  pull request ready. Ready pull requests stay ready when new commits arrive,
  and validation reruns for the current head; draft updates allocate no
  validation runner until the pull request is ready.
- This contract is mandatory for every agent scope. Nested `AGENTS.md` files
  may add stricter rules but must not weaken or replace it.
- Release Please version pull requests are managed by the Code Foundry release
  workflow; do not manually change their draft state unless the workflow asks.

<!-- /code-foundry-managed: pull-request-policy -->

<!-- code-foundry-managed: toolchain-and-dependencies -->

## Toolchain and dependencies

- Follow `toolchain: auto` in `.github/code-foundry.yml`; use native tools by
  default and reuse mise only when the repository already has `.mise.toml`.
- If `toolchain: mise` is selected, run `mise install` before validation.
- Use the package manager indicated by the existing lockfile:
  - `bun.lock` or `bun.lockb` → Bun
  - `pnpm-lock.yaml` → pnpm
  - `yarn.lock` → Yarn
  - `package-lock.json` → npm
- Use the existing Python environment and dependency manifest. Prefer a project-managed virtual environment.
- Use Cargo commands and the committed Cargo lockfile for Rust projects.
- Do not mix package managers or regenerate lockfiles as a side effect.
- Keep dependency additions narrowly scoped and explain security, licensing, and runtime impact.

<!-- /code-foundry-managed: toolchain-and-dependencies -->

<!-- code-foundry-managed: validation -->

## Validation

Use the shared scripts when present. They detect supported tools and skip inapplicable checks:

```sh
node src/runtime.mjs ci format
node src/runtime.mjs ci lint
node src/runtime.mjs ci type_check
node src/runtime.mjs ci build
node src/runtime.mjs ci unit
node src/runtime.mjs ci integration
node src/runtime.mjs ci e2e
node src/runtime.mjs ci smoke
node src/runtime.mjs ci eval
node src/runtime.mjs ci performance
Security and dependency audits run through the GitHub Security workflow.
```

Run focused tests first, then the complete applicable set for release, security, workflow, dependency, and configuration changes.

At minimum:

- TypeScript/JavaScript: Oxfmt formatting, Oxlint linting, type-check, build, and Bun's native test runner for unit/integration tests; use the project's native browser runner for E2E tests. Repositories using a different linter or formatter keep full control through their own `lint`/`format` scripts, which the runtime honors.
- Do not add Vitest. Preserve specialized native runners such as Matchstick for The Graph and Hardhat for smart contracts.
- Rust: default rustfmt, Clippy with warnings treated as errors, check, unit/integration tests, and dependency audit
- Python: Ruff formatting and linting, compile or type checks, pytest, coverage, and dependency audit
- Mixed projects: validate each active ecosystem and its integration boundaries

If a check cannot run, state the exact reason. A skipped check is not a passing check.

The generated `.githooks/pre-commit` gate is change-aware so parallel work on a
shared checkout is not serialized behind repository-wide checks. It blocks
whitespace errors, formats and lints only staged files, runs the project's
type-check command only when typed sources or compiler configuration are
staged, and does not build unless `pre_commit_build: true` is set. Passing the
hook is not full validation: run the broader checks above before opening or
readying a pull request.

<!-- /code-foundry-managed: validation -->

<!-- code-foundry-managed: tests-and-coverage -->

## Tests and coverage

- Add or update tests for behavior changes and regressions.
- Keep unit, performance, integration, E2E, and smoke coverage in the suite where each applies.
- Preserve project-specific coverage thresholds; do not lower them to make CI green.
- Keep test data deterministic and remove secrets from logs and fixtures.
- Use the narrowest test command while iterating, then run the affected package or workspace suite.

<!-- /code-foundry-managed: tests-and-coverage -->

<!-- code-foundry-managed: github-workflows-and-configuration -->

## GitHub workflows and configuration

- Keep workflows concise, independently runnable, and safe to re-run.
- Use `push` for `main` and `pull_request` for `main` unless a workflow has a documented event-specific reason.
- Give workflows clear names and jobs concise names; avoid repeating the workflow name in the job name.
- Use per-workflow concurrency groups keyed by pull request or ref that cancel superseded pull-request runs while allowing independent workflows to run in parallel. Do not cancel in progress for pushes to `main`, release, publication, or deployment runs; let them queue.
- Do not put `always()` on heavy jobs: it keeps a cancelled run alive and holding its concurrency group. Use `!cancelled()` for jobs that must run after upstream failures, and keep `always()` for lightweight aggregate gates only.
- Keep setup language-aware and cache dependency downloads by lockfile; do not cache secrets, `node_modules`, virtual environments, or broad build output without a measured reason.
- Use least-privilege permissions and pin action versions consistently with the template.
- Keep CI, Test, Security, CodeQL, Draft Guard, Draft PR, Release PR, and Release concerns separated.
- Security and CodeQL may skip when repository visibility or GitHub plan support does not permit them. Do not make an unavailable check required.
- Optional Turborepo Remote Caching uses `TURBO_TOKEN` and `TURBO_TEAM`; do not add Vercel deployment behavior just to enable caching.
- Update branch protection when adding or renaming required job checks; verify the actual GitHub status context.

<!-- /code-foundry-managed: github-workflows-and-configuration -->

<!-- code-foundry-managed: documentation-and-generated-files -->

## Documentation and generated files

- Update documentation when behavior, setup, configuration, commands, or operational procedures change.
- Keep `.env.example` limited to variable names and safe placeholders.
- Do not commit build output, caches, coverage output, dependency directories, generated credentials, or temporary files.
- Preserve formatting and line-ending conventions from `.editorconfig` and `.gitattributes`.

<!-- /code-foundry-managed: documentation-and-generated-files -->

<!-- code-foundry-managed: completion-report -->

## Completion report

End every agent task with:

```text
Summary:
Files changed:
Validation:
Skipped checks:
Risks or follow-up:
Branch/PR:
```

Use exact command names and outcomes. Mention external changes separately from local changes, and distinguish completed work from recommendations.

<!-- /code-foundry-managed: completion-report -->
