# Backend Security Threat Model

## Assets to protect

- User credentials, access/refresh tokens, session identifiers.
- Sales, expense, cashflow, inventory, waste, outlet operational data.
- Product prices and business configuration.
- Personal identities, audit history, authorization membership and permission assignments.
- Offline POS/waste queue data and idempotency records.
- Database credentials and deployment secrets.

## Trust boundaries

1. Mobile client → public API: every field is untrusted.
2. Authenticated actor → outlet resource: membership/role scope must be checked.
3. API process → PostgreSQL: use least-privilege DB credentials for deployment where practical.
4. Backend → future external integrations: outbound calls require allowlists/timeouts and safe parsing.

## Principal threats and controls

| Threat | Example in Seroo | Required control |
|---|---|---|
| BOLA/IDOR | Crew changes `orderId` to read another outlet's sale | Query by resource ID **and** authorized outlet scope; negative cross-outlet tests |
| Broken authentication | Stolen or brute-forced login credentials | Argon2id password hashing, rate limits, secure session lifecycle, generic failures |
| Shared/overprivileged account | Multiple Crew share credentials or Manager provisions a user outside own outlet | Individual accounts; Administrator-only creation on MVP; future Manager user-management permission scoped to Crew and authorized outlets |
| Session limit/expiry bypass | Refresh extends a Crew session beyond 12 hours or permits extra devices | Server-enforced per-role session cap, absolute/idle/app-abandon limits; rotate refresh tokens and store only hashes |
| Property-level authorization | Crew sends `role: OWNER` or `createdById` in JSON | Explicit DTO allowlists; server-derived identity and role |
| Function-level authorization | Owner directly calls expense creation endpoint | Server-side permission checks on each route/use case |
| Mass assignment | User updates `isActive`, total, role, or outletId | Never pass raw request body into Prisma update/create |
| Replay/duplicate order | Tablet retries after timeout and records sale twice | Idempotency key and database uniqueness policy |
| Offline replay/tampering | Local queue item is edited/replayed or synced under another actor | Stable client transaction ID; bind idempotency to authenticated actor, verified outlet, operation and canonical payload; authorize at sync time |
| False QRIS settlement | Offline QRIS record appears paid before funds are confirmed | `PENDING_RECONCILIATION` is explicitly unverified; separate reconciliation evidence/actor/state transition; exclude from verified settlement |
| Local data disclosure | Lost tablet exposes queued sales/waste | Minimize local data, no credentials/tokens in SQLite, protect device/database, access-control and retention/wipe policy |
| Audit spoofing | Client-supplied timestamp/actor is treated as authoritative | Derive actor/session from auth; store server receive/commit time separately from untrusted client event time |
| Stale price acceptance | Offline sale syncs at changed catalog price without user review | Recalculate server-side; detect price mismatch and return review/conflict; never silently alter a represented/paid transaction |
| Race condition | Two cashiers consume last stock simultaneously | Atomic transaction, conditional balance update/locking strategy, concurrency tests |
| Data leakage | Error returns SQL/stack/env details | Centralized error mapping and safe logs |
| Resource exhaustion | Huge date range/page size or repeated login | Rate limit, bounded query range, max page size, request size limits |
| CORS misconfiguration | Any website can call API with credentials | Explicit origin allowlist; avoid wildcard with credentials |
| Secret exposure | `.env` committed to Git | `.gitignore`, `.env.example` without secrets, secret rotation |
| Sensitive logging | Authorization header/token written to logs | Redaction, minimal logs, request IDs |
| Unsafe migration | AI resets database to fix migration | Backup, inspect SQL, approval, no destructive auto-command |

## Authentication baseline

- Passwords must never be stored plaintext or with fast general-purpose hashes such as SHA-256.
- Prefer Argon2id using a maintained library and OWASP-aligned parameters; benchmark on target hardware.
- Decide access/refresh token format and revocation strategy before implementing login. Do not invent an insecure shortcut to move faster.
- If refresh tokens are used, rotate them, store only a secure hash server-side where appropriate, and support revocation/session expiry.
- Do not put long-lived credentials in logs or URLs.
- Mobile clients must store refresh credentials in platform secure storage; access token should have a deliberately short lifetime and a documented lifecycle.
- Target policy: access JWT 15 minutes; Crew at most 1 active session and absolute 12-hour lifetime; Manager/Owner at most 2 active sessions and session retention no more than 15 minutes after leaving the app; auto-lock at 10 minutes for all roles; server idle timeout 30 minutes. Role-mixed accounts, limit-at-cap behavior, and app-abandon detection remain to be specified.
- The code currently does not enforce the new limits/lifetimes; document them as requirements, not verified controls.

## Authorization model

Every request must evaluate:

- authenticated actor,
- active account/session,
- target outlet membership,
- required role/capability,
- resource's actual outlet ownership,
- allowed properties for the operation.

Prefer capability checks with outlet scope (for example `requirePermission(actor, outletId, "crew.users.manage")`). Role defaults may map to permissions, but each action is checked server-side. On MVP only Administrator provisions accounts; future Manager permission is restricted to Crew users and authorized outlets. Do not rely on a role value sent by mobile.

## Limited-offline safety boundary

- Only POS and waste may be queued locally on MVP. Transfer and stock adjustment require online authorization and must not be queued.
- A `clientTransactionId` prevents duplicate effects; it does not prove authenticity, payment, or correct business content. Re-validate authorization, product/price, quantity, outlet membership, and state on sync.
- Use the same ID and unchanged payload on retry. An ID reused with different content must conflict and be audited; never overwrite the first accepted transaction.
- QRIS recorded offline remains `PENDING_RECONCILIATION`, not paid/verified. Reconciliation must be an explicit, authorized, auditable server action.
- Treat device wall-clock time as untrusted. Record server-side receive/commit time and preserve client event time only as an untrusted audit attribute.
- Expo SQLite protection/encryption, retention, backup behavior, and remote wipe expectations require a platform-specific design review before storing operational records.

## Security verification checklist

- [ ] unauthenticated request denied for private route
- [ ] expired/revoked token denied
- [ ] Crew cannot access another outlet by changing path/query/body IDs
- [ ] Manager cannot access an outlet outside membership
- [ ] Owner cannot write even with handcrafted HTTP request
- [ ] client cannot spoof creator/role/price/total
- [ ] invalid/oversized payload rejected
- [ ] auth rate limiting works
- [ ] role-specific active session caps and expiry/lock rules are enforced server-side
- [ ] session and user activity are auditable without logging credentials/tokens
- [ ] same actor/outlet/operation/client ID replays idempotently; changed payload conflicts
- [ ] offline QRIS cannot appear verified before reconciliation
- [ ] local offline data disclosure and retention controls are reviewed
- [ ] CORS only permits configured origins
- [ ] errors do not expose stack/SQL/env
- [ ] secrets do not appear in Git or logs
- [ ] sensitive reports are outlet-scoped
- [ ] database transaction prevents partial stock/order writes

This is a development threat model and checklist, not a certification or penetration-test report.
