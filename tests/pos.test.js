import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-13T10:00:00.000Z");
const CLIENT_TRANSACTION_ID = "e75f8268-4ed1-4f5c-b853-b4c25178a107";

function createPosDatabase(role = "CREW") {
  const state = {
    orders: [],
    nextOrderId: 1,
  };
  const products = [
    {
      id: "product-1",
      name: "Minuman Uji",
      category: "Minuman",
      isActive: true,
    },
  ];
  const variants = [
    {
      id: "variant-medium",
      productId: "product-1",
      name: "Medium",
      price: new Prisma.Decimal("12000.00"),
      isActive: true,
      product: products[0],
    },
    {
      id: "variant-inactive",
      productId: "product-1",
      name: "Tidak Aktif",
      price: new Prisma.Decimal("5000.00"),
      isActive: false,
      product: products[0],
    },
  ];
  const addOns = [
    {
      id: "addon-1",
      name: "Topping Uji",
      price: new Prisma.Decimal("3000.00"),
      isActive: true,
    },
  ];
  const memberships = new Map([
    ["outlet-a", role],
    ["outlet-inactive", "CREW"],
  ]);
  const prisma = {
    authSession: {
      async findUnique({ where }) {
        if (where.id !== "session-1") return null;
        return {
          id: "session-1",
          userId: "user-1",
          revokedAt: null,
          expiresAt: new Date("2026-11-14T10:00:00.000Z"),
          user: { id: "user-1", isActive: true },
        };
      },
    },
    outletMembership: {
      async findUnique({ where }) {
        const membershipRole = memberships.get(where.userId_outletId.outletId);
        if (!membershipRole) return null;
        return {
          role: membershipRole,
          outlet: {
            isActive: where.userId_outletId.outletId !== "outlet-inactive",
          },
        };
      },
    },
    product: {
      async findMany() {
        return products
          .filter((product) => product.isActive)
          .map((product) => ({
            ...product,
            variants: variants
              .filter(
                (variant) =>
                  variant.productId === product.id && variant.isActive,
              )
              .map(({ id, name, price }) => ({ id, name, price })),
          }))
          .filter((product) => product.variants.length > 0);
      },
    },
    addOn: {
      async findMany() {
        return addOns.filter((addOn) => addOn.isActive);
      },
    },
    productVariant: {
      async findMany({ where }) {
        return variants
          .filter(
            (variant) =>
              where.id.in.includes(variant.id) &&
              variant.isActive &&
              variant.product.isActive,
          )
          .map((variant) => ({
            ...variant,
            product: {
              id: variant.product.id,
              name: variant.product.name,
              isActive: variant.product.isActive,
            },
          }));
      },
    },
    order: {
      async findUnique({ where }) {
        const key = where.outletId_crewId_clientTransactionId;
        return (
          state.orders.find(
            (order) =>
              order.outletId === key.outletId &&
              order.crewId === key.crewId &&
              order.clientTransactionId === key.clientTransactionId,
          ) ?? null
        );
      },
      async create({ data }) {
        if (
          state.orders.some(
            (order) =>
              order.outletId === data.outletId &&
              order.crewId === data.crewId &&
              order.clientTransactionId === data.clientTransactionId,
          )
        ) {
          const error = new Error("unique conflict");
          error.code = "P2002";
          throw error;
        }

        const order = {
          ...data,
          id: `order-${state.nextOrderId++}`,
          items: data.items.create.map(({ addOns: itemAddOns, ...item }) => ({
            ...item,
            id: `item-${state.nextOrderId++}`,
            addOns: itemAddOns.create.map((addOn) => ({
              ...addOn,
              id: `order-addon-${state.nextOrderId++}`,
            })),
          })),
        };
        state.orders.push(order);
        return order;
      },
    },
    async $transaction(callback) {
      return callback(prisma);
    },
  };

  return { prisma, state, products, variants, addOns };
}

