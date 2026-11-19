import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-13T10:00:00.000Z");
const MOVEMENT_ID = "e75f8268-4ed1-4f5c-b853-b4c25178a107";
const WASTE_ID = "c9ca2a2a-b838-4934-9f22-a92d9796c1ec";

function createDatabase(role = "CREW") {
  const state = {
    items: [{ id: "item-1", name: "Susu", unit: "ml", isActive: true }],
    stocks: [{ outletId: "outlet-a", inventoryItemId: "item-1", quantity: new Prisma.Decimal("1000"), updatedAt: NOW }],
    movements: [],
    waste: [],
  };
  const memberships = new Map([
    ["outlet-a", role],
    ["outlet-b", "MANAGER"],
  ]);
  const stockKey = (outletId, inventoryItemId) => `${outletId}:${inventoryItemId}`;

  const prisma = {
    authSession: {
      async findUnique({ where }) {
        return where.id === "session-1"
          ? {
              id: "session-1",
              userId: "user-1",
              revokedAt: null,
              expiresAt: new Date("2026-11-14T10:00:00.000Z"),
              user: { id: "user-1", isActive: true },
            }
          : null;
      },
    },
    outletMembership: {
      async findUnique({ where }) {
        const outletId = where.userId_outletId.outletId;
        const membershipRole = memberships.get(outletId);
        return membershipRole
          ? { role: membershipRole, outlet: { isActive: true } }
          : null;
      },
    },
    inventoryItem: {
      async findMany() {
        return state.items.filter((item) => item.isActive);
      },
      async findUnique({ where }) {
        return state.items.find((item) => item.id === where.id) ?? null;
      },
    },
    outletStock: {
      async findMany({ where }) {
        return state.stocks.filter(
          (stock) => stock.outletId === where.outletId,
        );
      },
      async upsert({ where, create }) {
        const key = stockKey(
          where.outletId_inventoryItemId.outletId,
          where.outletId_inventoryItemId.inventoryItemId,
        );
        let stock = state.stocks.find(
          (entry) =>
            stockKey(entry.outletId, entry.inventoryItemId) === key,
        );
        if (!stock) {
          stock = { ...create, updatedAt: NOW };
          state.stocks.push(stock);
        }
        return stock;
      },
      async update({ where, data }) {
        const key = stockKey(
          where.outletId_inventoryItemId.outletId,
          where.outletId_inventoryItemId.inventoryItemId,
        );
        const stock = state.stocks.find(
          (entry) =>
            stockKey(entry.outletId, entry.inventoryItemId) === key,
        );
        if (data.quantity.increment) {
          stock.quantity = stock.quantity.add(data.quantity.increment);
        }
        stock.updatedAt = NOW;
        return stock;
      },
      async updateMany({ where, data }) {
        const stock = state.stocks.find(
          (entry) =>
            entry.outletId === where.outletId &&
            entry.inventoryItemId === where.inventoryItemId,
        );
        if (!stock || stock.quantity.lt(where.quantity.gte)) return { count: 0 };
        stock.quantity = stock.quantity.sub(data.quantity.decrement);
        stock.updatedAt = NOW;
        return { count: 1 };
      },
    },
    stockMovement: {
      async findUnique({ where }) {
        const key = where.outletId_createdById_clientTransactionId;
        return (
          state.movements.find(
            (movement) =>
              movement.outletId === key.outletId &&
              movement.createdById === key.createdById &&
              movement.clientTransactionId === key.clientTransactionId,
          ) ?? null
        );
      },
      async findMany({ where }) {
        return state.movements.filter(
          (movement) => movement.outletId === where.outletId,
        );
      },
      async create({ data }) {
        const movement = {
          ...data,
          inventoryItem: state.items.find(
            (item) => item.id === data.inventoryItemId,
          ),
          createdBy: { id: data.createdById, name: "Pengguna Uji" },
        };
        state.movements.push(movement);
        return movement;
      },
    },
    wasteRecord: {
      async findUnique({ where }) {
        const key = where.outletId_createdById_clientTransactionId;
        return (
          state.waste.find(
            (record) =>
              record.outletId === key.outletId &&
              record.createdById === key.createdById &&
              record.clientTransactionId === key.clientTransactionId,
          ) ?? null
        );
      },
      async findMany({ where }) {
        return state.waste.filter(
          (record) =>
            record.outletId === where.outletId &&
            (!where.createdById || record.createdById === where.createdById),
        );
      },
      async create({ data }) {
        const record = {
          ...data,
          quantity: new Prisma.Decimal(data.quantity),
          inventoryItem: data.inventoryItemId
            ? state.items.find((item) => item.id === data.inventoryItemId)
            : null,
          createdBy: { id: data.createdById, name: "Pengguna Uji" },
        };
        state.waste.push(record);
        return record;
      },
    },
    async $transaction(callback) {
      return callback(prisma);
    },
  };
  return { prisma, state };
}

