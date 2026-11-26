import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { writeAuditLog } from "../audit/service.js";
import { withFinancialLock } from "../closings/service.js";
import { toJakartaDateString, toJakartaMonthString } from "../reports/service.js";
import { ExpenseError } from "./errors.js";

async function assertExpensePeriodOpen(tx, outletId, date) {
  if (!tx.closingRecord?.findUnique) return;
  const dateStr = toJakartaDateString(date);
  const monthStr = toJakartaMonthString(date);

  // Check Daily Closing
  const dailyClosing = await tx.closingRecord.findUnique({
    where: {
      outletId_closingType_periodKey: {
        outletId,
        closingType: "DAILY",
        periodKey: dateStr,
      },
    },
  });
  if (dailyClosing && dailyClosing.status === "CLOSED") {
    throw new ExpenseError(
      "PERIOD_CLOSED",
      400,
      "Periode harian pengeluaran ini sudah ditutup closing. Reopen closing terlebih dahulu untuk melakukan perubahan.",
    );
  }

  // Check Monthly Closing
  const monthlyClosing = await tx.closingRecord.findUnique({
    where: {
      outletId_closingType_periodKey: {
        outletId,
        closingType: "MONTHLY",
        periodKey: monthStr,
      },
    },
  });
  if (monthlyClosing && monthlyClosing.status === "CLOSED") {
    throw new ExpenseError(
      "PERIOD_CLOSED",
      400,
      "Periode bulanan pengeluaran ini sudah ditutup closing. Reopen closing terlebih dahulu untuk melakukan perubahan.",
    );
  }
}

const moneyString = z
  .string()
  .max(13)
  .regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/);
const expenseInclude = {
  category: { select: { id: true, name: true, isProvisional: true } },
  createdBy: { select: { id: true, name: true } },
  audits: {
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  },
};

const createExpenseSchema = z
  .object({
    clientTransactionId: z.string().uuid(),
    categoryId: z.string().min(1).max(64),
    amount: moneyString,
    expenseDate: z.string().datetime({ offset: true }),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Number(value.amount) <= 0) {
      context.addIssue({
        code: "custom",
        message: "Nominal pengeluaran harus lebih dari nol.",
        path: ["amount"],
      });
    }
  });

const correctExpenseSchema = z
  .object({
    clientTransactionId: z.string().uuid(),
    categoryId: z.string().min(1).max(64).optional(),
    amount: moneyString.optional(),
    expenseDate: z.string().datetime({ offset: true }).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.categoryId === undefined &&
      value.amount === undefined &&
      value.expenseDate === undefined &&
      value.description === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Setidaknya satu nilai koreksi harus diisi.",
      });
    }
    if (value.amount !== undefined && Number(value.amount) <= 0) {
      context.addIssue({
        code: "custom",
        message: "Nominal pengeluaran harus lebih dari nol.",
        path: ["amount"],
      });
    }
  });

const cancelExpenseSchema = z
  .object({
    clientTransactionId: z.string().uuid(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function hashPayload(payload) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

function readBody(schema, value, message) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ExpenseError("VALIDATION_ERROR", 400, message);
  }
  return parsed.data;
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ExpenseError(
        "VALIDATION_ERROR",
        400,
        "Format permintaan tidak valid.",
      );
    }
    throw error;
  }
}

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) {
    throw new ExpenseError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
  }
}

async function requireMembership(prisma, userId, outletId, allowedRoles) {
  const membership = await prisma.outletMembership.findUnique({
    where: { userId_outletId: { userId, outletId } },
    include: { outlet: { select: { isActive: true } } },
  });
  if (
    !membership ||
    !membership.outlet?.isActive ||
    !allowedRoles.includes(membership.role)
  ) {
    throw new ExpenseError(
      "FORBIDDEN",
      403,
      "Akses ke outlet atau tindakan ini tidak diizinkan.",
    );
  }
  return membership.role;
}

