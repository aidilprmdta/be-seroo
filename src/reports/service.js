import { Prisma } from "@prisma/client";
import { ReportError } from "./errors.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-\d{2}$/;
const JAKARTA_TZ = "Asia/Jakarta";

export function getTodayInJakarta(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function getCurrentMonthInJakarta(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TZ,
    year: "numeric",
    month: "2-digit",
  }).format(now);
}

export function toJakartaDateString(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getDailyRange(dateStr) {
  if (!dateStr || !DATE_REGEX.test(dateStr)) {
    throw new ReportError(
      "VALIDATION_ERROR",
      400,
      "Format tanggal tidak valid. Gunakan format YYYY-MM-DD.",
    );
  }

  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ReportError(
      "VALIDATION_ERROR",
      400,
      "Tanggal yang dimasukkan tidak valid.",
    );
  }

  const start = new Date(`${dateStr}T00:00:00.000+07:00`);
  if (isNaN(start.getTime())) {
    throw new ReportError(
      "VALIDATION_ERROR",
      400,
      "Tanggal yang dimasukkan tidak valid.",
    );
  }

  // 24 hours in milliseconds (Asia/Jakarta has no DST, fixed +07:00 offset)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end, dateStr };
}

export function getMonthlyRange(monthStr) {
  if (!monthStr || !MONTH_REGEX.test(monthStr)) {
    throw new ReportError(
      "VALIDATION_ERROR",
      400,
      "Format bulan tidak valid. Gunakan format YYYY-MM.",
    );
  }

  const [yearStr, monthNumStr] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10);

  if (month < 1 || month > 12) {
    throw new ReportError(
      "VALIDATION_ERROR",
      400,
      "Bulan yang dimasukkan tidak valid.",
    );
  }

  const startMonthStr = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthStr = `${nextYear.toString().padStart(4, "0")}-${nextMonth.toString().padStart(2, "0")}-01`;

  const start = new Date(`${startMonthStr}T00:00:00.000+07:00`);
  const end = new Date(`${nextMonthStr}T00:00:00.000+07:00`);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ReportError(
      "VALIDATION_ERROR",
      400,
      "Bulan yang dimasukkan tidak valid.",
    );
  }

  return { start, end, monthStr };
}

