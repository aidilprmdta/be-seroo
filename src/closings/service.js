import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ClosingError } from "./errors.js";
import {
  getDailyRange,
  getMonthlyRange,
  getDailyReport,
  getMonthlyReport,
  toJakartaDateString,
} from "../reports/service.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Generate a single 64-bit advisory lock key from outletId only.
 * All financial operations for one outlet share this SAME lock key.
 * Key does NOT depend on closingType or periodKey.
 */
 /** Generate a 64-bit advisory lock key from outletId only.
  *  Financial operations for an entire outlet share ONE lock key.
  *  Key does NOT depend on closingType or periodKey.
  */
function advisoryLockKey(outletId, closingType, periodKey) {
  const input = JSON.stringify([outletId, closingType, periodKey]);
  const hash = createHash("sha256").update(input).digest("hex");
  // First 16 hex chars = 8 bytes = 64 bits
  const bigIntHash = BigInt("0x" + hash.slice(0, 16));
  // Convert to positive 63-bit integer (PostgreSQL advisory locks use 63-bit signed)
  return (bigIntHash % (1n << 62n)) + (1n << 62n);
}

/**
 /** Generate a single 64-bit advisory lock key from outletId only.
  *  All financial operations for one outlet share this SAME lock key.
  *  Key does NOT depend on closingType or periodKey.
  */
export function financialLockKey(outletId) {
  const input = JSON.stringify([outletId]);
  const hash = createHash("sha256").update(input).digest("hex");
  // First 16 hex chars = 8 bytes = 64 bits
  const bigIntHash = BigInt("0x" + hash.slice(0, 16));
  // Convert to positive 63-bit integer (PostgreSQL advisory locks use 63-bit signed)
  return (bigIntHash % (1n << 62n)) + (1n << 62n);
}

/**
 * Acquire a transaction-level advisory lock using the transaction client.
 *  The lock is automatically released when the transaction commits or rolls back.
 *  No manual unlock is needed. The lock MUST be inside a $transaction block.
 */
export async function withAdvisoryLock(tx, lockKey, callback) {
  // Transaction-level advisory lock: automatically released on commit/rollback.
  // ::text wajib: fungsi PostgreSQL ini mengembalikan void dan gagal
  // dideserialisasi oleh Prisma $queryRaw.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})::text`;
  // Execute the callback inside the same transaction
  return await callback();
}

/** Acquire a transaction-level advisory lock for an entire outlet.
 *  All financial operations for one outlet share THIS lock key.
 *  No dependence on closingType or periodKey.
 */