function expenseSnapshot(expense) {
  return {
    categoryId: expense.categoryId,
    categoryName: expense.category?.name ?? null,
    amount: expense.amount.toString(),
    expenseDate: expense.expenseDate.toISOString(),
    description: expense.description,
    status: expense.status,
    cancelledAt: expense.cancelledAt?.toISOString() ?? null,
  };
}

function auditDto(audit) {
  return {
    id: audit.id,
    action: audit.action,
    reason: audit.reason,
    before: audit.beforeSnapshot,
    after: audit.afterSnapshot,
    clientTransactionId: audit.clientTransactionId,
    createdAt: audit.createdAt.toISOString(),
    actor: audit.actor,
  };
}

function expenseDto(expense) {
  return {
    id: expense.id,
    category: expense.category,
    amount: expense.amount.toString(),
    expenseDate: expense.expenseDate.toISOString(),
    description: expense.description,
    status: expense.status,
    cancelledAt: expense.cancelledAt?.toISOString() ?? null,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
    createdBy: expense.createdBy,
    audits: expense.audits.map(auditDto),
  };
}

function expenseUniqueWhere(outletId, userId, clientTransactionId) {
  return {
    outletId_createdById_clientTransactionId: {
      outletId,
      createdById: userId,
      clientTransactionId,
    },
  };
}

function auditUniqueWhere(outletId, userId, clientTransactionId) {
  return {
    outletId_actorId_clientTransactionId: {
      outletId,
      actorId: userId,
      clientTransactionId,
    },
  };
}

function assertSamePayload(record, digest) {
  if (record.payloadHash !== digest) {
    throw new ExpenseError(
      "IDEMPOTENCY_KEY_REUSED",
      409,
      "ID transaksi pengeluaran sudah digunakan dengan data berbeda.",
    );
  }
  return record;
}

async function readAuditReplay({
  prisma,
  outletId,
  userId,
  clientTransactionId,
  digest,
}) {
  const audit = await prisma.expenseAudit.findUnique({
    where: auditUniqueWhere(outletId, userId, clientTransactionId),
  });
  if (!audit) return null;
  assertSamePayload(audit, digest);
  const expense = await prisma.expense.findFirst({
    where: { id: audit.expenseId, outletId },
    include: expenseInclude,
  });
  if (!expense) {
    throw new ExpenseError(
      "INTERNAL_SERVER_ERROR",
      500,
      "Data pengeluaran tidak tersedia.",
    );
  }
  return expense;
}

