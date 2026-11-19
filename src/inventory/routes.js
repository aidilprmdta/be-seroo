import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { writeAuditLog } from "../audit/service.js";
import { InventoryError } from "./errors.js";

const DECIMAL = z
  .string()
  .max(13)
  .regex(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/);
const STOCK_MOVEMENT_INCLUDE = {
  inventoryItem: { select: { id: true, name: true, unit: true } },
  createdBy: { select: { id: true, name: true } },
};
const WASTE_INCLUDE = {
  inventoryItem: { select: { id: true, name: true, unit: true } },
  createdBy: { select: { id: true, name: true } },
};
const STOCK_REQUEST_INCLUDE = {
  items: {
    select: {
      id: true,
      inventoryItemId: true,
      itemName: true,
      unit: true,
      quantity: true,
    },
    orderBy: { itemName: "asc" },
  },
  requestedBy: { select: { id: true, name: true } },
  processedBy: { select: { id: true, name: true } },
};

const stockMovementSchema = z
  .object({
    clientTransactionId: z.string().uuid(),
    inventoryItemId: z.string().min(1).max(64),
    type: z.enum(["IN", "ADJUSTMENT"]),
    direction: z.enum(["INCREASE", "DECREASE"]).optional(),
    quantity: DECIMAL,
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Number(value.quantity) <= 0) {
      context.addIssue({
        code: "custom",
        message: "Jumlah harus lebih dari nol.",
        path: ["quantity"],
      });
    }
    if (value.type === "ADJUSTMENT") {
      if (!value.direction) {
        context.addIssue({
          code: "custom",
          message: "Arah penyesuaian stok wajib dipilih.",
          path: ["direction"],
        });
      }
      if (!value.note) {
        context.addIssue({
          code: "custom",
          message: "Alasan penyesuaian stok wajib diisi.",
          path: ["note"],
        });
      }
    } else if (value.direction) {
      context.addIssue({
        code: "custom",
        message: "Arah hanya berlaku untuk penyesuaian stok.",
        path: ["direction"],
      });
    }
  });

const wasteSchema = z
  .object({
    clientTransactionId: z.string().uuid(),
    inventoryItemId: z.string().min(1).max(64).optional(),
    itemName: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(80),
    quantity: DECIMAL,
    unit: z.string().trim().min(1).max(24),
    description: z.string().trim().max(500).optional(),
    wasteDate: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (Number(value.quantity) <= 0) {
      context.addIssue({
        code: "custom",
        message: "Jumlah waste harus lebih dari nol.",
        path: ["quantity"],
      });
    }
  });

const stockRequestItemSchema = z
  .object({
    inventoryItemId: z.string().min(1).max(64),
    quantity: DECIMAL,
  })
  .strict()
  .superRefine((value, context) => {
    if (Number(value.quantity) <= 0) {
      context.addIssue({
        code: "custom",
        message: "Jumlah permintaan harus lebih dari nol.",
        path: ["quantity"],
      });
    }
  });

const stockRequestSchema = z
  .object({
    clientTransactionId: z.string().uuid(),
    items: z.array(stockRequestItemSchema).min(1).max(50),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const itemIds = value.items.map((item) => item.inventoryItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: "custom",
        message: "Item inventaris tidak boleh diduplikasi.",
        path: ["items"],
      });
    }
  });

const stockRequestDecisionSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    decisionNote: z.string().trim().max(500).optional(),
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

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) {
    throw new InventoryError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
  }
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InventoryError(
        "VALIDATION_ERROR",
        400,
        "Format permintaan tidak valid.",
      );
    }
    throw error;
  }
}

function parseBody(schema, value, message) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new InventoryError("VALIDATION_ERROR", 400, message);
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
    throw new InventoryError(
      "FORBIDDEN",
      403,
      "Akses ke outlet atau tindakan ini tidak diizinkan.",
    );
  }
  return membership.role;
}