export async function withFinancialLock(tx, outletId, callback) {
  if (typeof tx?.$queryRaw === "function") {
    // Transaction-level advisory lock: auto-released on commit/rollback
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${financialLockKey(outletId)})::text`;
  }
  return await callback();
}

/** Export for external use (e.g., pos/routes.js for QRIS and cancellation locking) */

export async function recordCashOpening(prisma, { outletId, userId, payload }) {
  const { periodKey, openingCash, notes } = payload;
  if (!periodKey || !DATE_REGEX.test(periodKey)) {
    throw new ClosingError(
      "VALIDATION_ERROR",
      400,
      "Format tanggal periodKey tidak valid. Gunakan YYYY-MM-DD.",
    );
  }
  if (openingCash === undefined || openingCash === null || openingCash === "") {
    throw new ClosingError(
      "VALIDATION_ERROR",
      400,
      "Saldo kas awal wajib diisi.",
    );
  }
  const dec = new Prisma.Decimal(openingCash.toString());
  if (dec.lt(0)) {
    throw new ClosingError(
      "VALIDATION_ERROR",
      400,
      "Saldo kas awal tidak boleh bernilai negatif.",
    );
  }

  const result = await prisma.cashOpening.upsert({
    where: {
      outletId_periodKey: { outletId, periodKey },
    },
    create: {
      outletId,
      periodKey,
      openingCash: dec,
      openedById: userId,
      notes: notes ?? null,
    },
    update: {
      openingCash: dec,
      openedById: userId,
      notes: notes ?? null,
    },
    include: {
      openedBy: { select: { id: true, name: true } },
    },
  });

  return {
    id: result.id,
    outletId: result.outletId,
    periodKey: result.periodKey,
    openingCash: result.openingCash.toFixed(2),
    openedAt: result.openedAt.toISOString(),
    openedBy: result.openedBy,
    notes: result.notes,
  };
}

export async function getCashOpening(prisma, { outletId, periodKey }) {
  if (!prisma.cashOpening) return null;
  const result = await prisma.cashOpening.findUnique({
    where: { outletId_periodKey: { outletId, periodKey } },
    include: {
      openedBy: { select: { id: true, name: true } },
    },
  });
  if (!result) return null;
  return {
    id: result.id,
    outletId: result.outletId,
    periodKey: result.periodKey,
    openingCash: result.openingCash.toFixed(2),
    openedAt: result.openedAt.toISOString(),
    openedBy: result.openedBy,
    notes: result.notes,
  };
}

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

export async function getUnfinishedTransactions({ prisma, outletId, start, end }) {
  const unfinishedOrders = await prisma.order.findMany({
    where: {
      outletId,
      status: "COMPLETED",
      paymentStatus: "PENDING_RECONCILIATION",
      createdAt: {
        gte: start,
        lt: end,
      },
    },
    include: {
      crew: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return unfinishedOrders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    total: order.total.toString(),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt.toISOString(),
    crewName: order.crew?.name || "Crew",
    notes: order.notes ?? null,
  }));
}

export async function getClosingPreview({
  prisma,
  outletId,
  closingType,
  periodKey,
  now = new Date(),
}) {
  if (!["DAILY", "MONTHLY"].includes(closingType)) {
    throw new ClosingError(
      "VALIDATION_ERROR",
      400,
      "Tipe closing harus DAILY atau MONTHLY.",
    );
  }

  const { start, end } =
    closingType === "DAILY"
      ? getDailyRange(periodKey)
      : getMonthlyRange(periodKey);

  const [report, unfinished] = await Promise.all([
    closingType === "DAILY"
      ? getDailyReport({ prisma, outletId, dateStr: periodKey, now })
      : getMonthlyReport({ prisma, outletId, monthStr: periodKey, now }),
    getUnfinishedTransactions({ prisma, outletId, start, end }),
  ]);

  const existingClosing = await prisma.closingRecord.findUnique({
    where: {
      outletId_closingType_periodKey: {
        outletId,
        closingType,
        periodKey,
      },
    },
    include: {
      closedBy: { select: { id: true, name: true } },
      reopenedBy: { select: { id: true, name: true } },
      history: {
        orderBy: { version: "desc" },
      },
      audits: {
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  let cashReconciliationPreview = null;
  if (closingType === "DAILY") {
    const cashOpening = prisma.cashOpening
      ? await prisma.cashOpening.findUnique({
          where: { outletId_periodKey: { outletId, periodKey } },
          include: { openedBy: { select: { id: true, name: true } } },
        })
      : null;

    const decOpening = cashOpening
      ? new Prisma.Decimal(cashOpening.openingCash.toString())
      : new Prisma.Decimal("0.00");
    const decSales = new Prisma.Decimal(report.paymentSummary?.cash?.total || "0.00");
    const decExpenses = new Prisma.Decimal(report.expenseSummary?.total || "0.00");
    const decExpected = decOpening.add(decSales).sub(decExpenses);

    cashReconciliationPreview = {
      openingCash: decOpening.toFixed(2),
      cashOpeningRecorded: Boolean(cashOpening),
      openedAt: cashOpening?.openedAt?.toISOString() ?? null,
      openedBy: cashOpening?.openedBy ?? null,
      cashSales: decSales.toFixed(2),
      cashExpenses: decExpenses.toFixed(2),
      expectedCash: decExpected.toFixed(2),
    };
  }

  return {
    outletId,
    closingType,
    periodKey,
    reportSummary: report,
    cashReconciliationPreview,
    unfinishedTransactions: unfinished,
    unfinishedCount: unfinished.length,
    currentClosing: existingClosing
      ? {
          id: existingClosing.id,
          status: existingClosing.status,
          version: existingClosing.version,
          closedAt: existingClosing.closedAt.toISOString(),
          closedBy: existingClosing.closedBy,
          reopenedAt: existingClosing.reopenedAt?.toISOString() ?? null,
          reopenedBy: existingClosing.reopenedBy ?? null,
          reopenReason: existingClosing.reopenReason ?? null,
          notes: existingClosing.notes,
          summarySnapshot: existingClosing.summarySnapshot,
          history: (existingClosing.history || []).map((h) => ({
            id: h.id,
            version: h.version,
            closedAt: h.closedAt.toISOString(),
            reopenedAt: h.reopenedAt?.toISOString() ?? null,
            reopenReason: h.reopenReason ?? null,
            notes: h.notes,
            unfinishedCount: h.unfinishedCount,
            summarySnapshot: h.summarySnapshot,
          })),
          audits: (existingClosing.audits || []).map((a) => ({
            id: a.id,
            action: a.action,
            reason: a.reason,
            version: a.version,
            actor: a.actor,
            createdAt: a.createdAt.toISOString(),
          })),
        }
      : null,
  };
}

export async function performClosing({
  prisma,
  outletId,
  userId,
  payload,
  now = new Date(),
}) {
  const {
    clientTransactionId,
    closingType,
    periodKey,
    notes,
    actualCash,
    differenceReason,
  } = payload;
  if (!clientTransactionId) {
    throw new ClosingError(
      "VALIDATION_ERROR",
      400,
      "clientTransactionId diperlukan.",
    );
  }
  if (!["DAILY", "MONTHLY"].includes(closingType)) {
    throw new ClosingError(
      "VALIDATION_ERROR",
      400,
      "Tipe closing harus DAILY atau MONTHLY.",
    );
  }

  const { start, end: dateEnd } =
    closingType === "DAILY"
      ? getDailyRange(periodKey)
      : getMonthlyRange(periodKey);

  const digest = hashPayload(payload);

  // Perform the entire closing operation within a single transaction and advisory lock
  return prisma.$transaction(async (tx) => {
    return withFinancialLock(tx, outletId, async () => {

      // Check clientTransactionId idempotency
      const existingAudit = tx.closingAudit?.findUnique
        ? await tx.closingAudit.findUnique({
            where: {
              outletId_actorId_clientTransactionId: {
                outletId,
                actorId: userId,
                clientTransactionId,
              },
            },
          })
        : await prisma.closingAudit.findUnique({
            where: {
              outletId_actorId_clientTransactionId: {
                outletId,
                actorId: userId,
                clientTransactionId,
              },
            },
          });

      if (existingAudit) {
        if (existingAudit.payloadHash !== digest) {
          throw new ClosingError(
            "IDEMPOTENCY_KEY_REUSED",
            409,
            "ID transaksi closing sudah digunakan dengan parameter berbeda.",
          );
        }
        const record = await tx.closingRecord.findUnique({
          where: { id: existingAudit.closingId },
          include: {
            closedBy: { select: { id: true, name: true } },
            reopenedBy: { select: { id: true, name: true } },
          },
        });
        return { record, replayed: true };
      }

      // Calculate fresh summary and unfinished items for snapshot
      const reportPrisma = tx.order?.findMany ? tx : prisma;
      const [report, unfinished] = await Promise.all([
        closingType === "DAILY"
          ? getDailyReport({ prisma: reportPrisma, outletId, dateStr: periodKey, now })
          : getMonthlyReport({ prisma: reportPrisma, outletId, monthStr: periodKey, now }),
        getUnfinishedTransactions({ prisma: reportPrisma, outletId, start: dateEnd }),
      ]);

  // --- Cash reconciliation (DAILY only, optional) ---
      let cashFields = {};
      if (closingType === "DAILY" && actualCash !== undefined && actualCash !== null) {
        const decActual = new Prisma.Decimal(actualCash.toString());
        if (decActual.lt(0)) {
          throw new ClosingError(
            "VALIDATION_ERROR",
            400,
            "Kas fisik tidak boleh bernilai negatif.",
          );
        }

        const cashOpeningRecord = tx.cashOpening
          ? await tx.cashOpening.findUnique({
              where: { outletId_periodKey: { outletId, periodKey } },
            })
          : null;

        const decOpening = cashOpeningRecord
          ? new Prisma.Decimal(cashOpeningRecord.openingCash.toString())
          : new Prisma.Decimal("0.00");
        const decSales = new Prisma.Decimal(
          report.paymentSummary?.cash?.total || "0.00",
        );
        const decExpenses = new Prisma.Decimal(
          report.expenseSummary?.total || "0.00",
        );
        const decExpected = decOpening.add(decSales).sub(decExpenses);
        const decDiff = decActual.sub(decExpected);

        if (!decDiff.isZero() && !differenceReason) {
          throw new ClosingError(
            "VALIDATION_ERROR",
            400,
            "Alasan selisih kas wajib diisi ketika terdapat selisih.",
          );
        }

        const resolvedReason = decDiff.isZero() ? null : differenceReason;

        cashFields = {
          openingCash: decOpening,
          cashSales: decSales,
          cashExpenses: decExpenses,
          expectedCash: decExpected,
          actualCash: decActual,
          cashDifference: decDiff,
          differenceReason: resolvedReason,
        };

        // embed into snapshot
        cashFields._snapshot = {
          openingCash: decOpening.toFixed(2),
          cashSales: decSales.toFixed(2),
          cashExpenses: decExpenses.toFixed(2),
          expectedCash: decExpected.toFixed(2),
          actualCash: decActual.toFixed(2),
          cashDifference: decDiff.toFixed(2),
          differenceReason: resolvedReason,
        };
      }

      const cashReconciliationSnapshot =
        cashFields._snapshot
          ? { cashReconciliation: cashFields._snapshot }
          : {};

      // Strip internal _snapshot key before writing to DB
      const { _snapshot: _removed, ...cashDbFields } = cashFields;

      const summarySnapshot = {
        summary: report.summary,
        paymentSummary: report.paymentSummary,
        expenseSummary: report.expenseSummary,
        productSalesCount: report.productSales?.length ?? 0,
        unfinishedCount: unfinished.length,
        period: report.period,
        ...cashReconciliationSnapshot,
      };

      // Check if closing already exists
      const existingClosing = await tx.closingRecord.findUnique({
        where: {
          outletId_closingType_periodKey: {
            outletId,
            closingType,
            periodKey,
          },
        },
      });

      if (existingClosing && existingClosing.status === "CLOSED") {
        throw new ClosingError(
          "ALREADY_CLOSED",
          409,
          "Periode ini sudah ditutup. Lakukan Reopen terlebih dahulu untuk melakukan closing ulang.",
        );
      }

      const currentDate = now instanceof Function ? now() : now;

      let record;
      let action;
      let newVersion;

      if (existingClosing && existingClosing.status === "REOPENED") {
        // Re-closing
        newVersion = existingClosing.version + 1;
        action = "RECLOSED";

        // Update existing ClosingRecord
        record = await tx.closingRecord.update({
          where: { id: existingClosing.id },
          data: {
            status: "CLOSED",
            version: newVersion,
            closedById: userId,
            closedAt: currentDate,
            summarySnapshot,
            notes: notes ?? existingClosing.notes,
            unfinishedCount: unfinished.length,
            clientTransactionId,
            payloadHash: digest,
            ...cashDbFields,
          },
          include: {
            closedBy: { select: { id: true, name: true } },
            reopenedBy: { select: { id: true, name: true } },
          },
        });

        // Save history entry for this re-closing
        await tx.closingHistory.create({
          data: {
            closingId: record.id,
            version: newVersion,
            closedById: userId,
            closedAt: currentDate,
            summarySnapshot,
            notes: notes ?? existingClosing.notes,
            unfinishedCount: unfinished.length,
          },
        });

        // Record audit log
        await tx.closingAudit.create({
          data: {
            closingId: record.id,
            outletId,
            actorId: userId,
            clientTransactionId,
            payloadHash: digest,
            action,
            reason: notes ?? "Closing ulang setelah reopen",
            version: newVersion,
            beforeSnapshot: existingClosing.summarySnapshot,
            afterSnapshot: summarySnapshot,
            createdAt: currentDate,
          },
        });
      } else {
        // First time closing
        newVersion = 1;
        action = "CLOSED";

        record = await tx.closingRecord.create({
          data: {
            outletId,
            closingType,
            periodKey,
            status: "CLOSED",
            closedById: userId,
            closedAt: currentDate,
            version: 1,
            summarySnapshot,
            notes: notes ?? null,
            unfinishedCount: unfinished.length,
            clientTransactionId,
            payloadHash: digest,
            ...cashDbFields,
          },
          include: {
            closedBy: { select: { id: true, name: true } },
          },
        });

        // Initial history
        await tx.closingHistory.create({
          data: {
            closingId: record.id,
            version: 1,
            closedById: userId,
            closedAt: currentDate,
            summarySnapshot,
            notes: notes ?? null,
            unfinishedCount: unfinished.length,
          },
        });

        // Audit log
        await tx.closingAudit.create({
          data: {
            closingId: record.id,
            outletId,
            actorId: userId,
            clientTransactionId,
            payloadHash: digest,
            action,
            reason: notes ?? "Closing periode",
            version: 1,
            afterSnapshot: summarySnapshot,
            createdAt: currentDate,
          },
        });
      }

      return { record, replayed: false };
    });  // closes withOutletPeriodLock's callback
  });  // closes $transaction
}

export async function reopenClosing({
  prisma,
  outletId,
  userId,
  payload,
  now = new Date(),
}) {
  const { clientTransactionId, closingId, reason } = payload;

  if (!clientTransactionId) {
    throw new ClosingError("VALIDATION_ERROR", 400, "clientTransactionId diperlukan.");
  }

  if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
    throw new ClosingError("VALIDATION_ERROR", 400, "Alasan Reopen wajib diisi minimal 5 karakter.");
  }
  const trimmedReason = reason.trim();

  const digest = hashPayload(payload);

  // Check idempotency for reopen audit BEFORE taking lock (fast-fail path)
  const existingAudit = await prisma.closingAudit.findUnique({
    where: {
      outletId_actorId_clientTransactionId: {
        outletId,
        actorId: userId,
        clientTransactionId,
      },
    },
  });
  if (existingAudit) {
    if (existingAudit.payloadHash !== digest) {
      throw new ClosingError(
        "IDEMPOTENCY_KEY_REUSED",
        409,
        "ID transaksi reopen sudah digunakan dengan parameter berbeda.",
      );
    }
    const record = await prisma.closingRecord.findUnique({
      where: { id: existingAudit.closingId },
      include: {
        closedBy: { select: { id: true, name: true } },
        reopenedBy: { select: { id: true, name: true } },
      },
    });
    return { record, replayed: true };
  }

  // Wrap the entire closing operation in a single transaction and financial lock
  return prisma.$transaction(async (tx) => {
    // Acquire financial lock for the outlet (serializes all financial operations)
    return withFinancialLock(tx, outletId, async () => {
      // Re-read closing data within transaction (uses tx, not root prisma)
      const closingFinder = tx.closingRecord?.findFirst ? tx.closingRecord : prisma.closingRecord;
      const closing = await closingFinder.findFirst({
        where: { id: closingId, outletId },
      });

      if (!closing) {
        throw new ClosingError("NOT_FOUND", 404, "Data closing tidak ditemukan.");
      }

      if (closing.status === "REOPENED") {
        throw new ClosingError("ALREADY_REOPENED", 409, "Periode closing ini sudah berstatus Reopened.");
      }

      const currentDate = now instanceof Function ? now() : now;
      // Reopen is intended specifically to reopen an already CLOSED period so that corrections can be made.
      // Therefore, we must NOT reject with PERIOD_CLOSED when checking the closing itself!

      // Update record to REOPENED
      const updatedRecord = await tx.closingRecord.update({
        where: { id: closing.id },
        data: {
          status: "REOPENED",
          reopenedById: userId,
          reopenedAt: currentDate,
          reopenReason: trimmedReason,
        },
        include: {
          closedBy: { select: { id: true, name: true } },
          reopenedBy: { select: { id: true, name: true } },
        },
      });

      // Update current history record with reopen info
      const historyFinder = tx.closingHistory?.findFirst ? tx.closingHistory : prisma.closingHistory;
      const latestHistory = await historyFinder.findFirst({
        where: { closingId: closing.id, version: closing.version },
      });
      if (latestHistory) {
        await tx.closingHistory.update({
          where: { id: latestHistory.id },
          data: {
            reopenedById: userId,
            reopenedAt: currentDate,
            reopenReason: trimmedReason,
          },
        });
      }

      // Create audit log for REOPENED
      await tx.closingAudit.create({
        data: {
          closingId: closing.id,
          outletId,
          actorId: userId,
          clientTransactionId,
          payloadHash: digest,
          action: "REOPENED",
          reason: trimmedReason,
          version: closing.version,
          beforeSnapshot: closing.summarySnapshot,
          createdAt: currentDate,
        },
      });

      return { record: updatedRecord, replayed: false };
    });
  });
}

export async function listClosings({ prisma, outletId, closingType }) {
  const where = { outletId };
  if (closingType) {
    where.closingType = closingType;
  }

  const records = await prisma.closingRecord.findMany({
    where,
    include: {
      closedBy: { select: { id: true, name: true } },
      reopenedBy: { select: { id: true, name: true } },
      history: {
        orderBy: { version: "desc" },
      },
      audits: {
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
    orderBy: { periodKey: "desc" },
    take: 50,
  });

  return records.map((record) => ({
    id: record.id,
    outletId: record.outletId,
    closingType: record.closingType,
    periodKey: record.periodKey,
    status: record.status,
    version: record.version,
    closedAt: record.closedAt.toISOString(),
    closedBy: record.closedBy,
    reopenedAt: record.reopenedAt?.toISOString() ?? null,
    reopenedBy: record.reopenedBy ?? null,
    reopenReason: record.reopenReason ?? null,
    notes: record.notes,
    unfinishedCount: record.unfinishedCount,
    actualCash: record.actualCash?.toString() ?? null,
    cashDifference: record.cashDifference?.toString() ?? null,
    differenceReason: record.differenceReason ?? null,
    cashDifferenceStatus: record.cashDifferenceStatus ?? "BELUM_DIPERIKSA",
    cashDifferenceReviewNote: record.cashDifferenceReviewNote ?? null,
    cashDifferenceReviewedAt: record.cashDifferenceReviewedAt?.toISOString() ?? null,
    summarySnapshot: record.summarySnapshot,
    history: (record.history || []).map((h) => ({
      id: h.id,
      version: h.version,
      closedAt: h.closedAt.toISOString(),
      reopenedAt: h.reopenedAt?.toISOString() ?? null,
      reopenReason: h.reopenReason ?? null,
      notes: h.notes,
      unfinishedCount: h.unfinishedCount,
      summarySnapshot: h.summarySnapshot,
    })),
    audits: (record.audits || []).map((a) => ({
      id: a.id,
      action: a.action,
      reason: a.reason,
      version: a.version,
      actor: a.actor,
      createdAt: a.createdAt.toISOString(),
    })),
  }));
}
