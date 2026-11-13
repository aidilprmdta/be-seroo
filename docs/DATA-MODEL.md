# Data Model Review — Baseline and Required Decisions

## 1. Candidate entities

- Identity/access: `User`, `Outlet`, `OutletMembership`.
- Authorization expansion: permission/capability definitions and scoped assignments (candidate concepts; not current schema claims).
- Identity/session audit: per-user `AuthSession`, refresh-token rotation history, and append-only security/business activity records.
- Catalog: `Product`, `ProductVariant`, `AddOn`.
- Sales: `Order`, `OrderItem`, `OrderItemAddOn`.
- Expenses: `ExpenseCategory`, `Expense`.
- Inventory: `InventoryItem`, `OutletStock`, `StockMovement`, `StockRequest`, `StockRequestItem`, `RecipeItem`.
- Waste: `WasteRecord`.

The current Prisma schema already drafted in the project contains most of these names. This document is not permission to overwrite it. Inspect actual migration history and generated schema first.

## 2. Design requirements

### User, role, outlet

`OutletMembership` associates a user with an outlet and a role. All operations must use this association to determine access. Confirm whether a user can hold more than one role at the same outlet; the current unique key `(userId, outletId)` permits only one membership/role per outlet.

Each human Crew, Manager, and Owner must use an individual account. Administrator-only provisioning is required for MVP. Future Manager account management must be represented as an explicit capability scoped to Crew and authorized outlets, not inferred from `role = MANAGER`. Do not assume the existing schema has an Administrator role or permission tables.

Keep role as a default bundle, while authorization decisions resolve explicit capabilities plus outlet scope. Exact permission catalog, Administrator identity, invite/reset lifecycle, account deactivation, and mixed-role rules are open design items.

### Sessions and activity audit

Each authenticated user has separately identifiable sessions and audit activity. Candidate session fields/relations include user, device label, creation/last authenticated activity, expiry/revocation, and refresh-token hash/rotation history. Candidate activity attributes include actor user, session, action, resource type/id, outlet, outcome, server timestamp, and client transaction ID when relevant. These are design requirements, not a declaration that all fields/tables exist.

Session policy target: Crew maximum one active session and 12-hour absolute lifetime; Manager/Owner maximum two active sessions and retention up to 15 minutes after the app is left; all roles auto-lock at 10 minutes; server idle timeout 30 minutes. Access JWT remains 15 minutes. Resolve mixed-role and threshold semantics before choosing constraints or migrations.

### Offline operation and idempotency

Expo SQLite is a device-local outbox for only POS and waste on MVP; it is not the system of record and is not a substitute for server audit. Do not store passwords, access tokens, refresh tokens, or secrets in queue rows. Preserve a stable client-generated `clientTransactionId` across retries.

For server-side deduplication, consider a unique idempotency record/key scoped by authenticated actor, verified outlet, operation/resource type, and client transaction ID, plus a canonical payload hash and resulting resource reference. Same key/same payload replays the original result; same key/different payload conflicts. Ensure the idempotency reservation and business write are atomic. Exact persistence/retention strategy must be designed before migration.

Keep sync status separate from business status. QRIS created offline must use `PENDING_RECONCILIATION` and is not settlement proof. Transfer and stock adjustment do not have offline queue records on MVP.

### Orders and immutable snapshots

Store the name, size/variant name, unit price, add-on name, add-on unit price, quantity, and line subtotal at sale time. This protects historical receipt/report display from later catalog edits. Backend recalculates total from server catalog prices; client total is not authoritative.

The POS order path stores these snapshots in `OrderItem` and `OrderItemAddOn`. New writes require a stable `clientTransactionId`; `Order` stores a canonical payload hash and has a unique key scoped to outlet, authenticated Crew, and client ID. Legacy rows may keep a null client ID. Replaying the same payload returns the existing order; reusing the key with a different payload is rejected. `PaymentStatus.PENDING_RECONCILIATION` represents an offline QRIS record and does not imply payment verification.