function movementWhere({ outletId, userId, clientTransactionId }) {
  return {
    outletId_createdById_clientTransactionId: {
      outletId,
      createdById: userId,
      clientTransactionId,
    },
  };
}

function movementDto(movement) {
  return {
    id: movement.id,
    clientTransactionId: movement.clientTransactionId,
    type: movement.type,
    quantity: movement.quantity.toString(),
    note: movement.note,
    createdAt: movement.createdAt.toISOString(),
    inventoryItem: movement.inventoryItem,
    createdBy: movement.createdBy,
  };
}

function wasteDto(record) {
  return {
    id: record.id,
    clientTransactionId: record.clientTransactionId,
    inventoryItemId: record.inventoryItemId,
    itemName: record.itemName,
    category: record.category,
    quantity: record.quantity.toString(),
    unit: record.unit,
    description: record.description,
    wasteDate: record.wasteDate.toISOString(),
    createdAt: record.createdAt.toISOString(),
    createdBy: record.createdBy,
  };
}

function stockRequestDto(request) {
  return {
    id: request.id,
    clientTransactionId: request.clientTransactionId,
    status: request.status,
    note: request.note,
    decisionNote: request.decisionNote,
    processedAt: request.processedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    requestedBy: request.requestedBy,
    processedBy: request.processedBy,
    items: request.items.map((item) => ({
      id: item.id,
      inventoryItemId: item.inventoryItemId,
      itemName: item.itemName,
      unit: item.unit,
      quantity: item.quantity.toString(),
    })),
  };
}

function assertSamePayload(record, digest, resourceName) {
  if (record.payloadHash !== digest) {
    throw new InventoryError(
      "IDEMPOTENCY_KEY_REUSED",
      409,
      `ID transaksi sudah digunakan dengan isi ${resourceName} yang berbeda.`,
    );
  }
  return record;
}

