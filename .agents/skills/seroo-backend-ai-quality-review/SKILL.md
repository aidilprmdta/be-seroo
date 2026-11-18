---
name: seroo-backend-ai-quality-review
description: "Review backend code for AI-generated slop, fake implementations, overengineering, and mismatch with Seroo business rules."
---

# Seroo Backend AI Quality Review

Review only unless explicitly asked to fix. Flag: placeholder routes returning success, hardcoded demo data in runtime path, fake persistence, broad try/catch that hides failures, swallowed errors, unsafe defaults, TODO used as a security bypass, duplicated pricing/authorization rules, giant route handlers, unnecessary repository/factory layers, dependencies added without need, unbounded queries, untyped unchecked payload propagation, raw body spread into Prisma writes, fabricated report formulas, and comments not matching behavior.

For every issue include file/line, evidence, risk, severity, and smallest reasonable fix. Check that the implementation obeys role scope, multi-outlet isolation, no external Majo/payment integration, manager-only expenses, waste by Crew/Manager, and no unsupported profit claims. Distinguish style preference from real correctness defect. Do not rewrite entire modules to improve style.
