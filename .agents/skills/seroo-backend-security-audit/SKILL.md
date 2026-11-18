---
name: seroo-backend-security-audit
description: "Perform a read-only security audit of Seroo Hono API, Prisma data access, authentication, and multi-outlet authorization."
---

# Seroo Backend Security Audit

## Mode
Default is READ-ONLY. Do not change files, install dependencies, run migrations, reset data, or exploit production systems. Ask for explicit authorization before active testing beyond the local test environment.

## Inspect
- Authentication/session lifecycle, password hashing, token storage and revocation.
- Function-level, object-level and property-level authorization.
- Outlet membership enforcement on every endpoint and nested resource.
- IDOR/BOLA, mass assignment, spoofed creator/role/price/total.
- Zod validation, size limits, pagination and date range limits.
- Rate limiting, CORS, secure headers, HTTPS assumptions, secrets, dependency risks.
- Prisma query construction, raw SQL, transaction boundaries, race conditions.
- Error and log redaction, sensitive financial data exposure.
- Business-flow abuse such as duplicate order submissions, unauthorized expense creation, repeated stock receipt.

## Required test scenarios
- Anonymous user against private endpoints.
- Crew A requests Outlet B records by changing IDs.
- Manager A requests Outlet B without membership.
- Owner sends mutation directly.
- Client sets role, createdById, crewId, unitPrice, total, isActive, or arbitrary outlet scope.
- Replayed order/stock transition.

## Output
For each finding: severity, evidence file/line, attack precondition, impact, exploitability, recommendation, and test needed. Distinguish confirmed vulnerability from potential risk and NOT VERIFIED. Do not expose actual secrets in the report. Never claim penetration test or security certification from static review.
