import assert from "node:assert/strict";
import test from "node:test";
import {
  DevelopmentAccountSeedError,
  seedDevelopmentAdminAccount,
} from "../prisma/dev-account-seed.js";

const validOptions = {
  nodeEnv: "development",
  enabled: "true",
  databaseUrl: "postgresql://test:test@localhost:5432/seroo_dev",
  email: "  DEV@seroo.test ",
  name: " Seroo Developer ",
  password: "local-dev-password-123",
  outletId: "outlet-test",
};

function createPrisma({
  existingUser = null,
  existingMembership = null,
  outlet = { id: "outlet-test", isActive: true },
} = {}) {
  const state = { users: [], memberships: [] };
  const prisma = {
    user: {
      async findUnique() {
        return existingUser;
      },
    },
    outletMembership: {
      async findUnique() {
        return existingMembership;
      },
    },
    async $transaction(callback) {
      const tx = {
        outlet: {
          async findUnique() {
            return outlet;
          },
        },
        user: {
          async create({ data }) {
            const user = { id: "user-dev", ...data };
            state.users.push(user);
            return { id: user.id };
          },
        },
        outletMembership: {
          async create({ data }) {
            state.memberships.push(data);
          },
        },
      };
      return callback(tx);
    },
  };
  return { prisma, state };
}

test("creates an active ADMIN_PUSAT account in the requested outlet", async () => {
  const { prisma, state } = createPrisma();
  const hashedPasswords = [];

  const result = await seedDevelopmentAdminAccount(
    prisma,
    validOptions,
    async (password) => {
      hashedPasswords.push(password);
      return "argon2id-test-hash";
    },
  );

  assert.deepEqual(result, { created: true, userId: "user-dev" });
  assert.deepEqual(hashedPasswords, [validOptions.password]);
  assert.deepEqual(state.users, [
    {
      id: "user-dev",
      name: "Seroo Developer",
      email: "dev@seroo.test",
      passwordHash: "argon2id-test-hash",
      isActive: true,
    },
  ]);
  assert.deepEqual(state.memberships, [
    {
      userId: "user-dev",
      outletId: "outlet-test",
      role: "ADMIN_PUSAT",
    },
  ]);
});

test("refuses to run without the development opt-in", async () => {
  const { prisma } = createPrisma();

  await assert.rejects(
    seedDevelopmentAdminAccount(
      prisma,
      { ...validOptions, enabled: "false" },
      async () => "unused",
    ),
    DevelopmentAccountSeedError,
  );
});

test("refuses to seed a remote database", async () => {
  const { prisma } = createPrisma();

  await assert.rejects(
    seedDevelopmentAdminAccount(
      prisma,
      { ...validOptions, databaseUrl: "postgresql://db.example/seroo" },
      async () => "unused",
    ),
    /only supports a local PostgreSQL database/,
  );
});

test("does not reset or promote an existing account", async () => {
  const { prisma, state } = createPrisma({
    existingUser: { id: "existing-user", isActive: true },
    existingMembership: { role: "CREW" },
  });

  await assert.rejects(
    seedDevelopmentAdminAccount(prisma, validOptions, async () => "unused"),
    /refusing to change its access/,
  );
  assert.equal(state.users.length, 0);
  assert.equal(state.memberships.length, 0);
});

test("does not create the account when the requested outlet is inactive", async () => {
  const { prisma, state } = createPrisma({
    outlet: { id: "outlet-test", isActive: false },
  });

  await assert.rejects(
    seedDevelopmentAdminAccount(prisma, validOptions, async () => "hash"),
    /active outlet/,
  );
  assert.equal(state.users.length, 0);
  assert.equal(state.memberships.length, 0);
});
