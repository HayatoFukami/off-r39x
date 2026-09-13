# Repository Instructions

## Current State

- This revision is specification-only. The tracked project content is `docs/specs/` (21 Markdown specifications) plus `LICENSE`; there is no application source, `package.json`, lockfile, test configuration, CI workflow, formatter/linter configuration, or repository-local OpenCode config.
- No build, lint, typecheck, or test command is currently executable here. Do not invent commands or report the future pipeline described in `SPEC-180` as having run.
- `SPEC-010`, `SPEC-180`, and `SPEC-190` describe the planned TypeScript/pnpm monorepo and deployment layout; their `apps/`, `packages/`, `tests/`, and `scripts/` paths do not exist yet.
- All 21 current specifications are `provisional` version `1.0.0`. Treat `reviews/specification-review/`, when present, as generated review evidence rather than canonical specification.

## Specification Source Of Truth

- Read `docs/specs/000-specification-governance.md` before editing a specification or starting implementation. It defines source priority, dependencies, Canonical Owners, frontmatter, versioning, and Upstream Change Requests (UCRs).
- For an implementation task, read `SPEC-000`, the target behavior's Canonical Owner, that owner's `depends_on`, and any explicitly named specifications. Use `SPEC-NNN` identifiers when cross-referencing; do not duplicate another specification's detailed rules.
- Formal specification filenames use `NNN-kebab-case-name.md` and frontmatter must retain `spec_id`, English `title`, semver `version`, `status`, `depends_on`, and `related_specs`. A feature task must not rewrite specifications unless it explicitly includes a specification revision.
- Never resolve a specification conflict silently. Record the required change in the affected specification using the UCR format from `SPEC-000` and keep implementation aligned with the current canonical text.
- The unresolved UCRs are `UCR-130-001` through `UCR-130-006`, `UCR-150-001` through `UCR-150-002`, and `UCR-170-001`. They are not implementation contracts: do not copy their proposed endpoints, capabilities, operation IDs, indexes, or recovery commands into code.
- Before implementing the affected flows, canonicalize capability semantics in `SPEC-060`, handoff semantics in `SPEC-130`, and API, operation-ID, and recovery contracts in `SPEC-110`, then propagate the accepted contracts to dependent specifications and tests.

## Non-Negotiable Boundaries

- Business data flows `Browser -> Next.js Web -> Hono API -> Supabase PostgreSQL`; Browser and Next.js must not access the Business Database directly. Hono is the business mutation and authorization boundary.
- Supabase Auth is the identity authority, while PostgreSQL is the business system of record. Verify authentication, ownership, and capabilities server-side; client-supplied IDs, roles, prices, and payment results are never authority.
- Confirm payment from a verified Stripe Webhook/provider authority, not a browser success redirect. Keep external provider calls outside database transactions and reconcile unknown outcomes using the same business cause/provider key rather than blind retries.
- Do not expose secrets or raw QR values to client bundles, logs, traces, snapshots, screenshots, fixtures, or test artifacts. Entry and Karaoke QR purposes remain separate and check-in must be atomic and single-use.
- Do not add new domain states, APIs, capabilities, schema, or recovery behavior merely because implementation appears to require them; revise the owning specification first.

## Verification When Code Exists

