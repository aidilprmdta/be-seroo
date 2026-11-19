---
name: seroo-backend-feature
description: "Implement one approved Seroo backend feature with validation, authorization, persistence, and tests."
---

# Seroo Backend Feature

1. Read backend/AGENTS.md, docs/backend/PRD-BACKEND.md, OPEN-DECISIONS.md, API-CONTRACT.md, and related tests.
2. Inspect current code and schema; do not assume documented structure exists.
3. Confirm requirement and unresolved decisions. Do not invent business rules.
4. Define request/response, errors, role/capability, outlet scope, state transitions, and transaction boundary before coding.
5. Use Hono route -> Zod validation -> service/use-case -> Prisma. Keep route handlers thin.
6. Derive actor ID and role from verified auth context, never request JSON. Validate membership and resource outlet.
7. Use explicit input DTOs; never spread untrusted request JSON into Prisma data.
8. Use Prisma transaction for multi-write invariants. Use Decimal for money and fractional inventory.
9. Add positive, validation, authorization-negative, cross-outlet, and failure-path tests.
10. Update API contract and relevant decisions if behavior changes.
11. Report files changed, tests run, migration implications, and remaining risks.

Do not implement adjacent features in the same task unless necessary for the approved slice.
