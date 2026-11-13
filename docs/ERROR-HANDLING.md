# Error Handling and Observability

## Error taxonomy

Use stable machine-readable codes, for example:

- `VALIDATION_ERROR`
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `INVALID_STATE_TRANSITION`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

The exact list may evolve, but the same code must not mean different conditions in different modules.

## Rules

1. Validate at the HTTP boundary with Zod.
2. Convert known domain failures into safe HTTP status + stable error code.
3. Map unexpected errors in a centralized `app.onError` handler.
4. Return generic messages for unexpected failures; log detailed diagnostics only on the server.
5. Include request ID/correlation ID in response and structured logs.
6. Redact authorization headers, cookies, password fields, refresh/access tokens, database URLs, and secrets.
7. Never return Prisma error objects or stack traces directly to clients.
8. Avoid logging full request bodies for authentication, finance, or other sensitive endpoints.
9. Use logs to record security-relevant events (login failure, forbidden access, membership change, void/adjustment) without logging secrets.
10. Define liveness/readiness separately. Readiness may verify database availability; public health output must not disclose internal topology.

## Hono guidance

Use Hono's middleware model deliberately. Registration order matters; inspect the official middleware documentation before rearranging middleware. Centralize `onError`, CORS, request logging, authentication, and rate limiting. Do not assume adding middleware automatically secures a route if the route group is mounted outside the protected path.

Official guide: https://hono.dev/docs/guides/middleware