- Follow `SPEC-190`'s workflow: classify the change, identify Canonical Owner and Rule IDs, check UCR status, add a failing/coverage test, make the smallest compliant change, run focused and affected suites, then run static, security, traceability, and diff checks.
- `SPEC-170` requires real PostgreSQL semantics for constraints, transactions, locks, and concurrency; provider contract tests use non-production credentials/data. Critical tests are not replaced by unit mocks, retries, or quarantine.
- The planned build order in `SPEC-180` is `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, applicable `SPEC-170` gates, then `pnpm build`; use it only after executable manifests/scripts exist and verify the actual scripts first.
- Completion reports should follow the fixed evidence headings in `SPEC-190` (changed scope, rules, files, migrations, tests/groups, security/reliability, traceability, UCRs, and verification exceptions). Never claim an unrun check passed.

## Additional Agent Instructions

### Specification Maintenance

- Every new feature must be documented in the project's specification or in relevant project documentation.
- Changes to user-visible behavior, public interfaces, system behavior, explicitly defined requirements, or any other behavior governed by the project's specification must be treated as specification changes.
- Purely internal implementation changes that do not alter specified behavior do not require a specification change unless the existing project rules require one.
- When a task introduces a specification change, update the specification before making any corresponding changes to the codebase.
- Specification changes must precede implementation changes.
- When multiple agents are involved, implementation work that depends on a changed specification must use the updated specification as the source of truth.

### Git Commit Policy

- Make commits frequently and keep them granular.
- Create separate commits at meaningful feature, fix, refactor, documentation, or other logical work-unit boundaries.
- Prefer multiple small, focused commits over one large commit containing unrelated or loosely related changes.
- Each commit must contain only changes belonging to its intended logical work unit.
- Commit only changes that belong to the current task.
- Never stage or commit unrelated, pre-existing, or user-authored uncommitted changes unless the user explicitly instructs you to include them.
- Before creating a commit, inspect the relevant Git diff and ensure that unrelated changes are not included.
- Before reporting that the requested work is complete, ensure that all completed work belonging to the current task has been committed.
- Do not send a final completion report while completed task changes remain uncommitted.

### Git Ownership in Multi-Agent Workflows

- Git operations must have a clear owner when multiple agents or sub-agents are working on the same task.
- Only the agent responsible for Git operations in the current workflow may create commits in the shared working tree.
- Sub-agents must not create commits unless the orchestrating agent explicitly instructs them to do so.
- An exception is permitted when a sub-agent has been assigned an isolated Git worktree or equivalent isolated workspace and committing is explicitly part of that sub-agent's assigned responsibility.
- Agents must not independently create overlapping or competing commits from the same shared working tree.
- The orchestrating agent is responsible for ensuring that completed work is integrated and committed appropriately before reporting overall task completion.

### Commit Failure or Unsafe Repository State

- Never claim that a task is complete if a required commit has not succeeded.
- If a required commit cannot be completed safely because of repository state, merge conflicts, permissions, hooks, signing requirements, unavailable Git configuration, unrelated working-tree changes, or another external constraint, do not force the commit or modify unrelated work to make it succeed.
- Preserve the user's existing work and repository state whenever possible.
- Report the task as incomplete or blocked and clearly explain the blocking condition to the user in Japanese.
- A failure to commit must not prevent reporting the failure itself; it only prevents claiming successful completion.

### Conflict Between Existing Specifications and User Instructions

- If the existing specification conflicts with the user's current prompt or instructions, the user's current instructions take precedence.
- Treat the user's instructions as a specification change when they clearly request behavior or requirements that differ from the existing specification.
- Do not stop the work merely because such a discrepancy exists.
- Continue the work according to the user's current instructions.
- Where necessary, update the specification first so that it reflects the user's requested changes before modifying the codebase.
- Do not silently preserve outdated specification behavior when the user's current instructions explicitly supersede it.
- Inform the user that the previous specification and the user's current instructions differed.
- If multiple specification differences or changes are discovered during the task, do not report them individually as they are found unless immediate user attention is required for safety or to proceed.
- First identify and compare all relevant specification differences, then report them together in a single consolidated explanation.

### Language Used in Agent-User Communication

- All content that the user is expected or required to read must be written in Japanese.
- This rule applies specifically to communication between the development agent and the user during the development process, including progress updates, questions, warnings, explanations, blocked-state reports, completion reports, and other user-facing messages.
- This communication-language rule must not alter or impose language requirements on the product being developed.
- The product's own UI, source code, documentation, localization, generated assets, tests, APIs, and other language choices must continue to follow the project's requirements and specifications.
- Content that the user does not need to read may use languages other than Japanese when doing so is more appropriate or improves quality.
- Internal agent instructions, reasoning artifacts, implementation notes not shown to the user, and instructions to sub-agents may use English or another language when that is more effective.
- In particular, instructions to sub-agents do not need to be written in Japanese if another language is expected to produce higher-quality results.
