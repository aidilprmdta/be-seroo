---
name: seroo-backend-migration-review
description: "Review Prisma migrations for correctness, backward compatibility, and data-loss risk before application."
---

# Seroo Migration Review

- READ-ONLY review by default. Inspect current schema, migration history, generated SQL, environment target, and data impact.
- Check drops/renames, NOT NULL additions, enum alterations, unique indexes, locks, default values, backfills, foreign keys, and rollback limitations.
- Identify whether data migration is needed and whether it is safe for the target data volume.
- Ensure the migration is compatible with the Prisma 6.19.3 baseline.
- Do not run migrate reset, db push --force-reset, truncate, drop, or direct destructive SQL.
- Require backup and explicit approval for destructive or irreversible migration.
- Report SQL risks and recommended deployment order.
