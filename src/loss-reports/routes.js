import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { writeAuditLog } from "../audit/service.js";
import { LossReportError } from "./errors.js";

const DECIMAL = z
  .string()
  .max(13)
  .regex(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/);

const createLossReportSchema = z
  .object({
    inventoryItemId: z.string().min(1).max(64),
    quantity: DECIMAL,
    reason: z.string().trim().min(1).max(200),
    description: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Number(value.quantity) <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Jumlah kehilangan harus lebih dari nol.",
        path: ["quantity"],
      });
    }
  });

const reviewLossReportSchema = z
  .object({
    status: z.enum(["CONFIRMED", "REJECTED"]),
    reviewNote: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "REJECTED") {
      if (!val.reviewNote || val.reviewNote.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Catatan penolakan (reviewNote) wajib diisi.",
          path: ["reviewNote"],
        });
      }
    }
  });

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) {
    throw new LossReportError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
  }
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new LossReportError("VALIDATION_ERROR", 400, "Format permintaan tidak valid.");
    }
    throw err;
  }
}

function parseBody(schema, value, message) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new LossReportError("VALIDATION_ERROR", 400, message);
  }
  return parsed.data;
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
    throw new LossReportError(
      "FORBIDDEN",
      403,
      "Akses ke outlet atau tindakan ini tidak diizinkan.",
    );
  }
  return membership.role;
}

function lossReportDto(report) {
  return {
    id: report.id,
    outletId: report.outletId,
    inventoryItemId: report.inventoryItemId,
    itemName: report.itemName,
    quantity: report.quantity.toString(),
    unit: report.unit,
    reason: report.reason,
    description: report.description ?? null,
    status: report.status,
    reviewNote: report.reviewNote ?? null,
    reviewedAt: report.reviewedAt
      ? (report.reviewedAt instanceof Date
          ? report.reviewedAt.toISOString()
          : new Date(report.reviewedAt).toISOString())
      : null,
    createdAt: report.createdAt instanceof Date
      ? report.createdAt.toISOString()
      : new Date(report.createdAt).toISOString(),
    reportedBy: report.reportedBy ?? null,
    reviewedBy: report.reviewedBy ?? null,
    inventoryItem: report.inventoryItem ?? null,
  };
}

const REPORT_INCLUDE = {
  reportedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  inventoryItem: { select: { id: true, name: true, unit: true } },
};