function aggregateReportData(orders, expenses) {
  let totalSales = new Prisma.Decimal("0.00");
  let cashSales = new Prisma.Decimal("0.00");
  let cashCount = 0;
  let qrisSales = new Prisma.Decimal("0.00");
  let qrisCount = 0;
  let qrisRecordedSales = new Prisma.Decimal("0.00");
  let qrisRecordedCount = 0;
  let qrisPendingSales = new Prisma.Decimal("0.00");
  let qrisPendingCount = 0;

  const productSalesMap = new Map();

  for (const order of orders) {
    const orderTotal = new Prisma.Decimal(order.total.toString());
    totalSales = totalSales.add(orderTotal);

    if (Array.isArray(order.payments) && order.payments.length > 0) {
      for (const p of order.payments) {
        const pAmt = new Prisma.Decimal(p.amount.toString());
        if (p.paymentMethod === "CASH") {
          cashSales = cashSales.add(pAmt);
          cashCount += 1;
        } else if (p.paymentMethod === "QRIS") {
          qrisSales = qrisSales.add(pAmt);
          qrisCount += 1;

          if (p.paymentStatus === "RECORDED" || p.paymentStatus === "LUNAS") {
            qrisRecordedSales = qrisRecordedSales.add(pAmt);
            qrisRecordedCount += 1;
          } else {
            qrisPendingSales = qrisPendingSales.add(pAmt);
            qrisPendingCount += 1;
          }
        }
      }
    } else {
      if (order.paymentMethod === "CASH") {
        cashSales = cashSales.add(orderTotal);
        cashCount += 1;
      } else if (order.paymentMethod === "QRIS") {
        qrisSales = qrisSales.add(orderTotal);
        qrisCount += 1;

        if (order.paymentStatus === "RECORDED" || order.paymentStatus === "LUNAS") {
          qrisRecordedSales = qrisRecordedSales.add(orderTotal);
          qrisRecordedCount += 1;
        } else {
          qrisPendingSales = qrisPendingSales.add(orderTotal);
          qrisPendingCount += 1;
        }
      }
    }

    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        const key = `${item.productName}__${item.variantName}`;
        const existing = productSalesMap.get(key) || {
          productVariantId: item.productVariantId,
          productName: item.productName,
          variantName: item.variantName,
          quantity: 0,
          total: new Prisma.Decimal("0.00"),
        };
        existing.quantity += item.quantity;
        existing.total = existing.total.add(new Prisma.Decimal(item.subtotal.toString()));
        productSalesMap.set(key, existing);
      }
    }
  }

  const productSales = Array.from(productSalesMap.values())
    .map((item) => ({
      productVariantId: item.productVariantId,
      productName: item.productName,
      variantName: item.variantName,
      quantity: item.quantity,
      total: item.total.toFixed(2),
    }))
    .sort((a, b) => b.quantity - a.quantity || Number(b.total) - Number(a.total));

  let totalExpense = new Prisma.Decimal("0.00");
  const categoryMap = new Map();

  for (const exp of expenses) {
    const amount = new Prisma.Decimal(exp.amount.toString());
    totalExpense = totalExpense.add(amount);

    const categoryId = exp.categoryId;
    const categoryName = exp.category?.name || "Lain-lain";
    const existing = categoryMap.get(categoryId) || {
      categoryId,
      categoryName,
      count: 0,
      total: new Prisma.Decimal("0.00"),
    };
    existing.count += 1;
    existing.total = existing.total.add(amount);
    categoryMap.set(categoryId, existing);
  }

  const categories = Array.from(categoryMap.values())
    .map((cat) => ({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      count: cat.count,
      total: cat.total.toFixed(2),
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  const netBalance = totalSales.sub(totalExpense);

  return {
    summary: {
      totalIncome: totalSales.toFixed(2),
      totalExpense: totalExpense.toFixed(2),
      netBalance: netBalance.toFixed(2),
      transactionCount: orders.length,
      expenseCount: expenses.length,
    },
    paymentSummary: {
      cash: {
        count: cashCount,
        total: cashSales.toFixed(2),
      },
      qris: {
        count: qrisCount,
        total: qrisSales.toFixed(2),
        recorded: {
          count: qrisRecordedCount,
          total: qrisRecordedSales.toFixed(2),
        },
        pendingReconciliation: {
          count: qrisPendingCount,
          total: qrisPendingSales.toFixed(2),
        },
      },
    },
    productSales,
    expenseSummary: {
      total: totalExpense.toFixed(2),
      count: expenses.length,
      categories,
    },
  };
}

export async function getDailyReport({ prisma, outletId, dateStr, now = new Date() }) {
  const effectiveDate = dateStr || getTodayInJakarta(now);
  const { start, end, dateStr: validatedDate } = getDailyRange(effectiveDate);

  const [orders, expenses] = await Promise.all([
    prisma.order.findMany({
      where: {
        outletId,
        status: "COMPLETED",
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      include: {
        items: {
          include: {
            addOns: true,
          },
        },
        payments: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expense.findMany({
      where: {
        outletId,
        status: "ACTIVE",
        expenseDate: {
          gte: start,
          lt: end,
        },
      },
      include: {
        category: { select: { id: true, name: true } },
      },
      orderBy: { expenseDate: "asc" },
    }),
  ]);

  const aggregates = aggregateReportData(orders, expenses);

  return {
    outletId,
    period: {
      type: "DAILY",
      date: validatedDate,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      timezone: JAKARTA_TZ,
    },
    ...aggregates,
  };
}

export async function getMonthlyReport({ prisma, outletId, monthStr, now = new Date() }) {
  const effectiveMonth = monthStr || getCurrentMonthInJakarta(now);
  const { start, end, monthStr: validatedMonth } = getMonthlyRange(effectiveMonth);

  const [orders, expenses] = await Promise.all([
    prisma.order.findMany({
      where: {
        outletId,
        status: "COMPLETED",
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      include: {
        items: {
          include: {
            addOns: true,
          },
        },
        payments: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expense.findMany({
      where: {
        outletId,
        status: "ACTIVE",
        expenseDate: {
          gte: start,
          lt: end,
        },
      },
      include: {
        category: { select: { id: true, name: true } },
      },
      orderBy: { expenseDate: "asc" },
    }),
  ]);

  const aggregates = aggregateReportData(orders, expenses);

  // Daily breakdown
  const dailyMap = new Map();

  for (const order of orders) {
    const dayKey = toJakartaDateString(order.createdAt);
    const existing = dailyMap.get(dayKey) || {
      date: dayKey,
      transactionCount: 0,
      totalIncome: new Prisma.Decimal("0.00"),
      totalExpense: new Prisma.Decimal("0.00"),
    };
    existing.transactionCount += 1;
    existing.totalIncome = existing.totalIncome.add(new Prisma.Decimal(order.total.toString()));
    dailyMap.set(dayKey, existing);
  }

  for (const exp of expenses) {
    const dayKey = toJakartaDateString(exp.expenseDate);
    const existing = dailyMap.get(dayKey) || {
      date: dayKey,
      transactionCount: 0,
      totalIncome: new Prisma.Decimal("0.00"),
      totalExpense: new Prisma.Decimal("0.00"),
    };
    existing.totalExpense = existing.totalExpense.add(new Prisma.Decimal(exp.amount.toString()));
    dailyMap.set(dayKey, existing);
  }

  const dailyBreakdown = Array.from(dailyMap.values())
    .map((day) => ({
      date: day.date,
      transactionCount: day.transactionCount,
      totalIncome: day.totalIncome.toFixed(2),
      totalExpense: day.totalExpense.toFixed(2),
      netBalance: day.totalIncome.sub(day.totalExpense).toFixed(2),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    outletId,
    period: {
      type: "MONTHLY",
      month: validatedMonth,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      timezone: JAKARTA_TZ,
    },
    ...aggregates,
    dailyBreakdown,
  };
}
