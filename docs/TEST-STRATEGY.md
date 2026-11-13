# Backend Test Strategy

## Test layers

### Unit tests
- Provisional expense-category seed idempotency and preservation of existing categories.
- Pricing calculation from catalog price and quantities.
- Add-on calculation.
- Role/capability policy functions.
- Outlet membership resolution.
- Date range boundaries for `Asia/Jakarta` daily/monthly reports.
- Decimal serialization/rounding helpers.
- State transition rules for orders, stock requests, and transfers.

### Integration tests
Use a dedicated test database, never the user's dev database unless explicitly configured for tests.
- Prisma read/write against PostgreSQL.
- Login/session lifecycle.
- Per-role active-session limits, 10-minute auto-lock contract, 30-minute server idle timeout, Crew 12-hour absolute lifetime, Manager/Owner 15-minute app-abandon retention, refresh rotation/hash-at-rest, and audit attribution.
- Administrator-only user provisioning; future Manager permission cannot manage users outside authorized outlets or outside the Crew scope.
- POS/waste offline sync with stable `clientTransactionId`, same-payload replay, same-ID/different-payload conflict, transaction rollback, and concurrent duplicate delivery.
- Offline QRIS stays `PENDING_RECONCILIATION` and is excluded from verified/settled QRIS reporting until an authorized reconciliation transition.
- Online-only transfer and stock adjustment reject offline/untrusted client attempts.
- Order creation and price snapshots.
- Expense creation by Manager.
- Waste and stock movement atomic behavior.
- Stock transfer dispatch/receipt.
- Reports aggregate only eligible orders/expenses and authorized outlets.

### Authorization matrix tests
Test with at least:
- Crew assigned to Outlet A.
- Crew assigned to Outlet B.
- Manager assigned to A and B.
- Manager assigned only to A.
- Owner assigned to A (and B only if test fixture says so).
- Unauthenticated actor.

Required negative tests:
- Crew A requests an order ID from B.
- Manager A requests outlet B without membership.
- Owner calls write endpoints.
- Client spoofs `role`, `createdById`, `crewId`, `price`, or `total`.
- Inactive membership/user attempts operation.

### Concurrency and integrity tests
- Same actor/outlet/operation/client ID and payload submitted twice does not create duplicate POS/waste records.
- Same idempotency ID with a changed canonical payload returns conflict and preserves the original resource.
- Concurrent sync attempts for one client transaction ID result in one business effect and a stable replay response.
- Two concurrent sales cannot both consume unavailable stock if negative stock is disallowed.
- A failed stock movement rolls back the corresponding balance update.
- Failed transfer receipt does not partially mutate source/destination balances.
- A failed order line write does not leave partial order data.

## Required checks per change

- Existing test suite.
- Targeted tests for changed behavior.
- `npx prisma validate` if Prisma schema changes.
- Review generated migration SQL before apply.
- Lint/format only if configured; do not add tools just to claim compliance.
- Manual HTTP smoke test is supplementary and does not replace automated tests.

## Test data

Use synthetic names and values. Do not use real passwords or production financial records. Tests must be deterministic and isolated. Clean test data only in the dedicated test database.

Do not treat these scenarios as passing until the implementation exists. Do not apply a migration or point integration tests at a non-test database.