export function createLossReportRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const app = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  // POST /:outletId/loss-reports — Crew membuat laporan kehilangan
  app.post("/:outletId/loss-reports", authenticate, async (c) => {
    const { userId } = c.get("auth");
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);

    const role = await requireMembership(prisma, userId, outletId, [
      "CREW",
      "MANAGER",
      "OWNER",
    ]);

    const body = await readJson(c);
    const payload = parseBody(
      createLossReportSchema,
      body,
      "Data laporan kehilangan tidak valid.",
    );

    // Verifikasi inventoryItem aktif dan terdaftar di outlet ini
    const outletStock = await prisma.outletStock.findUnique({
      where: {
        outletId_inventoryItemId: {
          outletId,
          inventoryItemId: payload.inventoryItemId,
        },
      },
      include: {
        inventoryItem: { select: { id: true, name: true, unit: true, isActive: true } },
      },
    });
    if (!outletStock || !outletStock.inventoryItem?.isActive) {
      throw new LossReportError(
        "INVENTORY_ITEM_NOT_FOUND",
        404,
        "Item inventaris tidak ditemukan di outlet ini.",
      );
    }

    const item = outletStock.inventoryItem;
    const report = await prisma.lossReport.create({
      data: {
        outletId,
        reportedById: userId,
        inventoryItemId: item.id,
        itemName: item.name,
        quantity: new Prisma.Decimal(payload.quantity),
        unit: item.unit,
        reason: payload.reason,
        description: payload.description ?? null,
        status: "PENDING",
        createdAt: now(),
      },
      include: REPORT_INCLUDE,
    });

    await writeAuditLog(prisma, {
      actorUserId: userId,
      outletId,
      action: "LOSS_REPORT_CREATED",
      resourceType: "LossReport",
      resourceId: report.id,
      outcome: "SUCCESS",
      metadata: {
        inventoryItemId: item.id,
        itemName: item.name,
        quantity: payload.quantity,
        unit: item.unit,
        reason: payload.reason,
        role,
      },
    });

    return c.json({ success: true, data: lossReportDto(report) }, 201);
  });

  // GET /:outletId/loss-reports — Manager & Crew melihat daftar laporan
  app.get("/:outletId/loss-reports", authenticate, async (c) => {
    const { userId } = c.get("auth");
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);

    const role = await requireMembership(prisma, userId, outletId, [
      "CREW",
      "MANAGER",
      "OWNER",
    ]);

    const statusFilter = c.req.query("status");
    const whereStatus =
      statusFilter && ["PENDING", "CONFIRMED", "REJECTED"].includes(statusFilter)
        ? { status: statusFilter }
        : {};

    // Crew hanya melihat laporannya sendiri; Manager/Owner melihat semua
    const whoFilter =
      role === "CREW" ? { reportedById: userId } : {};

    const reports = await prisma.lossReport.findMany({
      where: { outletId, ...whoFilter, ...whereStatus },
      include: REPORT_INCLUDE,
      orderBy: [
        // PENDING dulu, lalu terbaru
        { createdAt: "desc" },
      ],
    });

    // Hitung ringkasan status
    const summary = { PENDING: 0, CONFIRMED: 0, REJECTED: 0 };
    for (const r of reports) {
      summary[r.status] = (summary[r.status] ?? 0) + 1;
    }

    // Sort: PENDING di atas, lalu createdAt desc
    const sorted = [
      ...reports.filter((r) => r.status === "PENDING"),
      ...reports.filter((r) => r.status !== "PENDING"),
    ];

    return c.json({
      success: true,
      data: sorted.map(lossReportDto),
      meta: { summary },
    });
  });

  // PATCH /:outletId/loss-reports/:reportId/review — Manager mengonfirmasi/menolak
  app.patch(
    "/:outletId/loss-reports/:reportId/review",
    authenticate,
    async (c) => {
      const { userId } = c.get("auth");
      const outletId = c.req.param("outletId");
      const reportId = c.req.param("reportId");
      assertOutletId(outletId);

      await requireMembership(prisma, userId, outletId, ["MANAGER"]);

      const body = await readJson(c);
      const payload = parseBody(
        reviewLossReportSchema,
        body,
        "Data review tidak valid.",
      );

      // Pastikan laporan ada dan milik outlet ini
      const existing = await prisma.lossReport.findUnique({
        where: { id: reportId },
        include: { inventoryItem: { select: { id: true, name: true, unit: true } } },
      });
      if (!existing || existing.outletId !== outletId) {
        throw new LossReportError("NOT_FOUND", 404, "Laporan kehilangan tidak ditemukan.");
      }
      if (existing.status !== "PENDING") {
        throw new LossReportError(
          "ALREADY_PROCESSED",
          409,
          "Laporan ini sudah diproses dan tidak dapat diubah.",
        );
      }

      let updatedReport;

      if (payload.status === "REJECTED") {
        // Reject: atomic transaction untuk update status + audit log
        updatedReport = await prisma.$transaction(async (tx) => {
          const result = await tx.lossReport.updateMany({
            where: { id: reportId, status: "PENDING" },
            data: {
              status: "REJECTED",
              reviewedById: userId,
              reviewedAt: now(),
              reviewNote: payload.reviewNote ?? null,
            },
          });
          if (result.count !== 1) {
            throw new LossReportError(
              "ALREADY_PROCESSED",
              409,
              "Laporan ini sudah diproses oleh proses lain.",
            );
          }

          await writeAuditLog(tx, {
            actorUserId: userId,
            outletId,
            action: "LOSS_REPORT_REJECTED",
            resourceType: "LossReport",
            resourceId: reportId,
            outcome: "SUCCESS",
            metadata: {
              inventoryItemId: existing.inventoryItemId,
              itemName: existing.itemName,
              quantity: existing.quantity.toString(),
              reviewNote: payload.reviewNote ?? null,
            },
          });

          return tx.lossReport.findUnique({
            where: { id: reportId },
            include: REPORT_INCLUDE,
          });
        });
      } else {
        // CONFIRMED: atomic transaction — kurangi stok + buat StockMovement LOSS + update report + audit log
        const qty = new Prisma.Decimal(existing.quantity);

        try {
          updatedReport = await prisma.$transaction(async (tx) => {
            // 1. Kunci laporan dengan atomic conditional update: PENDING -> CONFIRMED
            // Ini mencegah race condition di mana dua request bersamaan memotong stok
            const lockResult = await tx.lossReport.updateMany({
              where: { id: reportId, status: "PENDING" },
              data: {
                status: "CONFIRMED",
                reviewedById: userId,
                reviewedAt: now(),
                reviewNote: payload.reviewNote ?? null,
              },
            });
            if (lockResult.count !== 1) {
              throw new LossReportError(
                "ALREADY_PROCESSED",
                409,
                "Laporan ini sudah diproses oleh proses lain.",
              );
            }

            // 2. Pastikan stok mencukupi dan kurangi stok
            const stockUpdate = await tx.outletStock.updateMany({
              where: {
                outletId,
                inventoryItemId: existing.inventoryItemId,
                quantity: { gte: qty },
              },
              data: { quantity: { decrement: qty } },
            });
            if (stockUpdate.count !== 1) {
              throw new LossReportError(
                "INSUFFICIENT_STOCK",
                409,
                "Stok tidak mencukupi untuk mengonfirmasi laporan kehilangan ini.",
              );
            }

            // 3. Buat StockMovement LOSS — quantity negatif sesuai konvensi inventory/routes.js
            await tx.stockMovement.create({
              data: {
                id: randomUUID(),
                outletId,
                inventoryItemId: existing.inventoryItemId,
                createdById: userId,
                type: "LOSS",
                quantity: qty.mul(-1),
                note: existing.reason,
                lossReportId: reportId,
                createdAt: now(),
              },
            });

            // 4. Catat AuditLog menggunakan client transaksi yang sama
            await writeAuditLog(tx, {
              actorUserId: userId,
              outletId,
              action: "LOSS_REPORT_CONFIRMED",
              resourceType: "LossReport",
              resourceId: reportId,
              outcome: "SUCCESS",
              metadata: {
                inventoryItemId: existing.inventoryItemId,
                itemName: existing.itemName,
                quantity: existing.quantity.toString(),
                reviewNote: payload.reviewNote ?? null,
              },
            });

            return tx.lossReport.findUnique({
              where: { id: reportId },
              include: REPORT_INCLUDE,
            });
          });
        } catch (err) {
          // Re-throw LossReportError as-is; rollback happened automatically
          throw err;
        }
      }

      return c.json({ success: true, data: lossReportDto(updatedReport) });
    },
  );

  return app;
}
