---
name: seroo-api-design
description: "Design consistent, secure REST API contracts for the Seroo mobile application."
---

# Seroo API Design

- Read PRD and current route conventions before proposing paths.
- Use /api/v1 and consistent JSON response/error envelopes unless an existing approved contract differs.
- Document method, path, purpose, auth, outlet scope, capability, input schema, response DTO, status codes, pagination, and error codes.
- Validate params/query/body separately with Zod. Bound page size, date range, quantity, and request size.
- Do not accept actor identity, role, permissions, trusted price/total, or creator IDs from clients.
- Every endpoint reading outlet-owned data must enforce membership and query by outlet scope.
- Avoid over-fetching Prisma records; map explicit response DTOs.
- Do not invent integrations with Majo, QRIS gateway, ShopeeFood, or other external systems.
- Add contract/integration tests for success, malformed data, unauthenticated, forbidden, and cross-outlet access.
- Update docs/backend/API-CONTRACT.md with implemented behavior, not aspirations.
