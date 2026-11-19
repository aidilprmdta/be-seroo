import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { writeAuditLog } from "../audit/service.js";
import { toJakartaDateString } from "../reports/service.js";
import { PosError } from "./errors.js";

const ORDER_INCLUDE = {
  items: {
    include: { addOns: true },
  },
  payments: true,
  statusHistory: {
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  },
  cancelledBy: { select: { id: true, name: true } },
};

const decimalString = z
  .string()
  .max(13)
  .regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/);

const addOnSchema = z
  .object({
    addOnId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(10),
    expectedUnitPrice: decimalString,
  })
  .strict();

const orderItemSchema = z
  .object({
    productVariantId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(99),
    expectedVariantPrice: decimalString,
    addOns: z.array(addOnSchema).max(20).default([]),
  })
  .strict()
  .superRefine((item, context) => {
    const ids = item.addOns.map((addOn) => addOn.addOnId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Add-on tidak boleh diduplikasi pada satu item.",
      });
    }
  });

const paymentLineSchema = z
  .object({
    paymentMethod: z.enum(["CASH", "QRIS"]),
    amount: decimalString,
  })
  .strict();

const orderSchema = z
  .object({
    clientTransactionId: z.string().uuid(),
    recordedOffline: z.boolean().default(false),
    paymentMethod: z.enum(["CASH", "QRIS", "SPLIT"]).optional(),
    payments: z.array(paymentLineSchema).min(1).max(10).optional(),
    items: z.array(orderItemSchema).min(1).max(50),
  })
  .strict()
  .superRefine((data, context) => {
    if (!data.paymentMethod && (!data.payments || data.payments.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Pilih minimal satu metode pembayaran.",
      });
    }
  });

function readBody(value) {
  const parsed = orderSchema.safeParse(value);
  if (!parsed.success) {
    throw new PosError(
      "VALIDATION_ERROR",
      400,
      "Periksa kembali item dan metode pembayaran.",
    );
  }
  return parsed.data;
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new PosError(
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
    throw new PosError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
  }
}

async function requireCrewMembership(prisma, userId, outletId) {
  const membership = await prisma.outletMembership.findUnique({
    where: {
      userId_outletId: { userId, outletId },
    },
    include: {
      outlet: { select: { isActive: true } },
    },
  });

  if (
    !membership ||
    membership.role !== "CREW" ||
    !membership.outlet?.isActive
  ) {
    throw new PosError(
      "FORBIDDEN",
      403,
      "Akses ke outlet atau tindakan ini tidak diizinkan.",
    );
  }
}

async function requireCrewOrManagerMembership(prisma, userId, outletId) {
  const membership = await prisma.outletMembership.findUnique({
    where: {
      userId_outletId: { userId, outletId },
    },
    include: {
      outlet: { select: { isActive: true } },
    },
  });

  if (
    !membership ||
    (membership.role !== "CREW" && membership.role !== "MANAGER") ||
    !membership.outlet?.isActive
  ) {
    throw new PosError(
      "FORBIDDEN",
      403,
      "Akses ke outlet atau tindakan ini tidak diizinkan.",
    );
  }
  return membership;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
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

function idempotencyWhere({ outletId, crewId, clientTransactionId }) {
  return {
    outletId_crewId_clientTransactionId: {
      outletId,
      crewId,
      clientTransactionId,
    },
  };
}

function orderDto(order) {
  const paymentList = Array.isArray(order.payments)
    ? order.payments
    : Array.isArray(order.payments?.create)
      ? order.payments.create
      : [];

  return {
    id: order.id,
    clientTransactionId: order.clientTransactionId,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    verifiedAt: order.verifiedAt
      ? order.verifiedAt instanceof Date
        ? order.verifiedAt.toISOString()
        : order.verifiedAt
      : null,
    verifiedById: order.verifiedById ?? null,
    cancelledAt: order.cancelledAt
      ? order.cancelledAt instanceof Date
        ? order.cancelledAt.toISOString()
        : order.cancelledAt
      : null,
    cancelledById: order.cancelledById ?? null,
    cancelledBy: order.cancelledBy ?? null,
    cancellationReason: order.cancellationReason ?? null,
    isWasteRecorded: Boolean(order.isWasteRecorded),
    subtotal: order.subtotal.toString(),
    total: order.total.toString(),
    createdAt:
      order.createdAt instanceof Date
        ? order.createdAt.toISOString()
        : order.createdAt,
    items: (order.items || []).map((item) => ({
      id: item.id,
      productVariantId: item.productVariantId,
      productName: item.productName,
      variantName: item.variantName,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      subtotal: item.subtotal.toString(),
      addOns: (item.addOns || []).map((addOn) => ({
        addOnId: addOn.addOnId,
        name: addOn.addOnName,
        quantity: addOn.quantity,
        unitPrice: addOn.unitPrice.toString(),
      })),
    })),
    payments: paymentList.map((payment, idx) => ({
      id: payment.id || `pay-${idx + 1}`,
      paymentMethod: payment.paymentMethod,
      amount: payment.amount.toString(),
      paymentStatus: payment.paymentStatus,
      verifiedAt: payment.verifiedAt
        ? payment.verifiedAt instanceof Date
          ? payment.verifiedAt.toISOString()
          : payment.verifiedAt
        : null,
      verifiedById: payment.verifiedById ?? null,
      notes: payment.notes ?? null,
    })),
    statusHistory: (order.statusHistory || []).map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      reason: h.reason ?? null,
      actorId: h.actorId,
      actorName: h.actor?.name ?? null,
      createdAt:
        h.createdAt instanceof Date
          ? h.createdAt.toISOString()
          : h.createdAt,
    })),
  };
}