function createFixture(role = "CREW") {
  const database = createPosDatabase(role);
  const app = createApp({
    prisma: database.prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => new Date(NOW) },
  });
  const accessToken = createAccessToken({
    userId: "user-1",
    sessionId: "session-1",
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
  return { app, accessToken, ...database };
}

function orderPayload(overrides = {}) {
  return {
    clientTransactionId: CLIENT_TRANSACTION_ID,
    recordedOffline: false,
    paymentMethod: "CASH",
    items: [
      {
        productVariantId: "variant-medium",
        quantity: 2,
        expectedVariantPrice: "10000.00",
        addOns: [
          {
            addOnId: "addon-1",
            quantity: 1,
            expectedUnitPrice: "2500.00",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function postOrder(app, accessToken, outletId, payload) {
  return app.request(`/api/v1/outlets/${outletId}/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

test("catalog returns only active products, variants, and add-ons for an authorized Crew", async () => {
  const { app, accessToken } = createFixture();
  const response = await app.request(
    "/api/v1/outlets/outlet-a/catalog",
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.products.length, 1);
  assert.equal(body.data.products[0].variants[0].name, "Medium");
  assert.equal(body.data.products[0].variants[0].price, "12000");
  assert.deepEqual(body.data.addOns.map((item) => item.name), ["Topping Uji"]);
});

test("catalog and order endpoints reject another outlet and non-Crew roles", async () => {
  const crew = createFixture();
  const otherOutlet = await crew.app.request(
    "/api/v1/outlets/outside/catalog",
    { headers: { authorization: `Bearer ${crew.accessToken}` } },
  );
  assert.equal(otherOutlet.status, 403);

  const manager = createFixture("MANAGER");
  const write = await postOrder(
    manager.app,
    manager.accessToken,
    "outlet-a",
    orderPayload(),
  );
  assert.equal(write.status, 403);

  const owner = createFixture("OWNER");
  const ownerWrite = await postOrder(
    owner.app,
    owner.accessToken,
    "outlet-a",
    orderPayload(),
  );
  assert.equal(ownerWrite.status, 403);
});

test("backend calculates totals and persists immutable product and add-on snapshots", async () => {
  const { app, accessToken, state } = createFixture();
  const response = await postOrder(
    app,
    accessToken,
    "outlet-a",
    orderPayload(),
  );
  const body = await response.json();
  const order = body.data.order;

  assert.equal(response.status, 201);
  assert.equal(order.total, "30000");
  assert.equal(order.subtotal, "30000");
  assert.equal(order.items[0].productName, "Minuman Uji");
  assert.equal(order.items[0].variantName, "Medium");
  assert.equal(order.items[0].unitPrice, "12000");
  assert.equal(order.items[0].addOns[0].name, "Topping Uji");
  assert.equal(order.items[0].addOns[0].unitPrice, "3000");
  assert.equal(state.orders.length, 1);
});

test("repeated client transaction ID replays the original order without a duplicate", async () => {
  const { app, accessToken, state } = createFixture();
  const payload = orderPayload();
  const first = await postOrder(app, accessToken, "outlet-a", payload);
  const replay = await postOrder(app, accessToken, "outlet-a", payload);
  const replayBody = await replay.json();

  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replayBody.data.replayed, true);
  assert.equal(state.orders.length, 1);
});

test("same idempotency key with changed payload is rejected", async () => {
  const { app, accessToken, state } = createFixture();
  await postOrder(app, accessToken, "outlet-a", orderPayload());
  const changed = await postOrder(
    app,
    accessToken,
    "outlet-a",
    orderPayload({ paymentMethod: "QRIS" }),
  );
  const body = await changed.json();

  assert.equal(changed.status, 409);
  assert.equal(body.error.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(state.orders.length, 1);
});

test("offline QRIS is pending reconciliation and stale offline prices are rejected", async () => {
  const pending = createFixture();
  const response = await postOrder(
    pending.app,
    pending.accessToken,
    "outlet-a",
    orderPayload({
      recordedOffline: true,
      paymentMethod: "QRIS",
      items: [
        {
          productVariantId: "variant-medium",
          quantity: 2,
          expectedVariantPrice: "12000.00",
          addOns: [
            {
              addOnId: "addon-1",
              quantity: 1,
              expectedUnitPrice: "3000.00",
            },
          ],
        },
      ],
    }),
  );
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.data.order.paymentStatus, "PENDING_RECONCILIATION");

  const conflict = createFixture();
  const stalePayload = orderPayload({
    recordedOffline: true,
    items: [
      {
        productVariantId: "variant-medium",
        quantity: 1,
        expectedVariantPrice: "1.00",
        addOns: [],
      },
    ],
  });
  const staleResponse = await postOrder(
    conflict.app,
    conflict.accessToken,
    "outlet-a",
    stalePayload,
  );
  const staleBody = await staleResponse.json();
  assert.equal(staleResponse.status, 409);
  assert.equal(staleBody.error.code, "PRICE_CHANGED");
  assert.equal(conflict.state.orders.length, 0);
});

test("concurrent retries with the same ID create one order", async () => {
  const { app, accessToken, state } = createFixture();
  const [first, second] = await Promise.all([
    postOrder(app, accessToken, "outlet-a", orderPayload()),
    postOrder(app, accessToken, "outlet-a", orderPayload()),
  ]);

  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  assert.equal(state.orders.length, 1);
});

test("order payload rejects client-supplied totals or role fields", async () => {
  const { app, accessToken } = createFixture();
  const response = await postOrder(
    app,
    accessToken,
    "outlet-a",
    orderPayload({ total: "1.00", role: "OWNER" }),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});
