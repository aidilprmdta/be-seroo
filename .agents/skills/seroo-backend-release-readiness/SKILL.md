---
name: seroo-backend-release-readiness
description: "Assess whether the Seroo backend is ready for pilot UAT or release."
---

# Seroo Backend Release Readiness

Assess implementation against PRD, API contract, security, observability, data integrity, migrations, environment configuration, backup/restore, and tests. Do not mark a control complete without evidence.

Check: secret handling, environment validation, production CORS, HTTPS termination, auth/session expiry/revocation, rate limiting, RBAC and outlet isolation, safe errors/logs, request validation, pagination/date bounds, database least privilege, migration review/backup, health/readiness endpoint, graceful shutdown, test results, API version/docs, and known open decisions.

Provide GO / CONDITIONAL GO / NO-GO with blockers and evidence. A local demo is not production release readiness.