Review whether `Order` needs:
- idempotency key (unique per actor/outlet according to policy),
- cancellation/void actor, timestamp, reason,
- shift/session reference,
- discount/tax fields (only if confirmed in actual business process),
- payment split or multiple tenders (only if confirmed; current `PaymentMethod` assumes one method per order).

### Expenses and cash flow

Current basic `Expense` draft has amount/category/date/creator. Confirm whether it needs `paymentMethod` or source account (`CASH`, `QRIS/BANK`, other), receipt attachment, reference number, approval status, and soft deletion/void fields. Do not invent these as settled requirements.

Without opening cash, cash deposits/withdrawals, expense payment source, and closing/cut-off rules, an exact physical cash balance cannot be calculated. Do not label simple sales-minus-expenses as cash-in-drawer or net profit.

The current Prisma baseline marks seeded expense categories with `isProvisional`. The seed contains only the SRS candidate names (Es batu, Air galon, Gas, Perlengkapan, Bahan baku darurat, Listrik, Penggajian, Lainnya); these are not final business categories. Existing categories are not overwritten by rerunning the seed.

### Inventory ledger

`OutletStock` is a balance/cache; `StockMovement` is the audit ledger. Decide whether stock can be negative and which unit conversions are supported. Every operation updating both must use one database transaction. Consider a unique source reference to prevent duplicate movements.

### Stock transfer/request

Confirm meaning of source and destination outlet. Model request creation, approval, dispatch, receipt, rejection/cancellation as explicit state transitions. If partial receipt is possible, record dispatched and received quantities separately. A request being approved is not equivalent to stock being received.

### Waste

If a waste record references an inventory item, define whether creating the waste automatically decrements stock. Avoid both a `WasteRecord` side effect and a second manual stock decrement. Link waste and movement via a stable reference or relation if both are persisted.

### Catalog history

Prefer deactivation over deleting catalog entities referenced by historical orders. Ensure reports use order snapshots, not current catalog price.

Global product pricing is only a temporary assumption pending confirmation by Seroo. Preserve a path to outlet-specific prices/effective-dated price history; do not make a final schema or migration decision until confirmed.

The current Prisma schema already has `Product`, `ProductVariant`, `AddOn`, and `InventoryItem` with active flags, and `OutletStock` stores balances per outlet. `ProductVariant.price` and `AddOn.price` are currently required global fields; this is existing schema, not confirmation of global pricing. No products, variants, add-ons, prices, inventory items, or stock balances are seeded until approved values and pricing scope are available. Medium/Large are intended variant labels, not database-enforced enum values.

## 3. Initial schema gap checklist

Codex must inspect whether current schema addresses these gaps before creating migrations:

- [ ] User/session token revocation model or approved auth strategy.
- [ ] Active user and membership checks.
- [ ] Membership uniqueness and possible multi-role requirement.
- [ ] Outlet-scoped query patterns and indexes.
- [ ] Idempotency for order creation.
- [ ] Order cancellation/void audit and reversal policy.
- [ ] Expense payment source/method and cashflow definition.
- [ ] Stock movement unique reference/idempotency.
- [ ] Transfer source/destination, dispatch, receipt, and partial quantity handling.
- [ ] Waste-to-stock movement linkage and atomic behavior.
- [ ] Recipe version/effective-date strategy if recipes change over time.
- [ ] Decimal precision and unit-of-measure rules.
- [ ] Daily/monthly time boundaries for `Asia/Jakarta`.
- [ ] Soft deactivation for catalog/master data.
- [ ] Individual accounts, Administrator provisioning, and future outlet-scoped Manager-to-Crew capability.
- [ ] Session caps, role-specific expiry, idle timeout, auto-lock, and activity audit semantics.
- [ ] Stable client transaction ID, idempotency persistence/retention, and payload-conflict behavior for POS/waste sync.
- [ ] Local queue protection/retention and offline QRIS reconciliation state.
- [ ] Confirm global versus outlet-specific product pricing with Seroo before finalizing catalog price model.

Do not add all candidate fields automatically. Resolve decisions and propose the smallest schema migration needed.