function existingOrderResult(order, payloadDigest) {
  if (order.payloadHash !== payloadDigest) {
    throw new PosError(
      "IDEMPOTENCY_KEY_REUSED",
      409,
      "ID transaksi sudah digunakan dengan isi yang berbeda.",
    );
  }
  return order;
}

function asDecimal(value) {
  return new Prisma.Decimal(value.toString());
}

function assertOfflinePricesMatch(payload, variants, addOns) {
  for (const item of payload.items) {
    const variant = variants.get(item.productVariantId);
    if (!asDecimal(item.expectedVariantPrice).equals(variant.price)) {
      throw new PosError(
        "PRICE_CHANGED",
        409,
        "Harga katalog berubah. Periksa kembali keranjang sebelum mengirim.",
      );
    }

    for (const selection of item.addOns) {
      const addOn = addOns.get(selection.addOnId);
      if (!asDecimal(selection.expectedUnitPrice).equals(addOn.price)) {
        throw new PosError(
          "PRICE_CHANGED",
          409,
          "Harga katalog berubah. Periksa kembali keranjang sebelum mengirim.",
        );
      }
    }
  }
}

async function createOrder({
  prisma,
  outletId,
  crewId,
  payload,
  now,
  orderNumberFactory,
}) {
  const payloadDigest = hashPayload(payload);
  const uniqueWhere = idempotencyWhere({
    outletId,
    crewId,
    clientTransactionId: payload.clientTransactionId,
  });
  const existing = await prisma.order.findUnique({
    where: uniqueWhere,
    include: ORDER_INCLUDE,
  });
  if (existing) {
    return { order: existingOrderResult(existing, payloadDigest), replayed: true };
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      const transactionExisting = await tx.order.findUnique({
        where: uniqueWhere,
        include: ORDER_INCLUDE,
      });
      if (transactionExisting) {
        return existingOrderResult(transactionExisting, payloadDigest);
      }

      const variantIds = [...new Set(payload.items.map((item) => item.productVariantId))];
      const variantsResult = await tx.productVariant.findMany({
        where: {
          id: { in: variantIds },
          isActive: true,
          product: { isActive: true },
        },
        include: { product: { select: { id: true, name: true, isActive: true } } },
      });
      const variants = new Map(variantsResult.map((item) => [item.id, item]));
      if (variants.size !== variantIds.length) {
        throw new PosError(
          "CATALOG_ITEM_UNAVAILABLE",
          409,
          "Produk atau varian sudah tidak tersedia. Muat ulang katalog.",
        );
      }

      // Validasi ketersediaan menu per outlet (OutletProductAvailability)
      if (tx.outletProductAvailability?.findMany) {
        const productIds = [...new Set(variantsResult.map((v) => v.product.id))];
        const availabilities = await tx.outletProductAvailability.findMany({
          where: {
            outletId,
            productId: { in: productIds },
            isAvailable: true,
          },
          select: { productId: true },
        });
        const availableProductIds = new Set(availabilities.map((a) => a.productId));
        const unavailableVariant = variantsResult.find(
          (v) => !availableProductIds.has(v.product.id),
        );
        if (unavailableVariant) {
          throw new PosError(
            "CATALOG_ITEM_UNAVAILABLE",
            409,
            `Produk "${unavailableVariant.product.name}" tidak tersedia di outlet ini. Muat ulang katalog.`,
          );
        }
      }

      const addOnIds = [
        ...new Set(payload.items.flatMap((item) => item.addOns.map((addOn) => addOn.addOnId))),
      ];
      const addOnsResult = addOnIds.length
        ? await tx.addOn.findMany({
            where: { id: { in: addOnIds }, isActive: true },
          })
        : [];
      const addOns = new Map(addOnsResult.map((item) => [item.id, item]));
      if (addOns.size !== addOnIds.length) {
        throw new PosError(
          "CATALOG_ITEM_UNAVAILABLE",
          409,
          "Add-on sudah tidak tersedia. Muat ulang katalog.",
        );
      }

      if (payload.recordedOffline) {
        assertOfflinePricesMatch(payload, variants, addOns);
      }

      let total = new Prisma.Decimal(0);
      const items = payload.items.map((item) => {
        const variant = variants.get(item.productVariantId);
        const addOnSelections = item.addOns.map((selection) => {
          const addOn = addOns.get(selection.addOnId);
          if (addOn.price.lt(0)) {
            throw new PosError(
              "CATALOG_ITEM_UNAVAILABLE",
              409,
              "Harga katalog tidak valid. Hubungi pengelola.",
            );
          }
          return {
            addOnId: addOn.id,
            addOnName: addOn.name,
            quantity: selection.quantity,
            unitPrice: addOn.price,
          };
        });

        if (variant.price.lt(0)) {
          throw new PosError(
            "CATALOG_ITEM_UNAVAILABLE",
            409,
            "Harga katalog tidak valid. Hubungi pengelola.",
          );
        }

        const perUnit = addOnSelections.reduce(
          (lineTotal, addOn) =>
            lineTotal.add(addOn.unitPrice.mul(addOn.quantity)),
          variant.price,
        );
        const lineSubtotal = perUnit.mul(item.quantity);
        total = total.add(lineSubtotal);

        return {
          productVariantId: variant.id,
          productName: variant.product.name,
          variantName: variant.name,
          quantity: item.quantity,
          unitPrice: variant.price,
          subtotal: lineSubtotal,
          addOns: { create: addOnSelections },
        };
      });

      // Validate or construct payment lines
      let paymentRecords = [];
      let primaryPaymentMethod = payload.paymentMethod;

      if (Array.isArray(payload.payments) && payload.payments.length > 0) {
        let totalPaid = new Prisma.Decimal(0);
        for (const p of payload.payments) {
          const amt = new Prisma.Decimal(p.amount);
          if (amt.lte(0)) {
            throw new PosError(
              "VALIDATION_ERROR",
              400,
              "Nominal pembayaran harus lebih besar dari 0.",
            );
          }
          totalPaid = totalPaid.add(amt);
          paymentRecords.push({
            paymentMethod: p.paymentMethod,
            amount: amt,
            paymentStatus:
              p.paymentMethod === "QRIS"
                ? "PENDING_RECONCILIATION"
                : "LUNAS",
          });
        }

        if (!totalPaid.equals(total)) {
          if (totalPaid.lt(total)) {
            const diff = total.sub(totalPaid);
            throw new PosError(
              "PAYMENT_AMOUNT_MISMATCH",
              400,
              `Jumlah pembayaran (Rp ${totalPaid}) kurang dari total transaksi (Rp ${total}). Kurang Rp ${diff}. Status: belum lunas.`,
            );
          } else {
            const diff = totalPaid.sub(total);
            throw new PosError(
              "PAYMENT_AMOUNT_MISMATCH",
              400,
              `Jumlah pembayaran (Rp ${totalPaid}) melebihi total transaksi (Rp ${total}). Lebih Rp ${diff}.`,
            );
          }
        }

        const methods = [...new Set(paymentRecords.map((p) => p.paymentMethod))];
        primaryPaymentMethod = methods.length > 1 ? "SPLIT" : methods[0];
      } else {
        primaryPaymentMethod = payload.paymentMethod || "CASH";
        paymentRecords.push({
          paymentMethod: primaryPaymentMethod,
          amount: total,
          paymentStatus:
            primaryPaymentMethod === "QRIS"
              ? "PENDING_RECONCILIATION"
              : "LUNAS",
        });
      }

      const hasPendingPayment = paymentRecords.some(
        (p) =>
          p.paymentStatus === "PENDING_RECONCILIATION" ||
          p.paymentStatus === "BELUM_LUNAS",
      );
      const overallPaymentStatus = hasPendingPayment
        ? "PENDING_RECONCILIATION"
        : "LUNAS";

      const createdAt = now();
      const order = await tx.order.create({
        data: {
          outletId,
          crewId,
          orderNumber: orderNumberFactory(),
          clientTransactionId: payload.clientTransactionId,
          payloadHash: payloadDigest,
          status: "COMPLETED",
          paymentMethod: primaryPaymentMethod,
          paymentStatus: overallPaymentStatus,
          subtotal: total,
          total,
          createdAt,
          completedAt: createdAt,
          items: {
            create: items,
          },
          payments: {
            create: paymentRecords,
          },
        },
        include: ORDER_INCLUDE,
      });

      if (tx.orderStatusHistory?.create) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: "COMPLETED",
            toStatus: "COMPLETED",
            reason: "Pesanan selesai dibuat",
            actorId: crewId,
            createdAt,
          },
        });
      }

            // Tidak ada pengurangan stok otomatis karena MVP
      // tidak menggunakan sistem resep.
      return order;
    });

    return { order, replayed: false };
  } catch (error) {
    if (error?.code !== "P2002") {
      throw error;
    }

    const racedOrder = await prisma.order.findUnique({
      where: uniqueWhere,
      include: ORDER_INCLUDE,
    });

    if (!racedOrder) {
      throw error;
    }

    return {
      order: existingOrderResult(racedOrder, payloadDigest),
      replayed: true,
    };
  }
}

