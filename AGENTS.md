# AGENTS.md

This document defines the project-specific development requirements for **off r39'x in 大阪らへん2027**.

It applies regardless of the AI agent, development tool, or workflow used.

Agent-specific behavior, subagent orchestration, parallel execution, communication preferences, and general development practices are outside the scope of this document and belong in each developer's global configuration.

Official specifications are the canonical source of truth for business rules, APIs, database schemas, coding conventions, and testing contracts. This document references those specifications without replacing or duplicating them.

## 1. Project Overview

### 1.1 Product Language

The primary language of the product is **Japanese**.

Product-facing content must follow the language and localization requirements defined in the official specifications.

### 1.2 Repository Structure

Official specifications are maintained in `docs/specs/` (`SPEC-000` through `SPEC-200`). Licensing is governed by `LICENSE`.

Other relevant paths include:

| Path | Purpose |
|---|---|
| `apps/` | Applications |
| `packages/` | Shared packages |
| `tests/` | Tests |
| `scripts/` | Development and validation scripts |
| `traceability/` | Specification-to-code traceability |
| `docs/drafts/` | Non-canonical working documents |
| `reviews/specification-review/` | Generated review evidence |

Directory requirements are defined in `SPEC-010`, `SPEC-180`, and `SPEC-190`.

Do not assume that any directory, file, script, configuration, or implementation already exists. Verify the actual repository state before working. Create missing directories only when required and in accordance with `SPEC-190 §6`.

Files such as `CLAUDE.md`, `.claude/agents/**`, draft documents, and generated review artifacts are not official specifications.

## 2. Specification Governance

### 2.1 Canonical Authority

`SPEC-000` governs specification management, including Canonical Owners, dependencies, frontmatter, versioning, and Upstream Change Requests (UCRs).

Follow the precedence rules in `SPEC-000 §8`.

For project requirements, official specifications take precedence over this document, existing code behavior, and non-canonical documents.

The user's latest explicit instructions take precedence when requesting a specification change. Such changes must follow Section 6 of this document.

Never silently resolve specification conflicts or promote existing implementation behavior into an official requirement.

### 2.2 Specification References

Follow the reading order defined in `SPEC-000 §21`:

1. `SPEC-000`
2. The target feature's Canonical Owner specification
3. Specifications listed in its `depends_on`
4. Additional specifications explicitly requested by the user

Use `SPEC-190 §33` to determine required specifications for each change category. Do not read every specification unconditionally.

Reference specifications using their `SPEC-NNN` identifiers rather than duplicating their requirements.

Specification filenames follow `NNN-kebab-case-name.md`.

Preserve the following frontmatter fields:

- `spec_id`
- `title` (English)
- `version` (SemVer)
- `status`
- `depends_on`
- `related_specs`

Each specification maintains its own version.

### 2.3 UCR Management

Follow `SPEC-000` and `DEV-GEN-001`.

- Determine UCR status from the current Canonical Owner specification, not historical commits.
- Unincorporated UCRs are not implementation contracts.
- Do not implement endpoints, Capabilities, Operation IDs, states, indexes, recovery commands, or other behavior based solely on UCR proposals.
- A UCR becomes implementation authority only after incorporation into the official Canonical Owner specification.

`UCR-130-005` is known as `DEFERRED_NONBLOCKING`, pending actual query plans, selectivity, and data characteristics. Do not proactively add its proposed indexes. Always verify its current status before relying on this information.

Relevant Canonical Owners:

| Responsibility | Specification |
|---|---|
| Capability semantics | `SPEC-060` |
| API, Operation IDs, recovery contracts | `SPEC-110` |
| Notification recovery | `SPEC-120` |
| Handoff and administrative operations | `SPEC-130` |

## 3. Architecture and Security

### 3.1 System Architecture

The required data flow is:

```text
Browser → Next.js Web → Hono API → Supabase PostgreSQL
```

Enforce these boundaries:

- Browser and Next.js Web must not directly access the Business Database.
- Hono API is the boundary for business mutations and authorization.
- Supabase Auth is the authentication authority.
- PostgreSQL is the system of record for business data.
- Ownership, Capabilities, and authorization must be validated server-side.
- Client-provided IDs, roles, prices, payment results, and other business-critical values are not authoritative.
- Do not introduce dependencies between layers that violate official specifications.

