---
name: seroo-backend-qa
description: "Create and run focused backend tests for Seroo endpoints, domain rules, database integrity, and role isolation."
---

# Seroo Backend QA

- Inspect existing test framework/scripts before adding another.
- Use isolated test database/config; never point destructive setup at dev or production DB.
- Test unit rules, integration behavior, API contract, authorization matrix, and failure conditions.
- Include multiple outlets and multiple roles in fixtures.
- Test owner read-only, crew restrictions, manager membership scope, and resource ID tampering.
- Test price calculation from server catalog, order snapshots, duplicate idempotency, and cancelled-order behavior after that policy is approved.
- Test stock movement/balance atomicity, transfer lifecycle, waste integration, Decimal precision, and report date boundaries.
- Do not use sleep-based flaky tests or shared mutable fixtures.
- Report exact commands, pass/fail counts, skipped tests, and gaps. Never claim tests ran if not run.