export function createPosRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  orderNumberFactory = randomUUID,
}) {
  const routes = new Hono();
  const authenticate = createAuthenticationMiddleware({
    prisma,
    accessTokenSecret,
    now,
  });

  routes.get("/:outletId/catalog", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireCrewMembership(prisma, auth.userId, outletId);

    const productWhere = {
      isActive: true,
      variants: { some: { isActive: true } },
    };

    if (prisma.outletProductAvailability?.findMany) {
      productWhere.outletAvailabilities = {
        some: {
          outletId,
          isAvailable: true,
        },
      };
    }

    const [products, addOns] = await Promise.all([
      prisma.product.findMany({
        where: productWhere,
        select: {
          id: true,
          name: true,
          category: true,
          variants: {
            where: { isActive: true },
            select: { id: true, name: true, price: true },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.addOn.findMany({
        where: { isActive: true },
        select: { id: true, name: true, price: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return c.json({
      success: true,
      data: {
        outletId,
        products: products.map((product) => ({
          ...product,
          variants: product.variants.map((variant) => ({
            ...variant,
            price: variant.price.toString(),
          })),
        })),
        addOns: addOns.map((addOn) => ({
          ...addOn,
          price: addOn.price.toString(),
        })),
      },
    });
  });

  routes.post("/:outletId/orders", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireCrewMembership(prisma, auth.userId, outletId);

    const payload = readBody(await readJson(c));
    const result = await createOrder({
      prisma,
      outletId,
      crewId: auth.userId,
      payload,
      now,
      orderNumberFactory,
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: result.replayed ? "ORDER_REPLAYED" : "ORDER_CREATED",
      resourceType: "Order",
      resourceId: result.order.id,
      metadata: {
        clientTransactionId: payload.clientTransactionId,
        recordedOffline: payload.recordedOffline,
        paymentMethod: result.order.paymentMethod,
        paymentStatus: result.order.paymentStatus,
        replayed: result.replayed,
      },
    });

    return c.json(
      {
        success: true,
        data: {
          order: orderDto(result.order),
          replayed: result.replayed,
        },
      },
      result.replayed ? 200 : 201,
    );
  });

  routes.post("/:outletId/orders/:orderId/verify-qris", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const orderId = c.req.param("orderId");
    assertOutletId(outletId);
    if (!orderId || orderId.length > 64) {
      throw new PosError("VALIDATION_ERROR", 400, "ID transaksi tidak valid.");
    }
    const auth = c.get("auth");
    await requireCrewOrManagerMembership(prisma, auth.userId, outletId);

    let body = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });

    if (!order || order.outletId !== outletId) {
      throw new PosError("ORDER_NOT_FOUND", 404, "Transaksi tidak ditemukan.");
    }

    const payments = order.payments || [];
    const hasQris =
      order.paymentMethod === "QRIS" ||
      payments.some((p) => p.paymentMethod === "QRIS");

    if (!hasQris) {
      throw new PosError(
        "INVALID_PAYMENT_METHOD",
        400,
        "Transaksi ini tidak menggunakan metode QRIS.",
      );
    }

    const pendingPayments = payments.filter(
      (p) => p.paymentMethod === "QRIS" && p.paymentStatus === "PENDING_RECONCILIATION",
    );

    if (pendingPayments.length === 0 && order.paymentStatus === "LUNAS") {
      throw new PosError(
        "PAYMENT_ALREADY_VERIFIED",
        400,
        "Pembayaran QRIS untuk transaksi ini sudah terverifikasi.",
      );
    }

    const verifyTime = now();
    const updatedOrder = await prisma.$transaction(async (tx) => {
      if (pendingPayments.length > 0) {
        for (const p of pendingPayments) {
          await tx.orderPayment.update({
            where: { id: p.id },
            data: {
              paymentStatus: "LUNAS",
              verifiedAt: verifyTime,
              verifiedById: auth.userId,
              notes: body.notes ? (p.notes ? `${p.notes}; ${body.notes}` : body.notes) : p.notes,
            },
          });
        }
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: "LUNAS",
          verifiedAt: verifyTime,
          verifiedById: auth.userId,
        },
        include: ORDER_INCLUDE,
      });
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: "QRIS_VERIFIED",
      resourceType: "Order",
      resourceId: orderId,
      metadata: {
        paymentStatus: "LUNAS",
        verifiedAt: verifyTime.toISOString(),
        notesProvided: Boolean(body.notes),
      },
    });

    return c.json({
      success: true,
      data: {
        order: orderDto(updatedOrder),
        verifiedAt: verifyTime.toISOString(),
        verifiedBy: { id: auth.userId },
      },
    });
  });

  routes.get("/:outletId/orders", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireCrewOrManagerMembership(prisma, auth.userId, outletId);

    const paymentStatus = c.req.query("paymentStatus");
    const orderStatus = c.req.query("status");
    const allowedOrderStatuses = new Set(["COMPLETED", "CANCELLED"]);
    if (orderStatus && !allowedOrderStatuses.has(orderStatus)) {
      throw new PosError("VALIDATION_ERROR", 400, "Status transaksi tidak valid.");
    }
    const allowedPaymentStatuses = new Set([
      "RECORDED",
      "PENDING_RECONCILIATION",
      "BELUM_LUNAS",
      "LUNAS",
      "REFUNDED",
    ]);
    if (paymentStatus && !allowedPaymentStatuses.has(paymentStatus)) {
      throw new PosError("VALIDATION_ERROR", 400, "Status pembayaran tidak valid.");
    }

    const requestedPage = Number.parseInt(c.req.query("page") || "1", 10);
    const requestedPageSize = Number.parseInt(
      c.req.query("pageSize") || c.req.query("limit") || "20",
      10,
    );
    if (
      !Number.isInteger(requestedPage) ||
      requestedPage < 1 ||
      !Number.isInteger(requestedPageSize) ||
      requestedPageSize < 1
    ) {
      throw new PosError("VALIDATION_ERROR", 400, "Pagination tidak valid.");
    }
    const page = requestedPage;
    const pageSize = Math.min(100, requestedPageSize);

    const where = {
      outletId,
      ...(orderStatus ? { status: orderStatus } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
    };

    const orders = await prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return c.json({
      success: true,
      data: {
        orders: orders.map(orderDto),
        pagination: {
          page,
          pageSize,
          hasNextPage: orders.length === pageSize,
        },
      },
    });
  });

  routes.get("/:outletId/orders/:orderId", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const orderId = c.req.param("orderId");
    assertOutletId(outletId);
    if (!orderId || orderId.length > 64) {
      throw new PosError("VALIDATION_ERROR", 400, "ID transaksi tidak valid.");
    }
    const auth = c.get("auth");
    await requireCrewOrManagerMembership(prisma, auth.userId, outletId);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });

    if (!order || order.outletId !== outletId) {
      throw new PosError("ORDER_NOT_FOUND", 404, "Transaksi tidak ditemukan.");
    }

    return c.json({
      success: true,
      data: {
        order: orderDto(order),
      },
    });
  });

  const cancelOrderSchema = z
    .object({
      reason: z
        .string()
        .trim()
        .min(5, "Alasan pembatalan minimal 5 karakter.")
        .max(255, "Alasan pembatalan maksimal 255 karakter."),
      recordWaste: z.boolean().default(true),
      notes: z.string().trim().max(255).optional(),
    });

  routes.post("/:outletId/orders/:orderId/cancel", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const orderId = c.req.param("orderId");
    assertOutletId(outletId);
    if (!orderId || orderId.length > 64) {
      throw new PosError("VALIDATION_ERROR", 400, "ID transaksi tidak valid.");
    }
    const auth = c.get("auth");
    await requireCrewOrManagerMembership(prisma, auth.userId, outletId);

    let body;
    try {
      const raw = await c.req.json();
      body = cancelOrderSchema.parse(raw);
    } catch (err) {
      const message =
        err?.issues?.[0]?.message ||
        "Format data pembatalan pesanan tidak valid.";
      throw new PosError("VALIDATION_ERROR", 400, message);
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { addOns: true },
        },
        payments: true,
      },
    });

    if (!order || order.outletId !== outletId) {
      throw new PosError("ORDER_NOT_FOUND", 404, "Transaksi tidak ditemukan.");
    }

    if (order.status === "CANCELLED") {
      throw new PosError(
        "ORDER_ALREADY_CANCELLED",
        400,
        "Transaksi ini sudah dibatalkan sebelumnya.",
      );
    }

    // Periksa apakah periode transaksi sudah ditutup closing
    if (prisma.closingRecord?.findUnique) {
      const dateStr = toJakartaDateString(order.createdAt);
      const closing = await prisma.closingRecord.findUnique({
        where: {
          outletId_closingType_periodKey: {
            outletId,
            closingType: "DAILY",
            periodKey: dateStr,
          },
        },
      });
      if (closing && closing.status === "CLOSED") {
        throw new PosError(
          "PERIOD_CLOSED",
          400,
          "Periode transaksi ini sudah ditutup closing. Reopen closing terlebih dahulu untuk membatalkan transaksi.",
        );
      }
    }

    const cancelTime = now();
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // 1. Perbarui status setiap pembayaran menjadi REFUNDED
      if (order.payments && order.payments.length > 0) {
        for (const p of order.payments) {
          if (tx.orderPayment?.update) {
            await tx.orderPayment.update({
              where: { id: p.id },
              data: {
                paymentStatus: "REFUNDED",
                notes: p.notes
                  ? `${p.notes}; Dibatalkan: ${body.reason}`
                  : `Dibatalkan: ${body.reason}`,
              },
            });
          }
        }
      }

      // 2. Catat riwayat status perubahan
      if (tx.orderStatusHistory?.create) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: "CANCELLED",
            reason: body.reason,
            actorId: auth.userId,
            createdAt: cancelTime,
          },
        });
      }

      // 3. Update pesanan menjadi CANCELLED & REFUNDED
      const cancelled = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          paymentStatus: "REFUNDED",
          cancelledAt: cancelTime,
          cancelledById: auth.userId,
          cancellationReason: body.reason,
          isWasteRecorded: Boolean(body.recordWaste),
        },
        include: ORDER_INCLUDE,
      });

      // 4. Penanganan Waste vs Pengembalian Stok
      if (body.recordWaste) {
        // Minuman sudah dibuat dan akhirnya terbuang -> Catat WasteRecord
        if (tx.wasteRecord?.create) {
          for (let i = 0; i < (order.items || []).length; i++) {
            const it = order.items[i];
            await tx.wasteRecord.create({
              data: {
                outletId,
                createdById: auth.userId,
                clientTransactionId: `waste:cancel:${order.id}:${it.id || i}`,
                itemName: `${it.productName} - ${it.variantName}`,
                category: "PRODUK_BATAL",
                quantity: new Prisma.Decimal(it.quantity.toString()),
                unit: "cup",
                description: `Pesanan dibatalkan #${order.orderNumber}: ${body.reason}`,
                wasteDate: cancelTime,
                createdAt: cancelTime,
              },
            });
          }
        }
      }
      return cancelled;
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: "ORDER_CANCELLED",
      resourceType: "Order",
      resourceId: order.id,
      metadata: {
        reason: body.reason,
        recordWaste: body.recordWaste,
        paymentStatus: "REFUNDED",
        status: "CANCELLED",
      },
    });

    return c.json({
      success: true,
      data: {
        order: orderDto(updatedOrder),
        cancellation: {
          cancelledAt: cancelTime.toISOString(),
          cancelledBy: { id: auth.userId },
          reason: body.reason,
          recordWaste: body.recordWaste,
        },
      },
    });
  });

  return routes;
}
