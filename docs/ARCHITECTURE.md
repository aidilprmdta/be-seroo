# Backend Architecture

## 1. High-level architecture

```text
React Native + Expo
        |
        | HTTPS / JSON REST API
        v
Hono application (Node.js)
  ├── Middleware: request-id, logging, CORS, auth, rate limit
  ├── Routes / controllers: HTTP contract only
  ├── Schemas: Zod request/response validation
  ├── Services / use cases: business rules + authorization scope
  ├── Repositories (only where useful): Prisma queries
  ├── Sync/idempotency boundary: POS + waste reconciliation (target)
  └── Prisma Client 6.19.3
        |
        v
PostgreSQL 17

Mobile local outbox (POS/waste only; target)
        |
        └── Expo SQLite -> authenticated idempotent API sync -> Hono/PostgreSQL
```

## 2. Proposed source layout

Adapt this to the existing repository. Do not move/rename working files merely to match this tree.

```text
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── app.js
│   ├── index.js
│   ├── config/
│   │   └── env.js
│   ├── lib/
│   │   ├── prisma.js
│   │   └── errors.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── require-role.js
│   │   ├── validate.js
│   │   └── request-context.js
│   ├── modules/
│   │   ├── auth/
│   │   ├── outlets/
│   │   ├── catalog/
│   │   ├── orders/
│   │   ├── expenses/
│   │   ├── inventory/
│   │   ├── waste/
│   │   └── reports/
│   └── shared/
│       ├── constants/
│       ├── schemas/
│       └── utils/
├── tests/
├── .env.example
├── .gitignore
└── package.json
```

## 3. Layer responsibilities

- **Route/controller:** parse HTTP request, invoke validation, call use case, format response. No business calculation inside route.
- **Validation:** Zod schemas for params, query, body, and environment. Strict allowlists; reject or strip unknown fields according to endpoint policy.
- **Middleware:** request ID, logging, CORS, authentication, rate limit, common error handling. Middleware ordering must be intentional.
- **Service/use case:** authorization decisions, pricing, transaction rules, report boundaries, state transitions.
- **Persistence:** Prisma queries and `$transaction`. Avoid generic repository abstractions unless repeated usage justifies them.
- **Response mapping:** explicit DTOs; never serialize full Prisma records blindly.

## 4. Multi-outlet security boundary

Every authenticated request has an actor identity. Before reading or mutating outlet-owned data:

1. Resolve requested outlet context (route/query/header according to API contract).
2. Verify active membership for `actorId + outletId`.
3. Verify required role/capability for the operation.
4. Include outlet scope in the database query itself.
5. Verify resource belongs to that outlet before mutation or disclosure.

Never trust an `outletId` merely because it came from an authenticated client. Never authorize with role name alone without checking outlet scope.

## 5. Identity, permissions, sessions, and audit

- Every Crew, Manager, and Owner is an individual account. Administrator-only provisioning is the MVP rule; public registration/shared accounts are prohibited.
- Model authorization around capabilities plus outlet scope. Role can provide default permission bundles, but handlers/use cases authorize the capability and membership. A future Manager permission may manage Crew accounts only in authorized outlets.
- Each user has individually revocable sessions and auditable security/business activity. Actor and session identity are derived from verified auth; client-supplied actor, role, and timestamps are untrusted.
- Target auth policy: 15-minute access JWT; rotating refresh token with hash-at-rest; Crew maximum one active session and 12-hour absolute lifetime; Manager/Owner maximum two sessions and retention no longer than 15 minutes after leaving the app; auto-lock at 10 minutes for every role; server idle timeout 30 minutes.
- This policy is a requirement, not a statement of current implementation. Resolve role-mixed accounts, at-cap behavior, app lifecycle detection, audit retention, and session API before implementing database constraints.

## 6. Online-first limited-offline integrity

- Online-first is the default. Only POS and waste may be written to a device-local Expo SQLite outbox on MVP. Transfer and stock adjustment require online connection and never enter an offline queue.
- Do not store credentials, access/refresh tokens, or secrets in the outbox. Assess device data protection, retention, and logout/account-switch cleanup before implementation.
- Assign one stable `clientTransactionId` to each POS/waste operation before it is queued. Retries reuse the same ID and unchanged canonical payload.
- Server verifies current session, permission, and outlet membership at sync time, recalculates business values, and atomically claims idempotency key plus writes the business record.
- Same actor/outlet/operation/client ID and same payload returns the original result. Same ID with different payload returns conflict, never overwrites.
- Use a separate client sync state from server business/payment state. Network timeout means outcome unknown; the client retries with the same ID or checks status.
- Offline QRIS is `PENDING_RECONCILIATION`; it is not verified/settled. Reconciliation requires a future explicit authorized and audited flow.
- Detect stale catalog prices on sync. Never silently change a transaction already represented as paid; return a review/conflict until a recovery rule is approved.

## 7. Order integrity

- Backend loads active ProductVariant and AddOn records.
- Backend calculates prices and totals from stored prices.
- Client-supplied price/total fields are ignored or rejected.
- Save immutable snapshots of display names and unit prices on order items/add-ons.
- Order and related stock movements (if recipe deduction is enabled) commit atomically.
- Use the `clientTransactionId` idempotency strategy for retry-safe online/offline order creation. Apply equivalent protection to waste.
- Cancellation/void behavior must be designed with actor, reason, timestamp, and reversal movements; do not hard-delete completed orders.

## 8. Inventory integrity

`StockMovement` should be the auditable ledger. `OutletStock` is a balance/cache and must be kept consistent with ledger changes inside the same database transaction. Define whether negative stock is allowed; default recommendation is reject insufficient stock, but this needs business confirmation. Transfer must have explicit source/destination and a state transition; avoid deducting/adding twice.

## 9. Finance integrity

- Sales aggregation uses eligible completed orders only.
- Expenses are separate records and are not inferred from inventory movements unless a confirmed financial event exists.
- Cash vs QRIS is the payment method recorded on an order, not confirmation of settlement from a bank/gateway.
- Cash balance cannot be represented correctly without opening balance, cash expense payment source, cash deposit/withdrawal/settlement and cut-off rules.
- Net profit cannot be claimed without agreed COGS and operating cost definitions.
- Global product pricing is a temporary assumption pending confirmation by Seroo. Keep pricing extensible per outlet; do not finalize a global-only schema/migration before confirmation.

## 10. Transaction boundaries

Use a Prisma transaction for:
- Order creation + order lines + add-ons + inventory consumption (only when applicable).
- Cancellation + reversal movement if policy permits.
- Waste record + stock decrement when waste is an inventory item.
- Stock transfer dispatch/receipt + source/destination movements + balances.
- Any multi-record state change that must not partially commit.

Use decimal-safe arithmetic; do not convert money to binary float for calculations.

## 11. Runtime configuration

- Read secrets from environment variables.
- Validate required environment variables at startup with Zod.
- Use explicit CORS origins per environment.
- Bind server port from environment with a safe default for local development.
- Separate local/test/production database URLs.
- Production uses HTTPS at the deployment edge; do not expose PostgreSQL publicly.
- Use graceful shutdown to close the HTTP server and Prisma client.
