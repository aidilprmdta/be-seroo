# API Contract — Seroo Backend

Status: Authentication v1 dan POS catalog/order routes tersedia di kode. POS order idempotency, server-side price calculation, snapshots, outlet membership checks, offline QRIS status, dan mobile outbox telah diimplementasikan. Migration POS belum diterapkan; katalog produksi belum memiliki seed produk/harga yang disetujui. Kebijakan session/idle terbaru, audit aktivitas, provisioning akun, dan rekonsiliasi QRIS masih belum sepenuhnya diimplementasikan.

## 1. Base path and media type

- Local base URL: `http://localhost:3000/api/v1`.
- Production base URL: HTTPS origin yang dikonfigurasi saat deployment.
- Request/response JSON menggunakan `application/json`, kecuali health endpoint.
- Gunakan REST resource naming dan HTTP semantics.
- Semua tanggal response memakai ISO 8601 UTC (`Z`). Client menampilkan tanggal menurut timezone yang disepakati.

## 2. Standard response shape

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Periksa kembali data yang dikirim."
  }
}
```

Do not expose stack traces, Prisma error text, SQL, password hashes, tokens, secret values, or internal file paths.

## 3. HTTP status conventions

- `200`: successful read/update/action with response body.
- `201`: resource created.
- `204`: successful deletion/revocation with no body, only when deletion is semantically appropriate.
- `400`: malformed request or invalid state transition.
- `401`: missing/invalid authentication.
- `403`: authenticated but not allowed.
- `404`: resource not found or intentionally concealed due to scope policy.
- `409`: conflict, duplicate idempotency key, invalid concurrency/state.
- `422`: semantically invalid domain input, if adopted consistently.
- `429`: rate limit.
- `500`: generic internal error.

## 4. Implemented authentication contract

Base path: `/api/v1/auth`. JSON dates use UTC ISO 8601. There is no public registration endpoint.

### Session and token rules

- Access token is an HS256 JWT with a 900-second lifetime and is accepted only as a Bearer token.
- Refresh token is an opaque 32-byte random value. PostgreSQL stores only its SHA-256 hash.
- Target: each device has its own `AuthSession` linked to auditable activity events. The current schema contains only a partial session record and does not yet satisfy the full activity-audit requirement. Refresh-token rotation and hash-at-rest are required.
- Target active-session caps: Crew 1; Manager 2; Owner 2. At-cap behavior and mixed-role accounts are pending policy details.
- Auto-lock is 10 minutes for every role. Server idle timeout is 30 minutes from last authenticated activity.
- Crew absolute session lifetime is 12 hours and cannot be extended by refresh. Manager/Owner session is retained no more than 15 minutes after the app is left. The trigger definition (background/closed), server signaling, and re-auth behavior need implementation-contract detail.
- Every successful refresh atomically consumes the previous token and inserts its replacement. Refresh must never extend the role-defined absolute session boundary; app-abandon and idle revocation are additional limits.
- Reuse of a consumed token revokes the whole device session and all its refresh tokens.
- Access requests re-check the session and active account in PostgreSQL so revocation takes effect before JWT expiry.
- Login attempts are limited to five per normalized email per 15 minutes in each backend process. Production deployments with multiple instances must also apply a shared/IP-based limit at the trusted edge.
- Production traffic must terminate HTTPS at the API server or a trusted reverse proxy. The current Node server does not configure TLS termination itself.

### `POST /api/v1/auth/login`

Request (unknown fields are rejected):

```json
{
  "email": "crew@seroo.com",
  "password": "password_pengguna",
  "deviceName": "Seroo Kasir Tablet Rumbai"
}
```

`deviceName` is optional. Success (`200`) returns `data.accessToken`, `data.tokenType`, `data.expiresIn`, `data.refreshToken`, `data.refreshExpiresAt`, `data.session`, and `data.user`. `user` contains only `id`, `name`, `email`, and active outlet `memberships` (`outletId`, `outletCode`, `outletName`, `role`). `passwordHash` is never selected for the response. Wrong passwords and unknown email addresses both return `401 INVALID_CREDENTIALS`.

### `POST /api/v1/auth/refresh`

Request:

```json
{ "refreshToken": "<opaque-token>" }
```

Success (`200`) returns a new access token, a new refresh token, the unchanged absolute `refreshExpiresAt`, and the same session DTO. No user profile is included; clients call `/api/v1/auth/me` for the profile.

### `GET /api/v1/auth/me`

Requires `Authorization: Bearer <accessToken>`. Success (`200`) returns `data.user` with active memberships and `data.session` with `id` and `expiresAt`. It does not expose a global role. Membership role and outlet scope are the authority source for future business endpoints.

### `POST /api/v1/auth/logout`

Request: `{ "refreshToken": "<opaque-token>" }`. Success (`200`) is idempotent and returns `{ "loggedOut": true }`; the associated session and its refresh tokens are revoked when the token is known.

### `POST /api/v1/auth/logout-all`

Requires an active Bearer access token. Success (`200`) returns `{ "loggedOut": true, "revokedSessions": 2 }` with the actual number of active sessions revoked for the authenticated user.

### Authentication errors

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED`, `ACCESS_TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_REUSE_DETECTED`, `SESSION_REVOKED` |
| 403 | `ACCOUNT_DISABLED`, `FORBIDDEN` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_SERVER_ERROR` |

The current implementation logs only the error class for unexpected failures and returns a generic `INTERNAL_SERVER_ERROR`. Existing code still uses a 30-day absolute expiry and does not yet enforce the new role session caps, auto-lock, 30-minute idle timeout, or 15-minute app-abandon retention. Do not treat those policies as implemented until code and tests are updated.

### Authorization scope boundary

Authentication endpoints and membership DTOs are implemented. No outlet business endpoints exist yet. Every future business endpoint must derive `userId` from the authenticated session, query the requested `OutletMembership` for the requested outlet on every request, and enforce action-specific role rules on the server. `OWNER` must remain read-only. Membership information in a mobile client is not authorization proof.

### User identity, permissions, and audit

- Every Crew, Manager, and Owner is an individual account. Shared accounts and public registration are not allowed.
- MVP account creation is Administrator-only. The Administrator identity/permission model and exact provisioning/reset endpoints remain to be designed.
- Prepare permission-based authorization: role defaults map to capabilities, and each action checks capability plus outlet scope server-side. The future Manager capability may create/manage Crew accounts only for authorized outlets; it must not grant Manager/Owner/Admin management or cross-outlet access.
- Every session and security/business activity must be auditable with server-derived actor/user, session, action/resource, outlet when relevant, outcome, and server timestamp. Never log credentials, tokens, or secrets. Audit retention and reader permissions remain to be decided.

## 5. Limited-offline POS and waste contract (target; not implemented)

The mobile app is online-first. Only POS transactions and waste records may be temporarily persisted in Expo SQLite and synchronized later. Transfer and stock-adjustment operations require an online connection on MVP and must not enter the offline queue.

Each POS/waste logical write must carry a client-generated `clientTransactionId` (UUID recommended), generated once and durably stored before queueing. It must remain unchanged across app restarts, retries, and sync attempts. The server idempotency scope must include authenticated actor, outlet, operation/resource type, and client ID:

- Same scope + same ID + same canonical payload returns the original server resource/result and creates no duplicate.
- Same scope + same ID + different payload returns `409 IDEMPOTENCY_KEY_REUSED`; it must not overwrite the original.
- Scope/identity comes from the authenticated session and verified membership, not trusted client-supplied actor or role.

Offline queue status is client sync state, not business status. Suggested local states: `queued`, `syncing`, `synced`, `retryable_failure`, `needs_review`. The server response remains authoritative for resource/business status. Transient errors may retry with bounded backoff; validation, authorization, price conflicts, and ID/payload conflicts require correction/review rather than blind retry.

For offline QRIS records, use the business status `PENDING_RECONCILIATION`. It explicitly means QRIS payment is unverified and not confirmed/settled. A reconciliation workflow, allowed actors, evidence, and transition rules must be approved before implementation. Do not count this state as verified QRIS settlement.

The mobile may retain item IDs and the price snapshot shown when the transaction was entered, but the backend recalculates authoritative prices on sync. If the catalog price changed, do not silently alter a transaction already represented to the user as paid; return a conflict/needs-review result. Exact recovery and cash-versus-QRIS handling remain open.

### Proposed POS and waste payload addition

The following is a target field addition to the proposed order/waste create operations; it is not an implemented endpoint shape:

```json
{
  "clientTransactionId": "client-generated-uuid"
}
```

This illustrates only the required added field, not a complete POS or waste body. Server DTOs should expose separate sync acknowledgement and business status. A successful sync acknowledges persistence on the server; it does not by itself mean an offline QRIS payment has been reconciled.

## 6. Initial resource groups

Except where marked implemented, endpoint names below are proposals and must be confirmed against current routes before implementation.

| Group | Endpoints | Status / access |
|---|---|---|
| Health | `GET /health`, `GET /health/ready` | Implemented; public generic status, readiness checks database availability without exposing connection details |
| Auth | `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout-all` | Routes implemented; updated session lifecycle and audit requirements are not yet implemented |
| Account provisioning | Administrator creates user; future Manager manages Crew within authorized outlet | Required MVP direction / future capability; routes and permissions not implemented |
| Outlets | `GET /outlets`, `GET /outlets/:outletId` | Membership-scoped |
| Catalog | `GET /outlets/:outletId/catalog` | Implemented; active catalog for authorized Crew membership |
| Products | `POST/PATCH /products`, activate/deactivate | Manager capability; not implemented; outlet/global scope decision required |
| Orders | `POST /outlets/:outletId/orders` | Implemented; Crew create, server-priced and idempotent |
| Order history | `GET /outlets/:outletId/orders`, `GET .../:orderId` | Proposed; not implemented |
| Expenses | `POST /outlets/:outletId/expenses`, `GET .../expenses` | Manager only to create; Manager/Owner read by scope |
| Inventory | `GET /outlets/:outletId/stocks`, stock adjustments and receipts | Crew read/request; Manager manage |
| Stock requests | create/list/approve/reject/dispatch/receive | Crew request; Manager process per permitted outlets |
| Waste | create/list/detail | Crew/Manager create; Manager review; Owner summary if required |
| Reports | daily/monthly sales, expenses, summary | Manager; Owner read-only by permitted outlet scope |

## 7. Request validation rules

- Validate route params, query params, and JSON body separately using Zod.
- Set sensible maximum page size; cap pagination and date range.
- Reject unknown writable fields for sensitive entities.
- Parse IDs and enums explicitly.
- Quantity must be a positive bounded integer/decimal according to item unit.
- Money is a decimal string or integer minor-unit representation according to one contract; decide and document consistently. Do not accept JavaScript floating-point values as an authoritative total.
- Request may provide `outletId`, but server must verify membership and scope.
- Request must never set `createdById`, `crewId`, role, permission, or audit actor.
- ### Implemented catalog and order contract

`GET /api/v1/outlets/:outletId/catalog` requires a valid Bearer session and an active `CREW` membership for that outlet. It returns active products with active variants and the active add-on list:

```json
{
  "success": true,
  "data": {
    "outletId": "outlet-id",
    "products": [
      {
        "id": "product-id",
        "name": "Nama dari master data",
        "category": null,
        "variants": [{ "id": "variant-id", "name": "Medium", "price": "12000" }]
      }
    ],
    "addOns": [{ "id": "add-on-id", "name": "Nama dari master data", "price": "3000" }]
  }
}
```

Prices are decimal strings from the existing required catalog price fields. Those fields are currently global in the schema; this is not approval of global pricing. Do not seed or treat prices as production values until the pending price-scope decision is resolved.

`POST /api/v1/outlets/:outletId/orders` accepts only:

```json
{
  "clientTransactionId": "e75f8268-4ed1-4f5c-b853-b4c25178a107",
  "recordedOffline": false,
  "paymentMethod": "CASH",
  "items": [
    {
      "productVariantId": "variant-id",
      "quantity": 2,
      "expectedVariantPrice": "12000",
      "addOns": [
        { "addOnId": "add-on-id", "quantity": 1, "expectedUnitPrice": "3000" }
      ]
    }
  ]
}
```

`expectedVariantPrice` and `expectedUnitPrice` are price snapshots for offline conflict detection only. The backend never accepts a client total or uses client prices to calculate an order. For `recordedOffline: true`, any catalog price change returns `409 PRICE_CHANGED` and creates no order. The server derives Crew identity and outlet scope from the verified session and membership. Unknown body fields, including `role`, `crewId`, and `total`, are rejected.

Success creates an immutable order snapshot of product name, variant name, base unit price, add-on name/unit price, quantities, and calculated total. Response `201` returns `{ "success": true, "data": { "order": { ... }, "replayed": false } }`. A same-scope replay with the same client ID and canonical payload returns the original order with `200` and `replayed: true`; reusing the ID with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`. The database uniqueness scope is outlet + authenticated Crew + client transaction ID.

For offline QRIS, the server stores `paymentStatus: "PENDING_RECONCILIATION"`. Other orders use `paymentStatus: "RECORDED"`; neither status represents gateway verification or settlement. No QRIS reconciliation transition is implemented.

## 8. Pagination and filtering

Use one consistent style, e.g. `page` + `pageSize` with hard max, or cursor pagination for large feeds. Do not mix styles across modules without reason. All list filters must remain outlet-scoped.

## 9. Idempotency

POS and waste synchronization require the `clientTransactionId` policy above. Add server uniqueness constraints, canonical payload comparison, transactional write, replay response, and concurrency tests. Do not claim idempotency if only a client timestamp is stored.

## 10. Product price scope (pending confirmation)

Global product prices across outlets are a temporary assumption, **not an approved Seroo business decision**. Obtain confirmation from Seroo before treating it as final. Keep the data/API design extensible to per-outlet prices and avoid issuing a schema migration based solely on this assumption.

## 11. API versioning

Use `/api/v1` for the initial contract. Breaking response or behavior changes should be deliberate and documented.
