// Notifikasi diturunkan dari data operasional yang sudah ada (stok, waste,
// loss report, QRIS pending). Tidak ada tabel notifikasi baru: status "belum
// dibaca" belum diputuskan, jadi endpoint ini bersifat turunan read-only.
import { Hono } from "hono";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { NotificationError } from "./errors.js";

const MANAGEMENT_ROLES = ["MANAGER", "OWNER", "OWNER_MITRA", "ADMIN_PUSAT"];
const WASTE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PER_SOURCE_LIMIT = 10;
const RESULT_LIMIT = 50;
const SEVERITY_WEIGHT = { CRITICAL: 0, WARNING: 1, INFO: 2 };

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) {
    throw new NotificationError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
  }
}

async function requireMembership(prisma, userId, outletId) {
  const membership = await prisma.outletMembership.findUnique({
    where: { userId_outletId: { userId, outletId } },
    include: { outlet: { select: { isActive: true } } },
  });
  if (!membership || !membership.outlet?.isActive) {
    throw new NotificationError(
      "FORBIDDEN",
      403,
      "Akses ke notifikasi outlet ini tidak diizinkan.",
    );
  }
  return membership.role;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function stockNotifications(balances) {
  const items = [];
  for (const balance of balances) {
    const quantity = Number(balance.quantity);
    const minimum = Number(balance.minimumQuantity);
    const outOfStock = quantity <= 0;
    const underMinimum = minimum > 0 && quantity <= minimum;
    if (!outOfStock && !underMinimum) continue;
    const name = balance.inventoryItem.name;
    const unit = balance.inventoryItem.unit;
    items.push({
      id: `stock:${balance.inventoryItemId}`,
      type: "STOCK",
      severity: outOfStock ? "CRITICAL" : "WARNING",
      title: outOfStock ? `Stok ${name} habis` : `Stok ${name} menipis`,
      body: outOfStock
        ? `Sisa 0 ${unit}. Ajukan permintaan stok.`
        : `Sisa ${balance.quantity.toString()} ${unit} (batas min. ${balance.minimumQuantity.toString()} ${unit}).`,
      referenceId: balance.inventoryItemId,
      createdAt: iso(balance.updatedAt),
    });
  }
  return items;
}

function lossNotifications(reports) {
  return reports.map((report) => ({
    id: `loss:${report.id}`,
    type: "LOSS_REPORT",
    severity: "WARNING",
    title: `Laporan kehilangan ${report.itemName} menunggu pemeriksaan`,
    body: `${report.quantity.toString()} ${report.unit} dilaporkan oleh ${report.reportedBy?.name ?? "Crew"}.`,
    referenceId: report.id,
    createdAt: iso(report.createdAt),
  }));
}

function wasteNotifications(records) {
  return records.map((record) => ({
    id: `waste:${record.id}`,
    type: "WASTE",
    severity: "INFO",
    title: `Waste baru: ${record.itemName}`,
    body: `${record.quantity.toString()} ${record.unit} (${record.category}) dicatat oleh ${record.createdBy?.name ?? "Crew"}.`,
    referenceId: record.id,
    createdAt: iso(record.createdAt),
  }));
}

function qrisNotifications(orders, actorLabel) {
  return orders.map((order) => ({
    id: `qris:${order.id}`,
    type: "QRIS_PENDING",
    severity: "WARNING",
    title: `QRIS ${order.orderNumber} belum diverifikasi`,
    body: `Total Rp ${order.total.toString()} ${actorLabel}`,
    referenceId: order.id,
    createdAt: iso(order.createdAt),
  }));
}

export function createNotificationRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  routes.get("/:outletId/notifications", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    const role = await requireMembership(prisma, auth.userId, outletId);
    const generatedAt = now();
    let notifications = [];

    if (MANAGEMENT_ROLES.includes(role)) {
      const [balances, lossReports, wasteRecords, qrisOrders] = await Promise.all([
        prisma.outletStock.findMany({
          where: {
            outletId,
            inventoryItem: { isActive: true },
            OR: [{ quantity: { lte: 0 } }, { minimumQuantity: { gt: 0 } }],
          },
          select: {
            inventoryItemId: true,
            quantity: true,
            minimumQuantity: true,
            updatedAt: true,
            inventoryItem: { select: { name: true, unit: true } },
          },
          take: 100,
        }),
        prisma.lossReport.findMany({
          where: { outletId, status: "PENDING" },
          select: {
            id: true,
            itemName: true,
            quantity: true,
            unit: true,
            createdAt: true,
            reportedBy: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: PER_SOURCE_LIMIT,
        }),
        prisma.wasteRecord.findMany({
          where: {
            outletId,
            createdAt: { gte: new Date(generatedAt.getTime() - WASTE_WINDOW_MS) },
          },
          select: {
            id: true,
            itemName: true,
            quantity: true,
            unit: true,
            category: true,
            createdAt: true,
            createdBy: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: PER_SOURCE_LIMIT,
        }),
        prisma.order.findMany({
          where: {
            outletId,
            status: "COMPLETED",
            paymentStatus: "PENDING_RECONCILIATION",
          },
          select: { id: true, orderNumber: true, total: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: PER_SOURCE_LIMIT,
        }),
      ]);

      notifications = [
        ...stockNotifications(balances),
        ...lossNotifications(lossReports),
        ...wasteNotifications(wasteRecords),
        ...qrisNotifications(qrisOrders, "masih menunggu rekonsiliasi mutasi merchant."),
      ];
    } else {
      const qrisOrders = await prisma.order.findMany({
        where: {
          outletId,
          crewId: auth.userId,
          status: "COMPLETED",
          paymentStatus: "PENDING_RECONCILIATION",
        },
        select: { id: true, orderNumber: true, total: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE_LIMIT,
      });
      notifications = qrisNotifications(
        qrisOrders,
        "menunggu verifikasi mutasi di aplikasi merchant.",
      );
    }

    notifications.sort((a, b) => {
      if (a.severity !== b.severity) {
        return SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

    return c.json({
      success: true,
      data: {
        outletId,
        role,
        generatedAt: generatedAt.toISOString(),
        count: notifications.length,
        unreadCount: notifications.filter((n) => n.severity !== "INFO").length,
        notifications: notifications.slice(0, RESULT_LIMIT),
      },
    });
  });

  return routes;
}
