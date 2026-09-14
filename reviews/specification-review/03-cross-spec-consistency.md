# Cross-Spec Consistency

## Review A result

**FAIL** — current behavior is not consistently backed by canonical contracts, although no direct owner-value conflict was found.

| Area | Result | Note |
|---|---|---|
| System boundary | PASS | No boundary contradiction confirmed. |
| Invariants | PASS | INV-010-01 through INV-010-10 are traceable; no invariant gap confirmed. |
| Authorization | PASS with current-contract gaps | Required authority is identified, but several current operations are not enumerated. |
| Payment | PASS | No direct payment contract conflict confirmed. |
| QR | PASS | No direct QR contract conflict confirmed. |
| Karaoke | PASS | No direct karaoke contract conflict confirmed. |
| Email | PASS | No direct email contract conflict confirmed. |
| Database | PASS with readiness dependency | Existing data/index constraints do not resolve missing operation contracts. |
| Security | PASS with current-contract gaps | Authorization and safe-operation constraints are present but not executable for missing APIs. |
| Reliability | PASS with current-contract gaps | Recovery principles exist, but required recovery commands are absent. |
| Testing | PASS with readiness dependency | Acceptance rules exist; missing canonical IDs and APIs prevent complete tests. |
| Infrastructure | PASS | No infrastructure contradiction confirmed. |

## Current-to-UCR gaps

The seven deduplicated findings are all UCR-required. They concern Admin sales mutations, Goods Handoff commands, Admin query/read contracts, API operation IDs, manual recovery commands, future operational indexes, and dependent recovery-page wiring. UCR proposals must not be implemented as current APIs before incorporation into the canonical specifications.

No Canonical specification modified.
