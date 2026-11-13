# Backend Implementation Roadmap

Roadmap ini berurutan dan dapat disesuaikan setelah audit repository. Jangan mengerjakan semua modul sekaligus.

## Phase 0 — Repository and environment audit
- [ ] Inspect Node/npm version, package manager, lockfile, Hono version, Prisma versions.
- [ ] Inspect Prisma schema, migrations, and local DB migration status.
- [ ] Inspect `.gitignore`; confirm `.env` is not tracked without printing secrets.
- [ ] Confirm `npm run dev`, health endpoint, error handler, and test command.
- [ ] Produce read-only gap report before implementation.

## Phase 1 — Core safety foundation
- [ ] Environment validation and safe configuration.
- [ ] Request ID, structured/redacted logger, centralized error handler.
- [ ] Zod request validation pattern.
- [ ] CORS allowlist and bounded request/query policy.
- [ ] Implement updated role-specific session lifecycle, caps, idle timeout, refresh rotation/hash-at-rest, and audit events (OD-01).
- [ ] Implement Administrator-only account provisioning and permission/capability plus outlet-scoped authorization.
- [ ] Test matrix for Crew/Manager/Owner and cross-outlet isolation.

## Phase 2 — Master data and outlet access
- [ ] User lifecycle and outlet membership administration rules.
- [ ] Outlet read/list for authorized users.
- [ ] Product, variant, add-on catalog and price history/snapshot rules; confirm global vs outlet-specific pricing with Seroo before locking schema.
- [ ] Manager capability to manage catalog if approved.

## Phase 3 — POS
- [ ] Read active catalog scoped by applicable outlet.
- [ ] Create order with server-side price calculation.
- [ ] Stable client transaction ID, server idempotency, same-payload replay and conflict tests.
- [ ] Add only the POS offline outbox/sync path after SQLite data protection and stale-price recovery contracts are approved.
- [ ] Immutable order-line/add-on snapshots.
- [ ] Order history and safe details.
- [ ] Void/refund flow only after OD-09 is resolved.

## Phase 4 — Inventory, stock request, waste
- [ ] Inventory items and outlet stock balances.
- [ ] Stock ledger and atomic adjustments/receipts.
- [ ] Stock request and transfer lifecycle, including partial receipt decision.
- [ ] Waste record and optional atomic stock decrement.
- [ ] Add limited offline waste queue/sync with idempotency and audit attribution.
- [ ] Keep stock transfer and adjustment online-only for MVP.
- [ ] Define offline QRIS reconciliation state/workflow; never mark unverified payment as settled.
- [ ] Recipe-based consumption only after recipe/unit rules are approved.

## Phase 5 — Expenses and reports
- [ ] Manager-only expense creation.
- [ ] Expense source/payment method decision.
- [ ] Daily/monthly sales and expense summaries.
- [ ] Asia/Jakarta period boundaries and tests.
- [ ] Cash balance, net profit, HPP, and profit sharing only after definitions are approved.

## Phase 6 — Pilot readiness
- [ ] Security audit and AI slop review.
- [ ] Integration and UAT test on Rumbai pilot data using synthetic/test account where appropriate.
- [ ] Backup/restore and migration procedure.
- [ ] Logging, monitoring, readiness check, graceful shutdown.
- [ ] Release readiness decision GO / CONDITIONAL GO / NO-GO.