### 3.2 Payments and External Providers

- Confirm payments only through verified Stripe Webhooks or the applicable provider authority.
- Never treat a browser success redirect as payment confirmation.
- Keep external provider calls outside database transactions.
- When provider outcomes are uncertain, reconcile using the same business cause and provider key instead of blindly retrying.
- Follow the relevant specifications for idempotency, recovery, and provider contracts.

### 3.3 Confidential Information

Never expose secrets, raw QR data, session credentials, raw webhook bodies, unnecessary PII, or other confidential information in:

- Client bundles or source code
- Fixtures or test artifacts
- Logs, traces, or snapshots
- Screenshots
- Development or validation reports

Follow the applicable Canonical Owner specifications for detailed handling requirements.

### 3.4 QR and Check-in

- Keep Entry and Karaoke QR purposes separate.
- Check-in must remain atomic and single-use.
- Do not introduce unauthorized QR reuse, purpose merging, or authentication and authorization bypasses.

## 4. Implementation Requirements

All implementations must comply with the applicable official specifications, particularly `SPEC-190 §44`.

The following are prohibited:

- Silently modifying official specifications or resolving their conflicts.
- Treating existing code behavior as authoritative over specifications (`DEV-GEN-005`, `DEV-GEN-006`).
- Weakening specification requirements without authorization.
- Adding undefined states, APIs, Capabilities, database schemas, recovery behavior, or business exceptions (`DEV-AI-002`).
- Implementing unincorporated UCR proposals.
- Introducing unrelated functionality or unnecessary refactoring.

Implementation changes must remain within the scope of the user's request and the applicable specifications.

The project development and validation process must comply with all applicable requirements of `SPEC-190 §35`, including scope analysis, rule identification, implementation boundaries, test-first development, validation, traceability, and review.

This document does not prescribe which agents or tools perform these activities.

Implementation designs must identify, as applicable:

- Task scope and change classification
- Canonical Owners and Rule IDs
- Canonical status and UCR dependencies
- Existing code, tests, and migrations
- Implementation boundaries and dependencies
- Interfaces, data flow, states, and transaction boundaries
- Error handling and test requirements
- Open issues

Use `SPEC-190 §33` for change classification and required specification references.

Follow `DEV-AI-003` when reasonably resolving gaps limited to repository structure or development procedures governed by `SPEC-190`. Record such decisions and their rationale under `Open issues` or equivalent design documentation.

## 5. Testing and Validation

The authoritative testing requirements are defined in:

- `SPEC-170` — Testing contracts
- `SPEC-180` — Build and validation pipeline
- `SPEC-190` — Development and validation requirements

### 5.1 Testing Rules

- Follow the Test Case contract in `SPEC-170 §9`.
- Follow the test creation order in `SPEC-170 §81`.
- Do not change expected results to accommodate implementation behavior that contradicts specifications.
- Do not use retries, skips, or quarantine to conceal Critical Test failures (`SPEC-170 §69–70`).
- Do not substitute unit mocks for tests requiring real database constraints, transactions, locks, or concurrency behavior.
- Use non-production credentials and data for provider contract tests.
- Follow `SPEC-190 §33` for required test groups, `§37` for validation requirements, and `§38` for self-review.
- Apply relevant Critical, Concurrency, and Fault Injection testing requirements.

### 5.2 Traceability

Maintain specification-to-test and specification-to-code traceability through:

- `tests/traceability/test-manifest.json`
- `traceability/rule-code-map.json`

Preserve applicable Test Case IDs, Rule IDs, test levels, expected results, and traceability contracts defined in `SPEC-170` and `SPEC-190`.

### 5.3 Build and Validation

The standard pipeline defined in `SPEC-180` is:

```text
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
[Applicable SPEC-170 gates]
pnpm build
```

Verify that each required script and configuration exists before execution. Do not invent commands or report unavailable validation steps as completed.

If UI mocks exist, follow `SPEC-190` requirements `DEV-WEB-010` through `DEV-WEB-013`.

