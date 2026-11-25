import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { PosError } from "./errors.js";

const exportSchema = z
  .object({
    format: z.enum(["PDF", "XLSX", "HTML", "CSV"]).default("PDF"),
    includeItems: z.boolean().default(true),
  })
  .strict();

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) throw new PosError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
}

async function requireOutletMembership(prisma, userId, outletId, allowedRoles = ["CREW", "MANAGER", "OWNER", "OWNER_MITRA"]) {
  const membership = await prisma.outletMembership.findUnique({
    where: { userId_outletId: { userId, outletId } },
    include: { outlet: { select: { isActive: true } } },
  });
  if (!membership || !membership.outlet?.isActive || !allowedRoles.includes(membership.role)) {
    throw new PosError("FORBIDDEN", 403, "Akses ke outlet ini tidak diizinkan.");
  }
  return membership;
}

// Export a single order as PDF/XLSX/HTML/CSV (simulated for MVP)
export function exportOrder(order) {
  const { id, orderNumber, outletId, status, paymentMethod, paymentStatus, total, createdAt, items, payments } = order;
  const format = process.env.RECEIPT_EXPORT_FORMAT || "PDF";
  const lines = [`SEROo RECEIPT #${orderNumber}`, "================", `Outlet : ${outletId}`, `Tanggal: ${new Date(createdAt).toLocaleString("id-ID")}`];
  for (const item of items || []) {
    lines.push(`  - ${item.productName} x ${item.quantity} = Rp ${item.subtotal}`);
  }
  lines.push(`Total  : Rp ${total}`, `Status : ${status}`, `Metode : ${paymentMethod}`, `Pembayaran: ${paymentStatus}`, "================", "Terima kasih telah berbelanja!");
  return {
    format, content: lines.join("\n"), filename: `seroo-${orderNumber}.${format.toLowerCase()}`, mimetype: `application/${format.toLowerCase() === "pdf" ? "pdf" : "octet-stream"}`,
  };
}