async function createExpense({ prisma, outletId, userId, payload, now }) {
  const digest = hashPayload(payload);
  const uniqueWhere = expenseUniqueWhere(
    outletId,
    userId,
    payload.clientTransactionId,
  );
  const existing = await prisma.expense.findUnique({
    where: uniqueWhere,
    include: expenseInclude,
  });
  if (existing) {
    assertSamePayload(existing, digest);
    return { expense: existing, replayed: true };
  }

  try {
    const expense = await prisma.$transaction(async (tx) => {
      return withFinancialLock(tx, outletId, async () => {
        const current = await tx.expense.findUnique({
          where: uniqueWhere,
          include: expenseInclude,
        });
        if (current) {
          assertSamePayload(current, digest);
          return current;
        }

        const expenseDateObj = new Date(payload.expenseDate);
        await assertExpensePeriodOpen(tx, outletId, expenseDateObj);

        const category = await tx.expenseCategory.findUnique({
          where: { id: payload.categoryId },
          select: { id: true },
        });
        if (!category) {
          throw new ExpenseError(
            "CATEGORY_UNAVAILABLE",
            400,
            "Kategori pengeluaran tidak tersedia.",
          );
        }
        return tx.expense.create({
          data: {
            outletId,
            createdById: userId,
            clientTransactionId: payload.clientTransactionId,
            payloadHash: digest,
            categoryId: payload.categoryId,
            amount: new Prisma.Decimal(payload.amount),
            expenseDate: expenseDateObj,
            description: payload.description ?? null,
            createdAt: now(),
            updatedAt: now(),
          },
          include: expenseInclude,
        });
      });
    });
    return { expense, replayed: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const raced = await prisma.expense.findUnique({
      where: uniqueWhere,
      include: expenseInclude,
    });
    if (!raced) throw error;
    assertSamePayload(raced, digest);
    return { expense: raced, replayed: true };
  }
}

async function correctExpense({
  prisma,
  outletId,
  expenseId,
  userId,
  payload,
  now,
}) {
  const digest = hashPayload({ action: "CORRECTED", expenseId, ...payload });
  const prior = await readAuditReplay({
    prisma,
    outletId,
    userId,
    clientTransactionId: payload.clientTransactionId,
    digest,
  });
  if (prior) return { expense: prior, replayed: true };

  try {
    const expense = await prisma.$transaction(async (tx) => {
      return withFinancialLock(tx, outletId, async () => {
        const current = await tx.expense.findFirst({
          where: { id: expenseId, outletId },
          include: { category: { select: { name: true } } },
        });
        if (!current) {
          throw new ExpenseError("NOT_FOUND", 404, "Pengeluaran tidak ditemukan.");
        }
        if (current.status !== "ACTIVE") {
          throw new ExpenseError(
            "EXPENSE_NOT_ACTIVE",
            409,
            "Pengeluaran yang dibatalkan tidak dapat dikoreksi.",
          );
        }

        // Periksa apakah periode tanggal saat ini maupun tanggal baru sudah ditutup closing
        await assertExpensePeriodOpen(tx, outletId, current.expenseDate);
        if (payload.expenseDate !== undefined) {
          await assertExpensePeriodOpen(tx, outletId, new Date(payload.expenseDate));
        }

        if (payload.categoryId) {
          const category = await tx.expenseCategory.findUnique({
            where: { id: payload.categoryId },
            select: { id: true },
          });
          if (!category) {
            throw new ExpenseError(
              "CATEGORY_UNAVAILABLE",
              400,
              "Kategori pengeluaran tidak tersedia.",
            );
          }
        }

        const before = expenseSnapshot(current);
        const updatedAt = now();
        const updateData = {
          ...(payload.categoryId !== undefined
            ? { categoryId: payload.categoryId }
            : {}),
          ...(payload.amount !== undefined
            ? { amount: new Prisma.Decimal(payload.amount) }
            : {}),
          ...(payload.expenseDate !== undefined
            ? { expenseDate: new Date(payload.expenseDate) }
            : {}),
          ...(payload.description !== undefined
            ? { description: payload.description }
            : {}),
          updatedAt,
        };
        const changed = await tx.expense.updateMany({
          where: {
            id: expenseId,
            outletId,
            status: "ACTIVE",
            updatedAt: current.updatedAt,
          },
          data: updateData,
        });
        if (changed.count !== 1) {
          throw new ExpenseError(
            "EXPENSE_CHANGED",
            409,
            "Pengeluaran berubah bersamaan. Muat ulang sebelum mencoba lagi.",
          );
        }
        const updatedExpense = await tx.expense.findFirst({
          where: { id: expenseId, outletId },
          include: { category: { select: { name: true } } },
        });
        const after = expenseSnapshot(updatedExpense);
        if (JSON.stringify(before) === JSON.stringify(after)) {
          throw new ExpenseError(
            "NO_CHANGES",
            400,
            "Nilai koreksi sama dengan data pengeluaran saat ini.",
          );
        }
        await tx.expenseAudit.create({
          data: {
            expenseId,
            outletId,
            actorId: userId,
            clientTransactionId: payload.clientTransactionId,
            payloadHash: digest,
            action: "CORRECTED",
            reason: payload.reason ?? null,
            beforeSnapshot: before,
            afterSnapshot: after,
            createdAt: updatedAt,
          },
        });
        return tx.expense.findFirst({
          where: { id: expenseId, outletId },
          include: expenseInclude,
        });
      });
    });
    return { expense, replayed: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const replay = await readAuditReplay({
      prisma,
      outletId,
      userId,
      clientTransactionId: payload.clientTransactionId,
      digest,
    });
    if (!replay) throw error;
    return { expense: replay, replayed: true };
  }
}

async function cancelExpense({
  prisma,
  outletId,
  expenseId,
  userId,
  payload,
  now,
}) {
  const digest = hashPayload({ action: "CANCELLED", expenseId, ...payload });
  const prior = await readAuditReplay({
    prisma,
    outletId,
    userId,
    clientTransactionId: payload.clientTransactionId,
    digest,
  });
  if (prior) return { expense: prior, replayed: true };

  try {
    const expense = await prisma.$transaction(async (tx) => {
      return withFinancialLock(tx, outletId, async () => {
        const current = await tx.expense.findFirst({
          where: { id: expenseId, outletId },
          include: { category: { select: { name: true } } },
        });
        if (!current) {
          throw new ExpenseError("NOT_FOUND", 404, "Pengeluaran tidak ditemukan.");
        }
        if (current.status !== "ACTIVE") {
          throw new ExpenseError(
            "EXPENSE_NOT_ACTIVE",
            409,
            "Pengeluaran sudah dibatalkan.",
          );
        }

        // Periksa apakah periode tanggal pengeluaran yang akan dibatalkan sudah ditutup closing
        await assertExpensePeriodOpen(tx, outletId, current.expenseDate);

        const cancelledAt = now();
        const before = expenseSnapshot(current);
        const changed = await tx.expense.updateMany({
          where: {
            id: expenseId,
            outletId,
            status: "ACTIVE",
            updatedAt: current.updatedAt,
          },
          data: { status: "CANCELLED", cancelledAt, updatedAt: cancelledAt },
        });
        if (changed.count !== 1) {
          throw new ExpenseError(
            "EXPENSE_CHANGED",
            409,
            "Pengeluaran berubah bersamaan. Muat ulang sebelum mencoba lagi.",
          );
        }
        const updatedExpense = await tx.expense.findFirst({
          where: { id: expenseId, outletId },
          include: { category: { select: { name: true } } },
        });
        const after = expenseSnapshot(updatedExpense);
        await tx.expenseAudit.create({
          data: {
            expenseId,
            outletId,
            actorId: userId,
            clientTransactionId: payload.clientTransactionId,
            payloadHash: digest,
            action: "CANCELLED",
            reason: payload.reason ?? null,
            beforeSnapshot: before,
            afterSnapshot: after,
            createdAt: cancelledAt,
          },
        });
        return tx.expense.findFirst({
          where: { id: expenseId, outletId },
          include: expenseInclude,
        });
      });
    });
    return { expense, replayed: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const replay = await readAuditReplay({
      prisma,
      outletId,
      userId,
      clientTransactionId: payload.clientTransactionId,
      digest,
    });
    if (!replay) throw error;
    return { expense: replay, replayed: true };
  }
}

export function createExpenseRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
}) {
  const routes = new Hono();
  const authenticate = createAuthenticationMiddleware({
    prisma,
    accessTokenSecret,
    now,
  });

  routes.get("/expense-categories", authenticate, async (c) => {
    const categories = await prisma.expenseCategory.findMany({
      select: { id: true, name: true, isProvisional: true },
      orderBy: { name: "asc" },
    });
    return c.json({
      success: true,
      data: {
        categories: categories.map((category) => ({
          ...category,
          status: category.isProvisional ? "PROVISIONAL" : "CONFIRMED",
        })),
      },
    });
  });

  routes.get("/outlets/:outletId/expenses", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);
    const expenses = await prisma.expense.findMany({
      where: { outletId },
      include: expenseInclude,
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    return c.json({
      success: true,
      data: { outletId, expenses: expenses.map(expenseDto) },
    });
  });

  routes.post("/outlets/:outletId/expenses", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);
    const payload = readBody(
      createExpenseSchema,
      await readJson(c),
      "Periksa kembali kategori, nominal, dan tanggal pengeluaran.",
    );
    const result = await createExpense({
      prisma,
      outletId,
      userId: auth.userId,
      payload,
      now,
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: result.replayed ? "EXPENSE_REPLAYED" : "EXPENSE_CREATED",
      resourceType: "Expense",
      resourceId: result.expense.id,
      metadata: {
        clientTransactionId: payload.clientTransactionId,
        categoryId: payload.categoryId,
        amount: payload.amount,
        expenseDate: payload.expenseDate,
        replayed: result.replayed,
      },
    });

    return c.json(
      {
        success: true,
        data: { expense: expenseDto(result.expense), replayed: result.replayed },
      },
      result.replayed ? 200 : 201,
    );
  });

  routes.get(
    "/outlets/:outletId/expenses/:expenseId/audit",
    authenticate,
    async (c) => {
      const outletId = c.req.param("outletId");
      const expenseId = c.req.param("expenseId");
      assertOutletId(outletId);
      const auth = c.get("auth");
      await requireMembership(prisma, auth.userId, outletId, [
        "MANAGER",
        "OWNER",
        "OWNER_MITRA",
        "ADMIN_PUSAT",
      ]);
      const expense = await prisma.expense.findFirst({
        where: { id: expenseId, outletId },
        select: { id: true },
      });
      if (!expense) {
        throw new ExpenseError(
          "NOT_FOUND",
          404,
          "Pengeluaran tidak ditemukan.",
        );
      }
      const audits = await prisma.expenseAudit.findMany({
        where: { outletId, expenseId },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return c.json({
        success: true,
        data: { expenseId, audits: audits.map(auditDto) },
      });
    },
  );

  routes.patch(
    "/outlets/:outletId/expenses/:expenseId",
    authenticate,
    async (c) => {
      const outletId = c.req.param("outletId");
      const expenseId = c.req.param("expenseId");
      assertOutletId(outletId);
      const auth = c.get("auth");
      await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);
      const payload = readBody(
        correctExpenseSchema,
        await readJson(c),
        "Periksa kembali nilai koreksi pengeluaran.",
      );
      const result = await correctExpense({
        prisma,
        outletId,
        expenseId,
        userId: auth.userId,
        payload,
        now,
      });
      await writeAuditLog(prisma, {
        actorUserId: auth.userId,
        sessionId: auth.sessionId,
        outletId,
        action: result.replayed ? "EXPENSE_CORRECTION_REPLAYED" : "EXPENSE_CORRECTED",
        resourceType: "Expense",
        resourceId: expenseId,
        metadata: {
          clientTransactionId: payload.clientTransactionId,
          categoryId: payload.categoryId ?? null,
          amount: payload.amount ?? null,
          reasonProvided: Boolean(payload.reason),
          replayed: result.replayed,
        },
      });
      return c.json({
        success: true,
        data: { expense: expenseDto(result.expense), replayed: result.replayed },
      });
    },
  );

  routes.post(
    "/outlets/:outletId/expenses/:expenseId/cancel",
    authenticate,
    async (c) => {
      const outletId = c.req.param("outletId");
      const expenseId = c.req.param("expenseId");
      assertOutletId(outletId);
      const auth = c.get("auth");
      await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);
      const payload = readBody(
        cancelExpenseSchema,
        await readJson(c),
        "Periksa kembali data pembatalan pengeluaran.",
      );
      const result = await cancelExpense({
        prisma,
        outletId,
        expenseId,
        userId: auth.userId,
        payload,
        now,
      });
      await writeAuditLog(prisma, {
        actorUserId: auth.userId,
        sessionId: auth.sessionId,
        outletId,
        action: result.replayed ? "EXPENSE_CANCELLATION_REPLAYED" : "EXPENSE_CANCELLED",
        resourceType: "Expense",
        resourceId: expenseId,
        metadata: {
          clientTransactionId: payload.clientTransactionId,
          reasonProvided: Boolean(payload.reason),
          status: "CANCELLED",
          replayed: result.replayed,
        },
      });
      return c.json({
        success: true,
        data: { expense: expenseDto(result.expense), replayed: result.replayed },
      });
    },
  );

  return routes;
}