If tests cannot be executed, record the unexecuted items, specific reasons, and release impact.

Never report unexecuted validation as passed (`DEV-AI-005`).

### 5.4 Completion Evidence

Completion evidence must satisfy `SPEC-190 §39` and `DEV-AI-004`.

Include, where applicable:

- Change scope and corresponding Rule IDs
- Modified files and migrations
- Executed commands, tests, and test groups
- Security and reliability validation
- Traceability updates
- UCR status and impact
- Unexecuted validation and exceptions

Statements such as "done" or "tests pass" alone are insufficient.

## 6. Specification Changes and Conflicts

### 6.1 User-Requested Changes

When the user's latest explicit instructions conflict with existing specifications:

1. Prioritize the user's requested requirements.
2. Identify all affected specifications and Canonical Owners.
3. Apply the necessary specification changes before modifying implementation code.
4. Follow `SPEC-000` for frontmatter, SemVer, dependencies, related specifications, Rule IDs, and UCR procedures.
5. Implement against the updated official specifications.
6. Report the differences between previous specifications and the user's instructions, including their impact.

Do not stop solely because the user's requested behavior differs from existing specifications.

When multiple differences exist, consolidate them into one report where practical, unless safety or an immediate user decision requires otherwise.

### 6.2 When Specification Updates Are Required

Document new functionality in the relevant project specifications or related documentation.

Treat changes to user-visible behavior, public interfaces, system behavior, explicit requirements, or other specification-governed behavior as specification changes.

Purely internal changes that preserve specified behavior do not require specification revisions unless project rules explicitly require them.

Do not unnecessarily rewrite specifications for tasks already covered by existing requirements.

Specification changes must be finalized and committed before their corresponding implementation changes.

### 6.3 Unresolved Conflicts and Gaps

Stop the affected work and report the issue when:

- Official specifications contradict each other.
- A requested implementation requires undefined states, APIs, Capabilities, database schemas, or recovery behavior.
- Code conflicts with official specifications and a specification change appears necessary.
- Implementation depends on a deferred or unincorporated UCR.

These conditions apply when the issue is not already addressed by an explicit user-requested specification change.

For required upstream changes:

1. Prepare a UCR proposal following `SPEC-000 §15.2`.
2. Identify the conflicting requirements, proposed changes, affected specifications, and required decisions.
3. Obtain the user's decision.
4. Record the UCR in the appropriate Canonical Owner specification according to `SPEC-000`.
5. Do not implement the proposed behavior until the UCR is incorporated into the official specification body.

Until incorporation, existing official specifications remain authoritative.

Exceptions for repository structure and development procedures are limited to `DEV-AI-003` and must not authorize undefined business behavior.

## 7. Git and Branch Policy

### 7.1 Development Branch

The standard development branch is `dev`.

Perform development work and commits on `dev` unless the user explicitly specifies another working branch.

### 7.2 Main Branch

`main` is the integration branch.

- Merging into `main` must be performed manually by the user.
- AI agents must never merge into `main`.
- A general development request does not authorize merging into `main`.

### 7.3 Remote Operations

Only perform the following operations when explicitly requested by the user:

- Pushing to a remote repository
- Creating Pull Requests

Do not automatically push or open Pull Requests after completing local changes.

### 7.4 Specification Commits

For tasks involving specification changes:

- Commit specification updates before their corresponding implementation.
- Preserve traceability between specification and implementation commits.

General commit practices and agent-specific Git coordination are governed by each developer's global configuration.

## 8. Scope and Compliance

This document governs only requirements specific to **off r39'x in 大阪らへん2027**.

It does not prescribe AI models, agent roles, subagents, orchestration, parallel execution, internal communication, or individual development workflows.

Regardless of the development environment, all contributors must:

1. Follow the official Canonical Owner specifications and `SPEC-000` governance.
2. Preserve the defined architecture, authorization boundaries, and security requirements.
3. Follow applicable implementation, testing, and validation contracts.
4. Maintain specification, implementation, test, and traceability consistency.
5. Never implement unincorporated UCRs as authoritative requirements.
6. Apply required specification changes before implementation.
7. Follow the project's Git branch and remote operation policies.
8. Never claim that unexecuted validation has passed.