export function createReceiptRoutes({
  prisma,
  accessTokenSecret,
}) {
  const routes = new Hono();
  const authenticate = createAuthenticationMiddleware({ prisma, accessTokenSecret });

  routes.get("/:outletId/orders/:orderId/export", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const orderId = c.req.param("orderId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId, ["MANAGER", "OWNER", "OWNER_MITRA"]);

    let body;
    try { body = exportSchema.parse(await c.req.json()); } catch (err) {
      if (err instanceof z.ZodError) throw new PosError("VALIDATION_ERROR", 400, err.issues[0].message);
      throw err;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: true },
    });
    if (!order) throw new PosError("ORDER_NOT_FOUND", 404, "Transaksi tidak ditemukan.");

    // For MVP: return a structured preview with the file mock ready to download
    const result = exportOrder({ ...order, total: order.total.toString() });
    return c.json({
      success: true,
      data: {
        order: {
          id: order.id, orderNumber: order.orderNumber, outletId: order.outletId,
          status: order.status, paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus, total: order.total.toString(),
          createdAt: order.createdAt.toISOString(),
          items: order.items?.map((i) => ({ productName: i.productName, quantity: i.quantity, subtotal: i.subtotal })) || [],
          payments: order.payments?.map((p) => ({ paymentMethod: p.paymentMethod, amount: p.amount, status: p.paymentStatus })) || [],
        },
        download: {
          filename: result.filename,
          mimetype: result.mimetype,
          content: result.content,
          format: result.format,
        },
      },
    });
  });

  routes.get("/:outletId/reports/cash-flow", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId, ["MANAGER", "OWNER", "OWNER_MITRA"]);

    const format = c.req.query("format") || "CSV";
    const startDate = c.req.query("startDate") || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10);
    const endDate = c.req.query("endDate") || new Date().toISOString().slice(0, 10);

    // Fetch cash flow data from database
    const cashFlow = await prisma.$queryRaw`
      SELECT
        date_trunc('day', o.createdAt) AS day,
        COUNT(o.id) AS orderCount,
        COALESCE(SUM(o.total), 0) AS totalSales
      FROM "Order" o
      WHERE o.outletId = ${outletId}
        AND o.createdAt >= ${new Date(startDate + "T00:00:00")}
        AND o.createdAt <= ${new Date(endDate + "T23:59:59")}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const cashExpenses = await prisma.$queryRaw`
      SELECT
        date_trunc('day', e.createdAt) AS day,
        SUM(e.amount) AS totalExpenses
      FROM "Expense" e
      WHERE e.outletId = ${outletId}
        AND e.createdAt >= ${new Date(startDate + "T00:00:00")}
        AND e.createdAt <= ${new Date(endDate + "T23:59:59")}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const dailySales = {};
    for (const row of cashFlow) {
      dailySales[row.day] = {
        day: row.day.toISOString().slice(0, 10),
        orderCount: Number(row.orderCount),
        totalSales: Number(row.totalSales),
      };
    }
    const dailyExpenses = {};
    for (const row of cashExpenses) {
      dailySales[row.day] = dailySales[row.day] || { day: row.day.toISOString().slice(0, 10), orderCount: 0, totalSales: 0 };
      dailySales[row.day].totalExpenses = Number(row.totalExpenses);
    }

    const rows = Object.values(dailySales).map((d) => ({
      ...d,
      totalExpenses: d.totalExpenses || 0,
      netCash: (d.totalSales || 0) - (d.totalExpenses || 0),
    }));

    const totalSales = rows.reduce((s, r) => s + r.totalSales, 0);
    const totalExpenses = rows.reduce((s, r) => s + r.totalExpenses, 0);
    const netCash = totalSales - totalExpenses;

    return c.json({
      success: true,
      data: {
        report: {
          outletId, startDate, endDate, generatedAt: new Date().toISOString(),
          summary: {
            totalSales: new Intl.NumberFormat("id-ID", { style: "decimal" }).format(totalSales),
            totalExpenses: new Intl.NumberFormat("id-ID", { style: "decimal" }).format(totalExpenses),
            netCash: new Intl.NumberFormat("id-ID", { style: "decimal" }).format(netCash),
            orderCount: rows.reduce((s, r) => s + r.orderCount, 0),
          },
          dailyRows: rows,
        },
        format,
        download: {
          filename: `cashflow-${startDate}-${endDate}.${format.toLowerCase()}`,
          mimetype: `text/${format.toLowerCase() === "csv" ? "csv" : "octet-stream"}`,
          content: format.toUpperCase() === "CSV"
            ? [["Day", "Order Count", "Total Sales", "Total Expenses", "Net Cash"].join(",")]
                .concat(rows.map((r) => [r.day, r.orderCount, r.totalSales.toFixed(2), r.totalExpenses.toFixed(2), r.netCash.toFixed(2)].join(",")))
            : JSON.stringify(rows, null, 2),
        },
      },
    });
  });

  // Stock transfer report
  routes.get("/:outletId/reports/stock-transfer", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId);

    const format = c.req.query("format") || "CSV";
    const status = c.req.query("status");
    const transfers = await prisma.outletStockTransfer.findMany({
      where: { outletId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
    });

    return c.json({
      success: true,
      data: {
        report: {
          outletId, status, generatedAt: new Date().toISOString(),
          count: transfers.length,
          transfers: transfers.map((t) => ({
            id: t.id, fromOutletId: t.fromOutletId, toOutletId: t.toOutletId,
            status: t.status, itemIds: t.itemIds, quantities: t.quantities,
            totalQuantity: t.totalQuantity, notes: t.notes,
            requestedAt: t.requestedAt.toISOString(), approvedAt: t.approvedAt?.toISOString() || null,
            cancelledAt: t.cancelledAt?.toISOString() || null,
          })),
        },
        format,
        download: {
          filename: `stock-transfer-${status || "all"}.${format.toLowerCase()}`,
          mimetype: `text/${format.toLowerCase() === "csv" ? "csv" : "octet-stream"}`,
          content: format.toUpperCase() === "CSV"
            ? [["ID", "From Outlet", "To Outlet", "Status", "Items", "Qty", "Notes", "Requested", "Approved"].join(",")]
                .concat(transfers.map((t) => [t.id, t.fromOutletId, t.toOutletId, t.status, t.itemIds.join(";"), t.quantities.join(";"), t.notes || "", t.requestedAt.slice(0, 10), t.approvedAt?.slice(0, 10) || ""]))
            : JSON.stringify(transfers, null, 2),
        },
      },
    });
  });

  return routes;
}
