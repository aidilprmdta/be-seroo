---
name: seroo-prisma-database
description: "Review Prisma 6.19.3 data models, migrations, transactions, and PostgreSQL integrity for Seroo."
---

# Seroo Prisma and Database

1. Verify actual Prisma and @prisma/client versions. Baseline is 6.19.3; do not use Prisma 7 config syntax.
2. Inspect schema, migrations, database target, package scripts, and .env.example. Never print secret .env contents.
3. Validate model relations, onDelete/onUpdate behavior, uniqueness, indexes, decimal precision, enum lifecycle, and historical snapshots.
4. Preserve outlet boundaries in indexes and all queries.
5. Use Decimal for money and fractional quantities; define serialization at API boundary.
6. Treat StockMovement as auditable ledger and OutletStock as materialized/current balance; write both atomically.
7. Model transfers as explicit state transitions and prevent duplicate dispatch/receipt movements.
8. Inspect migration SQL before applying. Never reset/drop/truncate or force-push without explicit approval and backup.
9. Do not add speculative fields to resolve OPEN-DECISIONS. Raise a decision first.
10. After schema change run prisma format, prisma validate, generate, relevant tests, and review migration. Report every command actually run.
