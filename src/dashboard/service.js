import { Prisma } from "@prisma/client";
import { DashboardError } from "./errors.js";
import {
  getTodayInJakarta,
  getCurrentMonthInJakarta,
  getDailyRange,
} from "../reports/service.js";

export async function getDashboardData({
  prisma,
  outletId,
  now = new Date(),
}) {
  const currentDate = now instanceof Function ? now() : now;
  const todayStr = getTodayInJakarta(currentDate);
  const currentMonthStr = getCurrentMonthInJakarta(currentDate);
  const { start: todayStart, end: todayEnd } = getDailyRange(todayStr);

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, name: true, code: true, isActive: true },
  });

  if (!outlet) {
    throw new DashboardError("NOT_FOUND", 404, "Outlet tidak ditemukan.");
  }

  // 1. Orders today
  const ordersToday = await prisma.order.findMany({
    where: {
      outletId,
      status: "COMPLETED",
      createdAt: {
        gte: todayStart,
        lt: todayEnd,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  let totalSales = new Prisma.Decimal("0.00");
  let cashSales = new Prisma.Decimal("0.00");
  let cashCount = 0;
  let qrisSales = new Prisma.Decimal("0.00");
  let qrisCount = 0;
  let qrisPendingCount = 0;

  for (const order of ordersToday) {
    const total = new Prisma.Decimal(order.total.toString());
    totalSales = totalSales.add(total);

    if (order.paymentMethod === "CASH") {
      cashSales = cashSales.add(total);
      cashCount += 1;
    } else if (order.paymentMethod === "QRIS") {
      qrisSales = qrisSales.add(total);
      qrisCount += 1;
      if (order.paymentStatus === "PENDING_RECONCILIATION") {
        qrisPendingCount += 1;
      }
    }
  }

  // 2. Expenses today
  const expensesToday = await prisma.expense.findMany({
    where: {
      outletId,
      status: "ACTIVE",
      expenseDate: {
        gte: todayStart,
        lt: todayEnd,
      },
    },
    include: {
      category: { select: { id: true, name: true } },
    },
  });

  let totalExpenses = new Prisma.Decimal("0.00");
  for (const exp of expensesToday) {
    totalExpenses = totalExpenses.add(new Prisma.Decimal(exp.amount.toString()));
  }

  const netBalance = totalSales.sub(totalExpenses);

  // 3. Stock Summary & Low Stock Alerts
  const [items, balances] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.outletStock.findMany({
      where: { outletId, inventoryItem: { isActive: true } },
      select: { inventoryItemId: true, quantity: true },
    }),
  ]);

  const balanceByItem = new Map(
    balances.map((b) => [b.inventoryItemId, b.quantity.toString()]),
  );

  const stockList = items.map((item) => {
    const qtyStr = balanceByItem.get(item.id) ?? "0";
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      quantity: qtyStr,
      numericQuantity: Number(qtyStr),
    };
  });

  const lowStockItems = stockList
    .filter((s) => s.numericQuantity <= 5)
    .sort((a, b) => a.numericQuantity - b.numericQuantity)
    .slice(0, 5)
    .map(({ id, name, unit, quantity }) => ({ id, name, unit, quantity }));

  // 4. Waste Summary today
  const wasteToday = await prisma.wasteRecord.findMany({
    where: {
      outletId,
      wasteDate: {
        gte: todayStart,
        lt: todayEnd,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  let totalWasteQty = new Prisma.Decimal("0.000");
  for (const w of wasteToday) {
    totalWasteQty = totalWasteQty.add(new Prisma.Decimal(w.quantity.toString()));
  }

  // 5. Closing Status (Today & This Month)
  const [dailyClosing, monthlyClosing] = await Promise.all([
    prisma.closingRecord.findUnique({
      where: {
        outletId_closingType_periodKey: {
          outletId,
          closingType: "DAILY",
          periodKey: todayStr,
        },
      },
      include: {
        closedBy: { select: { id: true, name: true } },
        reopenedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.closingRecord.findUnique({
      where: {
        outletId_closingType_periodKey: {
          outletId,
          closingType: "MONTHLY",
          periodKey: currentMonthStr,
        },
      },
      include: {
        closedBy: { select: { id: true, name: true } },
        reopenedBy: { select: { id: true, name: true } },
      },
    }),
  ]);

  // 6. Recent Activities Stream
  const [recentOrders, recentExpenses, recentStockRequests, recentClosings] =
    await Promise.all([
      prisma.order.findMany({
        where: { outletId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { crew: { select: { id: true, name: true } } },
      }),
      prisma.expense.findMany({
        where: { outletId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          category: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.outletStockRequest.findMany({
        where: { outletId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { requestedBy: { select: { id: true, name: true } } },
      }),
      prisma.closingRecord.findMany({
        where: { outletId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: { closedBy: { select: { id: true, name: true } } },
      }),
    ]);

  const activities = [
    ...recentOrders.map((o) => ({
      id: `ord-${o.id}`,
      type: "ORDER",
      title: `Pesanan ${o.orderNumber}`,
      subtitle: `${o.paymentMethod} · Rp ${new Prisma.Decimal(o.total.toString()).toFixed(2)}`,
      status: o.status,
      actor: o.crew?.name || "Crew",
      timestamp: o.createdAt.toISOString(),
    })),
    ...recentExpenses.map((e) => ({
      id: `exp-${e.id}`,
      type: "EXPENSE",
      title: `Pengeluaran ${e.category?.name || "Operasional"}`,
      subtitle: `Rp ${new Prisma.Decimal(e.amount.toString()).toFixed(2)}`,
      status: e.status,
      actor: e.createdBy?.name || "Staff",
      timestamp: e.createdAt.toISOString(),
    })),
    ...recentStockRequests.map((r) => ({
      id: `req-${r.id}`,
      type: "STOCK_REQUEST",
      title: `Permintaan Stok Internal`,
      subtitle: `Status: ${r.status}`,
      status: r.status,
      actor: r.requestedBy?.name || "Staff",
      timestamp: r.createdAt.toISOString(),
    })),
    ...recentClosings.map((c) => ({
      id: `cls-${c.id}`,
      type: "CLOSING",
      title: `Closing ${c.closingType === "DAILY" ? "Harian" : "Bulanan"} ${c.periodKey}`,
      subtitle: `Status: ${c.status} (v${c.version})`,
      status: c.status,
      actor: c.closedBy?.name || "Manager",
      timestamp: c.updatedAt.toISOString(),
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  return {
    outlet: {
      id: outlet.id,
      name: outlet.name,
      code: outlet.code,
    },
    today: todayStr,
    currentMonth: currentMonthStr,
    sales: {
      totalIncome: totalSales.toFixed(2),
      transactionCount: ordersToday.length,
      cash: {
        count: cashCount,
        total: cashSales.toFixed(2),
      },
      qris: {
        count: qrisCount,
        total: qrisSales.toFixed(2),
        pendingReconciliationCount: qrisPendingCount,
      },
    },
    expenses: {
      totalExpense: totalExpenses.toFixed(2),
      expenseCount: expensesToday.length,
    },
    netBalance: netBalance.toFixed(2),
    stock: {
      totalItems: items.length,
      lowStockCount: lowStockItems.length,
      lowStockItems,
    },
    waste: {
      todayCount: wasteToday.length,
      todayQuantity: totalWasteQty.toFixed(3),
    },
    closingStatus: {
      daily: {
        periodKey: todayStr,
        status: dailyClosing?.status || "OPEN",
        version: dailyClosing?.version ?? 0,
        closedAt: dailyClosing?.closedAt?.toISOString() ?? null,
        closedBy: dailyClosing?.closedBy?.name ?? null,
      },
      monthly: {
        periodKey: currentMonthStr,
        status: monthlyClosing?.status || "OPEN",
        version: monthlyClosing?.version ?? 0,
        closedAt: monthlyClosing?.closedAt?.toISOString() ?? null,
        closedBy: monthlyClosing?.closedBy?.name ?? null,
      },
    },
    activities,
  };
}