function createFixture(role = "CREW") {
  const database = createDatabase(role);
  const app = createApp({
    prisma: database.prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    inventoryOptions: {
      now: () => NOW,
      movementIdFactory: () => "movement-1",
    },
  });
  const accessToken = createAccessToken({
    userId: "user-1",
    sessionId: "session-1",
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
  return { app, accessToken, ...database };
}

function request(app, token, path, method = "GET", body) {
  return app.request(
    `http://localhost/api/v1/outlets/${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}

function movementPayload(overrides = {}) {
  return {
    clientTransactionId: MOVEMENT_ID,
    inventoryItemId: "item-1",
    type: "IN",
    quantity: "250",
    ...overrides,
  };
}

function wastePayload(overrides = {}) {
  return {
    clientTransactionId: WASTE_ID,
    inventoryItemId: "item-1",
    itemName: "Susu",
    category: "Bahan rusak",
    quantity: "50",
    unit: "ml",
    description: "Kemasan bocor",
    wasteDate: NOW.toISOString(),
    ...overrides,
  };
}

test("stock view and movement history are membership scoped", async () => {
  const { app, accessToken } = createFixture();
  const response = await request(app, accessToken, "outlet-a/stocks");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.stocks[0].quantity, "1000");

  const denied = await request(app, accessToken, "outlet-c/stocks");
  assert.equal(denied.status, 403);
});

test("stock receipts are manager-only, ledger-backed, and idempotent", async () => {
  const crew = createFixture("CREW");
  const denied = await request(
    crew.app,
    crew.accessToken,
    "outlet-a/stock-movements",
    "POST",
    movementPayload(),
  );
  assert.equal(denied.status, 403);

  const manager = createFixture("MANAGER");
  const response = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/stock-movements",
    "POST",
    movementPayload(),
  );
  assert.equal(response.status, 201);
  assert.equal(manager.state.stocks[0].quantity.toString(), "1250");
  assert.equal(manager.state.movements.length, 1);
  assert.equal(manager.state.movements[0].quantity.toString(), "250");
  const history = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/stock-movements",
  );
  assert.equal((await history.json()).data.movements[0].quantity, "250");

  const replay = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/stock-movements",
    "POST",
    movementPayload(),
  );
  assert.equal(replay.status, 200);
  assert.equal(manager.state.stocks[0].quantity.toString(), "1250");

  const conflict = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/stock-movements",
    "POST",
    movementPayload({ quantity: "300" }),
  );
  assert.equal(conflict.status, 409);

  const owner = createFixture("OWNER");
  const ownerWrite = await request(
    owner.app,
    owner.accessToken,
    "outlet-a/stock-movements",
    "POST",
    movementPayload(),
  );
  assert.equal(ownerWrite.status, 403);
});

test("stock adjustments require a reason and cannot make balance negative", async () => {
  const { app, accessToken, state } = createFixture("MANAGER");
  const noReason = await request(
    app,
    accessToken,
    "outlet-a/stock-movements",
    "POST",
    movementPayload({
      type: "ADJUSTMENT",
      direction: "DECREASE",
      quantity: "10",
      note: "",
    }),
  );
  assert.equal(noReason.status, 400);

  const tooMuch = await request(
    app,
    accessToken,
    "outlet-a/stock-movements",
    "POST",
    movementPayload({
      type: "ADJUSTMENT",
      direction: "DECREASE",
      quantity: "1001",
      note: "Koreksi stok",
    }),
  );
  assert.equal(tooMuch.status, 409);
  assert.equal(state.stocks[0].quantity.toString(), "1000");
  assert.equal(state.movements.length, 0);

  const success = await request(
    app,
    accessToken,
    "outlet-a/stock-movements",
    "POST",
    movementPayload({
      type: "ADJUSTMENT",
      direction: "DECREASE",
      quantity: "100",
      note: "Stok rusak saat penerimaan",
    }),
  );
  assert.equal(success.status, 201);
  assert.equal(state.stocks[0].quantity.toString(), "900");
  assert.equal(state.movements[0].quantity.toString(), "-100");
});

test("waste can be recorded by Crew and Manager without changing stock", async () => {
  const { app, accessToken, state } = createFixture("CREW");
  const response = await request(
    app,
    accessToken,
    "outlet-a/waste",
    "POST",
    wastePayload({ itemName: "Nama dari client", unit: "unit palsu" }),
  );
  assert.equal(response.status, 201);
  assert.equal(state.waste.length, 1);
  assert.equal(state.waste[0].itemName, "Susu");
  assert.equal(state.waste[0].unit, "ml");
  assert.equal(state.stocks[0].quantity.toString(), "1000");
  assert.equal(state.movements.length, 0);

  const replay = await request(
    app,
    accessToken,
    "outlet-a/waste",
    "POST",
    wastePayload({ itemName: "Nama dari client", unit: "unit palsu" }),
  );
  assert.equal(replay.status, 200);
  assert.equal(state.waste.length, 1);

  const conflict = await request(
    app,
    accessToken,
    "outlet-a/waste",
    "POST",
    wastePayload({ quantity: "60" }),
  );
  assert.equal(conflict.status, 409);
});

test("Crew waste history is limited to own records; Manager sees outlet records", async () => {
  const crew = createFixture("CREW");
  crew.state.waste.push({
    outletId: "outlet-a",
    createdById: "another-user",
    wasteDate: NOW,
    createdAt: NOW,
    quantity: new Prisma.Decimal("3"),
    createdBy: { id: "another-user", name: "Crew lain" },
  });
  const crewResponse = await request(
    crew.app,
    crew.accessToken,
    "outlet-a/waste",
  );
  assert.equal((await crewResponse.json()).data.waste.length, 0);

  const manager = createFixture("MANAGER");
  manager.state.waste.push({
    outletId: "outlet-a",
    createdById: "another-user",
    wasteDate: NOW,
    createdAt: NOW,
    quantity: new Prisma.Decimal("3"),
    createdBy: { id: "another-user", name: "Crew lain" },
  });
  const managerResponse = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/waste",
  );
  assert.equal((await managerResponse.json()).data.waste.length, 1);

  // OWNER_MITRA can read waste history for authorized outlet
  const ownerMitra = createFixture("OWNER_MITRA");
  ownerMitra.state.waste.push({
    outletId: "outlet-a",
    createdById: "crew-1",
    wasteDate: NOW,
    createdAt: NOW,
    quantity: new Prisma.Decimal("5"),
    createdBy: { id: "crew-1", name: "Crew Rumbai" },
  });
  const ownerResponse = await request(
    ownerMitra.app,
    ownerMitra.accessToken,
    "outlet-a/waste",
  );
  assert.equal(ownerResponse.status, 200);
  assert.equal((await ownerResponse.json()).data.waste.length, 1);

  // OWNER_MITRA cannot create waste records (Forbidden 403)
  const ownerCreateResponse = await request(
    ownerMitra.app,
    ownerMitra.accessToken,
    "outlet-a/waste",
    "POST",
    wastePayload(),
  );
  assert.equal(ownerCreateResponse.status, 403);
});

test("stocks/alerts detects items below minimum quantity or out of stock", async () => {
  const fixture = createFixture("MANAGER");
  // Tambah item ke-2 dengan stok 0 (CRITICAL)
  fixture.state.items.push({ id: "item-2", name: "Gula", unit: "kg", isActive: true });
  // Set item-1 dengan minimumQuantity = 1500 (stok sekarang 1000 => WARNING)
  fixture.state.stocks[0].minimumQuantity = new Prisma.Decimal("1500");

  const response = await request(
    fixture.app,
    fixture.accessToken,
    "outlet-a/stocks/alerts",
  );

  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.success, true);
  assert.equal(json.data.outletId, "outlet-a");
  assert.equal(json.data.alertCount, 2);
  assert.equal(json.data.hasCriticalAlert, true);

  const sugarAlert = json.data.alerts.find((a) => a.name === "Gula");
  assert.ok(sugarAlert);
  assert.equal(sugarAlert.severity, "CRITICAL");
  assert.equal(sugarAlert.quantity, "0");

  const milkAlert = json.data.alerts.find((a) => a.name === "Susu");
  assert.ok(milkAlert);
  assert.equal(milkAlert.severity, "WARNING");
  assert.equal(milkAlert.quantity, "1000");
  assert.equal(milkAlert.minimumQuantity, "1500");
});