async function createStockMovement({
  prisma,
  outletId,
  userId,
  payload,
  now,
  movementIdFactory,
}) {
  const digest = hashPayload(payload);
  const uniqueWhere = movementWhere({
    outletId,
    userId,
    clientTransactionId: payload.clientTransactionId,
  });
  const existing = await prisma.stockMovement.findUnique({
    where: uniqueWhere,
    include: STOCK_MOVEMENT_INCLUDE,
  });
  if (existing) {
    return { movement: assertSamePayload(existing, digest, "stok"), replayed: true };
  }

  const delta = new Prisma.Decimal(payload.quantity).mul(
    payload.type === "ADJUSTMENT" && payload.direction === "DECREASE" ? -1 : 1,
  );
  try {
    const movement = await prisma.$transaction(async (tx) => {
      const current = await tx.stockMovement.findUnique({
        where: uniqueWhere,
        include: STOCK_MOVEMENT_INCLUDE,
      });
      if (current) return assertSamePayload(current, digest, "stok");

      const item = await tx.inventoryItem.findUnique({
        where: { id: payload.inventoryItemId },
      });
      if (!item || !item.isActive) {
        throw new InventoryError(
          "INVENTORY_ITEM_UNAVAILABLE",
          409,
          "Item inventaris tidak tersedia.",
        );
      }

      await tx.outletStock.upsert({
        where: {
          outletId_inventoryItemId: {
            outletId,
            inventoryItemId: item.id,
          },
        },
        create: { outletId, inventoryItemId: item.id, quantity: new Prisma.Decimal(0) },
        update: {},
      });

      if (delta.lt(0)) {
        const updated = await tx.outletStock.updateMany({
          where: {
            outletId,
            inventoryItemId: item.id,
            quantity: { gte: delta.abs() },
          },
          data: { quantity: { decrement: delta.abs() } },
        });
        if (updated.count !== 1) {
          throw new InventoryError(
            "INSUFFICIENT_STOCK",
            409,
            "Penyesuaian melebihi stok yang tersedia.",
          );
        }
      } else {
        await tx.outletStock.update({
          where: {
            outletId_inventoryItemId: {
              outletId,
              inventoryItemId: item.id,
            },
          },
          data: { quantity: { increment: delta } },
        });
      }

      return tx.stockMovement.create({
        data: {
          id: movementIdFactory(),
          outletId,
          inventoryItemId: item.id,
          createdById: userId,
          clientTransactionId: payload.clientTransactionId,
          payloadHash: digest,
          type: payload.type,
          quantity: delta,
          note: payload.note ?? null,
          createdAt: now(),
        },
        include: STOCK_MOVEMENT_INCLUDE,
      });
    });
    return { movement, replayed: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const raced = await prisma.stockMovement.findUnique({
      where: uniqueWhere,
      include: STOCK_MOVEMENT_INCLUDE,
    });
    if (!raced) throw error;
    return { movement: assertSamePayload(raced, digest, "stok"), replayed: true };
  }
}

async function createWasteRecord({
  prisma,
  outletId,
  userId,
  payload,
  now,
}) {
  const digest = hashPayload(payload);
  const uniqueWhere = {
    outletId_createdById_clientTransactionId: {
      outletId,
      createdById: userId,
      clientTransactionId: payload.clientTransactionId,
    },
  };
  const existing = await prisma.wasteRecord.findUnique({
    where: uniqueWhere,
    include: WASTE_INCLUDE,
  });
  if (existing) {
    return { waste: assertSamePayload(existing, digest, "waste"), replayed: true };
  }

  try {
    const waste = await prisma.$transaction(async (tx) => {
      const current = await tx.wasteRecord.findUnique({
        where: uniqueWhere,
        include: WASTE_INCLUDE,
      });
      if (current) return assertSamePayload(current, digest, "waste");

      const inventoryItem = payload.inventoryItemId
        ? await tx.inventoryItem.findUnique({
            where: { id: payload.inventoryItemId },
          })
        : null;
      if (payload.inventoryItemId && (!inventoryItem || !inventoryItem.isActive)) {
        throw new InventoryError(
          "INVENTORY_ITEM_UNAVAILABLE",
          409,
          "Item inventaris tidak tersedia.",
        );
      }

      return tx.wasteRecord.create({
        data: {
          outletId,
          createdById: userId,
          clientTransactionId: payload.clientTransactionId,
          payloadHash: digest,
          inventoryItemId: inventoryItem?.id ?? null,
          itemName: inventoryItem?.name ?? payload.itemName,
          category: payload.category,
          quantity: new Prisma.Decimal(payload.quantity),
          unit: inventoryItem?.unit ?? payload.unit,
          description: payload.description ?? null,
          wasteDate: new Date(payload.wasteDate),
          createdAt: now(),
        },
        include: WASTE_INCLUDE,
      });
    });
    return { waste, replayed: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const raced = await prisma.wasteRecord.findUnique({
      where: uniqueWhere,
      include: WASTE_INCLUDE,
    });
    if (!raced) throw error;
    return { waste: assertSamePayload(raced, digest, "waste"), replayed: true };
  }
}

async function createOutletStockRequest({
  prisma,
  outletId,
  userId,
  payload,
  now,
}) {
  const digest = hashPayload(payload);
  const uniqueWhere = {
    outletId_requestedById_clientTransactionId: {
      outletId,
      requestedById: userId,
      clientTransactionId: payload.clientTransactionId,
    },
  };
  const existing = await prisma.outletStockRequest.findUnique({
    where: uniqueWhere,
    include: STOCK_REQUEST_INCLUDE,
  });
  if (existing) {
    return {
      request: assertSamePayload(existing, digest, "permintaan stok"),
      replayed: true,
    };
  }

  try {
    const request = await prisma.$transaction(async (tx) => {
      const current = await tx.outletStockRequest.findUnique({
        where: uniqueWhere,
        include: STOCK_REQUEST_INCLUDE,
      });
      if (current) {
        return assertSamePayload(current, digest, "permintaan stok");
      }

      const inventoryItems = await tx.inventoryItem.findMany({
        where: {
          id: { in: payload.items.map((item) => item.inventoryItemId) },
          isActive: true,
        },
        select: { id: true, name: true, unit: true },
      });
      const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
      if (payload.items.some((item) => !itemById.has(item.inventoryItemId))) {
        throw new InventoryError(
          "INVENTORY_ITEM_UNAVAILABLE",
          409,
          "Satu atau lebih item inventaris tidak tersedia.",
        );
      }

      return tx.outletStockRequest.create({
        data: {
          outletId,
          requestedById: userId,
          clientTransactionId: payload.clientTransactionId,
          payloadHash: digest,
          note: payload.note ?? null,
          createdAt: now(),
          items: {
            create: payload.items.map((item) => {
              const inventoryItem = itemById.get(item.inventoryItemId);
              return {
                inventoryItemId: inventoryItem.id,
                itemName: inventoryItem.name,
                unit: inventoryItem.unit,
                quantity: new Prisma.Decimal(item.quantity),
              };
            }),
          },
        },
        include: STOCK_REQUEST_INCLUDE,
      });
    });
    return { request, replayed: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const raced = await prisma.outletStockRequest.findUnique({
      where: uniqueWhere,
      include: STOCK_REQUEST_INCLUDE,
    });
    if (!raced) throw error;
    return {
      request: assertSamePayload(raced, digest, "permintaan stok"),
      replayed: true,
    };
  }
}

async function decideOutletStockRequest({
  prisma,
  outletId,
  requestId,
  userId,
  payload,
  now,
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.outletStockRequest.findFirst({
      where: { id: requestId, outletId },
      include: STOCK_REQUEST_INCLUDE,
    });
    if (!current) {
      throw new InventoryError(
        "NOT_FOUND",
        404,
        "Permintaan stok tidak ditemukan.",
      );
    }
    if (current.status !== "PENDING") {
      if (
        current.status === payload.status &&
        current.processedById === userId &&
        current.decisionNote === (payload.decisionNote ?? null)
      ) {
        return { request: current, replayed: true };
      }
      throw new InventoryError(
        "INVALID_REQUEST_STATE",
        409,
        "Permintaan stok sudah diproses.",
      );
    }

    const processedAt = now();
    const updated = await tx.outletStockRequest.updateMany({
      where: { id: requestId, outletId, status: "PENDING" },
      data: {
        status: payload.status,
        decisionNote: payload.decisionNote ?? null,
        processedById: userId,
        processedAt,
      },
    });
    if (updated.count !== 1) {
      throw new InventoryError(
        "INVALID_REQUEST_STATE",
        409,
        "Permintaan stok sudah diproses.",
      );
    }
    const request = await tx.outletStockRequest.findFirst({
      where: { id: requestId, outletId },
      include: STOCK_REQUEST_INCLUDE,
    });
    return { request, replayed: false };
  });
}

export function createInventoryRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  movementIdFactory = randomUUID,
}) {
  const routes = new Hono();
  const authenticate = createAuthenticationMiddleware({
    prisma,
    accessTokenSecret,
    now,
  });

  routes.get("/:outletId/stocks", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "CREW",
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const [items, balances] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { isActive: true },
        select: { id: true, name: true, unit: true },
        orderBy: { name: "asc" },
      }),
      prisma.outletStock.findMany({
        where: { outletId, inventoryItem: { isActive: true } },
        select: {
          inventoryItemId: true,
          quantity: true,
          minimumQuantity: true,
          updatedAt: true,
        },
      }),
    ]);
    const balanceByItem = new Map(
      balances.map((balance) => [balance.inventoryItemId, balance]),
    );
    return c.json({
      success: true,
      data: {
        outletId,
        stocks: items.map((item) => {
          const balance = balanceByItem.get(item.id);
          const quantity = balance?.quantity.toString() ?? "0";
          const minimumQuantity = balance?.minimumQuantity?.toString() ?? "0";
          const isLowStock = new Prisma.Decimal(quantity).lte(
            new Prisma.Decimal(minimumQuantity),
          ) && new Prisma.Decimal(minimumQuantity).gt(0);

          return {
            inventoryItemId: item.id,
            name: item.name,
            unit: item.unit,
            quantity,
            minimumQuantity,
            isLowStock,
            updatedAt: balance?.updatedAt.toISOString() ?? null,
          };
        }),
      },
    });
  });

  routes.get("/:outletId/stocks/alerts", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "CREW",
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const [items, balances] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { isActive: true },
        select: { id: true, name: true, unit: true },
        orderBy: { name: "asc" },
      }),
      prisma.outletStock.findMany({
        where: { outletId, inventoryItem: { isActive: true } },
        select: {
          inventoryItemId: true,
          quantity: true,
          minimumQuantity: true,
          updatedAt: true,
        },
      }),
    ]);

    const balanceByItem = new Map(
      balances.map((balance) => [balance.inventoryItemId, balance]),
    );

    const alerts = [];
    for (const item of items) {
      const balance = balanceByItem.get(item.id);
      const quantity = balance?.quantity ?? new Prisma.Decimal(0);
      const minimumQuantity = balance?.minimumQuantity ?? new Prisma.Decimal(0);

      // Low stock jika minimumQuantity > 0 dan quantity <= minimumQuantity,
      // atau jika quantity <= 0 (stok habis)
      const isOutOfStock = quantity.lte(0);
      const isUnderMinimum = minimumQuantity.gt(0) && quantity.lte(minimumQuantity);

      if (isOutOfStock || isUnderMinimum) {
        alerts.push({
          inventoryItemId: item.id,
          name: item.name,
          unit: item.unit,
          quantity: quantity.toString(),
          minimumQuantity: minimumQuantity.toString(),
          severity: isOutOfStock ? "CRITICAL" : "WARNING",
          message: isOutOfStock
            ? `Stok ${item.name} habis (0 ${item.unit}). Segera lakukan permintaan stok.`
            : `Stok ${item.name} menipis (${quantity.toString()} ${item.unit} <= batas min. ${minimumQuantity.toString()} ${item.unit}).`,
          updatedAt: balance?.updatedAt?.toISOString() ?? null,
        });
      }
    }

    return c.json({
      success: true,
      data: {
        outletId,
        alertCount: alerts.length,
        hasCriticalAlert: alerts.some((a) => a.severity === "CRITICAL"),
        alerts,
      },
    });
  });

  routes.get("/:outletId/stock-movements", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "CREW",
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);
    const movements = await prisma.stockMovement.findMany({
      where: { outletId },
      include: STOCK_MOVEMENT_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return c.json({
      success: true,
      data: { outletId, movements: movements.map(movementDto) },
    });
  });

  routes.post("/:outletId/stock-movements", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);
    const payload = parseBody(
      stockMovementSchema,
      await readJson(c),
      "Periksa kembali data stok dan alasan penyesuaian.",
    );
    const result = await createStockMovement({
      prisma,
      outletId,
      userId: auth.userId,
      payload,
      now,
      movementIdFactory,
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: result.replayed
        ? "STOCK_MOVEMENT_REPLAYED"
        : payload.type === "ADJUSTMENT"
          ? "STOCK_ADJUSTED"
          : "STOCK_RECEIVED",
      resourceType: "StockMovement",
      resourceId: result.movement.id,
      metadata: {
        clientTransactionId: payload.clientTransactionId,
        inventoryItemId: payload.inventoryItemId,
        type: payload.type,
        direction: payload.direction ?? null,
        quantity: payload.quantity,
        replayed: result.replayed,
      },
    });

    return c.json(
      {
        success: true,
        data: {
          movement: movementDto(result.movement),
          replayed: result.replayed,
        },
      },
      result.replayed ? 200 : 201,
    );
  });

  routes.get("/:outletId/stock-requests", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    const role = await requireMembership(prisma, auth.userId, outletId, [
      "CREW",
      "MANAGER",
    ]);
    const requests = await prisma.outletStockRequest.findMany({
      where: {
        outletId,
        ...(role === "CREW" ? { requestedById: auth.userId } : {}),
      },
      include: STOCK_REQUEST_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return c.json({
      success: true,
      data: { outletId, requests: requests.map(stockRequestDto) },
    });
  });

  routes.post("/:outletId/stock-requests", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, ["CREW", "MANAGER"]);
    const payload = parseBody(
      stockRequestSchema,
      await readJson(c),
      "Periksa kembali item dan jumlah permintaan stok.",
    );
    const result = await createOutletStockRequest({
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
      action: result.replayed ? "STOCK_REQUEST_REPLAYED" : "STOCK_REQUEST_CREATED",
      resourceType: "OutletStockRequest",
      resourceId: result.request.id,
      metadata: {
        clientTransactionId: payload.clientTransactionId,
        status: result.request.status,
        itemCount: payload.items.length,
        noteProvided: Boolean(payload.note),
        replayed: result.replayed,
      },
    });

    return c.json(
      {
        success: true,
        data: {
          request: stockRequestDto(result.request),
          replayed: result.replayed,
        },
      },
      result.replayed ? 200 : 201,
    );
  });

  routes.patch(
    "/:outletId/stock-requests/:requestId",
    authenticate,
    async (c) => {
      const outletId = c.req.param("outletId");
      const requestId = c.req.param("requestId");
      assertOutletId(outletId);
      if (!requestId || requestId.length > 64) {
        throw new InventoryError(
          "VALIDATION_ERROR",
          400,
          "Permintaan stok tidak valid.",
        );
      }
      const auth = c.get("auth");
      await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);
      const payload = parseBody(
        stockRequestDecisionSchema,
        await readJson(c),
        "Pilih persetujuan atau penolakan yang valid.",
      );
      const result = await decideOutletStockRequest({
        prisma,
        outletId,
        requestId,
        userId: auth.userId,
        payload,
        now,
      });
      await writeAuditLog(prisma, {
        actorUserId: auth.userId,
        sessionId: auth.sessionId,
        outletId,
        action: result.replayed
          ? "STOCK_REQUEST_DECISION_REPLAYED"
          : payload.status === "APPROVED"
            ? "STOCK_REQUEST_APPROVED"
            : "STOCK_REQUEST_REJECTED",
        resourceType: "OutletStockRequest",
        resourceId: requestId,
        metadata: {
          status: payload.status,
          decisionNoteProvided: Boolean(payload.decisionNote),
          replayed: result.replayed,
        },
      });
      return c.json({
        success: true,
        data: {
          request: stockRequestDto(result.request),
          replayed: result.replayed,
        },
      });
    },
  );

  routes.get("/:outletId/waste", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    const role = await requireMembership(prisma, auth.userId, outletId, [
      "CREW",
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);
    const records = await prisma.wasteRecord.findMany({
      where: {
        outletId,
        ...(role === "CREW" ? { createdById: auth.userId } : {}),
      },
      include: WASTE_INCLUDE,
      orderBy: { wasteDate: "desc" },
      take: 100,
    });
    return c.json({
      success: true,
      data: { outletId, waste: records.map(wasteDto) },
    });
  });

  routes.post("/:outletId/waste", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, ["CREW", "MANAGER"]);
    const payload = parseBody(
      wasteSchema,
      await readJson(c),
      "Periksa kembali data pencatatan waste.",
    );
    const result = await createWasteRecord({
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
      action: result.replayed ? "WASTE_REPLAYED" : "WASTE_RECORDED",
      resourceType: "WasteRecord",
      resourceId: result.waste.id,
      metadata: {
        clientTransactionId: payload.clientTransactionId,
        inventoryItemId: payload.inventoryItemId ?? null,
        category: payload.category,
        quantity: payload.quantity,
        unit: payload.unit,
        replayed: result.replayed,
      },
    });

    return c.json(
      {
        success: true,
        data: { waste: wasteDto(result.waste), replayed: result.replayed },
      },
      result.replayed ? 200 : 201,
    );
  });

  return routes;
}
