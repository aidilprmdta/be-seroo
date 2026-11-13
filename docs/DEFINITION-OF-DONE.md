# Backend Definition of Done

A backend task is complete only when applicable items are met:

## Functional
- [ ] Behavior maps to an approved PRD requirement or recorded decision.
- [ ] Request, response, status code, authorization, and error behavior are documented.
- [ ] Business rules are implemented server-side.
- [ ] No fake success, unpersisted placeholder, or decorative API behavior.

## Security
- [ ] Authentication and authorization are enforced server-side.
- [ ] Outlet scope is verified and included in data access.
- [ ] Writable fields are allowlisted; actor identity is server-derived.
- [ ] Secrets and sensitive data are not exposed in responses/logs.
- [ ] Rate limit/input size/CORS are addressed where relevant.

## Data integrity
- [ ] Decimal used for currency/decimal quantities.
- [ ] Transaction boundary is atomic where multi-write integrity matters.
- [ ] Idempotency/retry behavior is documented for money-moving or sale-creating operations.
- [ ] No historical record is hard-deleted without approved policy.
- [ ] Migration is reviewed; no destructive changes without approval.

## Quality
- [ ] Unit/integration/authorization tests added or updated.
- [ ] Tests were actually run and result reported accurately.
- [ ] Existing API contract/docs updated.
- [ ] No unnecessary dependency or speculative abstraction.
- [ ] Logs and errors are safe and useful.

## Delivery summary
Codex must report: files changed, requirement addressed, tests run/results, migration impact, security considerations, unresolved decisions, and known limitations.
