// Seed data lengkap untuk pengujian operasional End-to-End Seroo (TASK 06).
// Bersifat idempoten (upsert), konsisten, dan memiliki pengaman basis data lokal.
import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { hashPassword } from "../src/auth/password.js";
import { provisionalExpenseCategories } from "./seed.js";

export const TEST_USERS = [
  {
    id: "user-admin-pusat",
    email: "admin@seroo.local",
    name: "Admin Pusat Seroo",
    password: "PasswordAdmin123!",
    role: "ADMIN_PUSAT",
    outletId: "outlet-rumbai",
  },
  {
    id: "user-owner-mitra",
    email: "owner@seroo.local",
    name: "Owner Mitra Seroo",
    password: "PasswordOwner123!",
    role: "OWNER_MITRA",
    outletId: "outlet-rumbai",
  },
  {
    id: "user-manager-rumbai",
    email: "manager.rumbai@seroo.local",
    name: "Manager Rumbai",
    password: "PasswordManager123!",
    role: "MANAGER",
    outletId: "outlet-rumbai",
  },
  {
    id: "user-crew-rumbai",
    email: "crew.rumbai@seroo.local",
    name: "Crew Rumbai",
    password: "PasswordCrew123!",
    role: "CREW",
    outletId: "outlet-rumbai",
  },
  {
    id: "user-manager-panam",
    email: "manager.panam@seroo.local",
    name: "Manager Panam",
    password: "PasswordManager123!",
    role: "MANAGER",
    outletId: "outlet-panam",
  },
  {
    id: "user-crew-panam",
    email: "crew.panam@seroo.local",
    name: "Crew Panam",
    password: "PasswordCrew123!",
    role: "CREW",
    outletId: "outlet-panam",
  },
];

export const TEST_OUTLETS = [
  {
    id: "outlet-rumbai",
    name: "Seroo Rumbai (Pilot)",
    code: "SR-RUMBAI",
    address: "Jl. Rumbai No. 12, Pekanbaru",
    isActive: true,
  },
  {
    id: "outlet-panam",
    // Catatan Pre-UAT: Outlet Panam merupakan fixture pengujian isolasi multi-tenant,
    // bukan outlet operasional pilot yang terkonfirmasi (lihat UAT-OUTLET-RUMBAI.md).
    name: "Seroo Panam (Testing Fixture)",
    code: "SR-PANAM",
    address: "Jl. HR Soebrantas No. 88, Pekanbaru",
    isActive: true, // Dipertahankan true untuk kebutuhan pengujian isolasi antar-outlet di test runner
  },
];

export const TEST_PRODUCTS = [
  {
    id: "prod-teh-tarik",
    name: "Teh Tarik Seroo",
    description: "Teh tarik khas Seroo dengan racikan susu kental manis.",
    category: "Teh Tarik",
    variants: [
      { id: "var-teh-regular", name: "Regular", price: "10000.00" },
      { id: "var-teh-large", name: "Large", price: "12000.00" },
      { id: "var-teh-special", name: "Special", price: "15000.00" },
    ],
  },
  {
    id: "prod-kopi-tarik",
    name: "Kopi Tarik Seroo",
    description: "Kopi robusta tarik khas Nusantara.",
    category: "Kopi",
    variants: [
      { id: "var-kopi-regular", name: "Regular", price: "12000.00" },
      { id: "var-kopi-large", name: "Large", price: "14000.00" },
    ],
  },
  {
    id: "prod-milo-tarik",
    name: "Milo Tarik",
    description: "Cokelat malt khas dengan buih melimpah.",
    category: "Cokelat",
    variants: [
      { id: "var-milo-regular", name: "Regular", price: "14000.00" },
      { id: "var-milo-large", name: "Large", price: "16000.00" },
    ],
  },
  {
    id: "prod-teh-putih",
    name: "Teh Putih Original",
    description: "Teh putih melati segar (Khusus gerai tertentu).",
    category: "Teh",
    variants: [
      { id: "var-teh-putih-panas", name: "Panas", price: "10000.00" },
      { id: "var-teh-putih-dingin", name: "Dingin", price: "10000.00" },
    ],
  },
];

export const TEST_ADD_ONS = [
  { id: "addon-extra-susu", name: "Extra Susu", price: "3000.00" },
  { id: "addon-extra-teh", name: "Extra Teh", price: "2000.00" },
  { id: "addon-cincau", name: "Topping Cincau", price: "2500.00" },
  { id: "addon-boba", name: "Boba Brown Sugar", price: "3500.00" },
];

export const TEST_INVENTORY = [
  { id: "inv-daun-teh", name: "Daun Teh Hitam", unit: "kg", defaultQty: "10.000", minQty: "2.000" },
  { id: "inv-kopi-bubuk", name: "Kopi Robusta Bubuk", unit: "kg", defaultQty: "5.000", minQty: "1.000" },
  { id: "inv-milo-bubuk", name: "Bubuk Milo Malt", unit: "kg", defaultQty: "8.000", minQty: "1.500" },
  { id: "inv-susu-kental", name: "Susu Kental Manis", unit: "kaleng", defaultQty: "48.000", minQty: "12.000" },
  { id: "inv-gula-pasir", name: "Gula Pasir", unit: "kg", defaultQty: "15.000", minQty: "3.000" },
  { id: "inv-air-galon", name: "Air Galon Mineral", unit: "galon", defaultQty: "10.000", minQty: "2.000" },
  { id: "inv-cup-regular", name: "Cup Regular 14oz", unit: "pcs", defaultQty: "500.000", minQty: "100.000" },
  { id: "inv-cup-large", name: "Cup Large 18oz", unit: "pcs", defaultQty: "300.000", minQty: "50.000" },
  { id: "inv-sedotan", name: "Sedotan Steril", unit: "pack", defaultQty: "20.000", minQty: "5.000" },
];

const DEFAULT_ALLOWED_LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

// Default pasangan resmi host dan database staging yang diizinkan (Strict Exact Pairs)
const DEFAULT_APPROVED_STAGING_TARGETS = [
  { host: "staging-db.seroo.id", db: "seroo_staging" },
  { host: "seroo-staging.internal", db: "seroo_staging" },
  { host: "staging.internal", db: "seroo_staging" },
];

export function parseApprovedStagingPairs(env = process.env) {
  const pairs = [...DEFAULT_APPROVED_STAGING_TARGETS];

  // 1. Parsed dari STAGING_TARGET_PAIRS="host1:db1,host2:db2"
  if (env.STAGING_TARGET_PAIRS) {
    const rawPairs = env.STAGING_TARGET_PAIRS.split(",").map((p) => p.trim()).filter(Boolean);
    for (const raw of rawPairs) {
      const parts = raw.split(":");
      if (parts.length === 2) {
        const h = parts[0].trim().toLowerCase();
        const d = parts[1].trim().toLowerCase();
        if (h && d) {
          pairs.push({ host: h, db: d });
        }
      }
    }
  }

  // 2. Parsed dari STAGING_DB_HOSTS dan STAGING_DB_NAMES (jika keduanya diset secara eksplisit)
  if (env.STAGING_DB_HOSTS && env.STAGING_DB_NAMES) {
    const hosts = env.STAGING_DB_HOSTS.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
    const dbs = env.STAGING_DB_NAMES.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
    for (const h of hosts) {
      for (const d of dbs) {
        pairs.push({ host: h, db: d });
      }
    }
  }

  return pairs;
}

export function assertSafeDatabaseForSeed(databaseUrl, env = process.env) {
  if (!databaseUrl || typeof databaseUrl !== "string") {
    throw new Error("DATABASE_URL tidak valid atau belum diset.");
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("Format DATABASE_URL tidak valid.");
  }

  const host = url.hostname.toLowerCase();
  const dbName = url.pathname.replace(/^\//, "").toLowerCase();
  const deploymentEnv = (env.DEPLOYMENT_ENV || "").toLowerCase();

  // 1. MUTLAK TOLAK PRODUCTION BARRIER
  // Bila DEPLOYMENT_ENV adalah production, atau host/db mengandung "prod"
  if (
    deploymentEnv === "production" ||
    host.includes("prod") ||
    dbName.includes("prod") ||
    dbName.includes("production")
  ) {
    throw new Error(
      "AKSES DITOLAK: Seed dilarang keras dijalankan pada environment atau target database production.",
    );
  }

  // 2. Lingkungan STAGING (Wajib DEPLOYMENT_ENV=staging)
  if (deploymentEnv === "staging") {
    // a. Wajib opt-in eksplisit
    if (env.ALLOW_STAGING_SEED !== "true") {
      throw new Error(
        "AKSES DITOLAK: Seed staging memerlukan opt-in eksplisit ALLOW_STAGING_SEED=true.",
      );
    }

    // b. Validasi Pasangan Hostname dan Database Name secara Bersamaan (Strict Exact Pair Match)
    const approvedPairs = parseApprovedStagingPairs(env);
    const isPairApproved = approvedPairs.some(
      (p) => p.host === host && p.db === dbName,
    );

    if (!isPairApproved) {
      const isHostKnown = approvedPairs.some((p) => p.host === host);
      const isDbKnown = approvedPairs.some((p) => p.db === dbName);

      if (isHostKnown && !isDbKnown) {
        throw new Error(
          `AKSES DITOLAK: Database name (${dbName}) bukan target yang sah untuk host staging (${host}).`,
        );
      }
      if (!isHostKnown && isDbKnown) {
        throw new Error(
          `AKSES DITOLAK: Host database (${host}) tidak terdaftar dalam allowlist staging.`,
        );
      }

      throw new Error(
        `AKSES DITOLAK: Pasangan host (${host}) dan database (${dbName}) tidak terdaftar dalam exact allowlist staging.`,
      );
    }

    // Catatan: NODE_ENV dapat bernilai 'production' atau 'development' pada staging dan tetap diizinkan
    return { host, db: dbName, isStaging: true, isLocal: DEFAULT_ALLOWED_LOCAL_HOSTS.includes(host) };
  }

  // 3. Lingkungan DEVELOPMENT / LOCALHOST (Default ketika bukan staging)
  const isLocalHost = DEFAULT_ALLOWED_LOCAL_HOSTS.includes(host);
  if (isLocalHost) {
    if (dbName.includes("prod") || dbName.includes("production")) {
      throw new Error(
        "AKSES DITOLAK: Target database lokal teridentifikasi sebagai production.",
      );
    }
    return { host, db: dbName, isStaging: false, isLocal: true };
  }

  // 4. Remote Host Tanpa DEPLOYMENT_ENV=staging -> Fail-Closed
  throw new Error(
    `AKSES DITOLAK: Database remote (${host}) bukan localhost. Untuk staging, wajib set DEPLOYMENT_ENV=staging dan ALLOW_STAGING_SEED=true.`,
  );
}

export function assertLocalDatabase(databaseUrl, env = process.env) {
  return assertSafeDatabaseForSeed(databaseUrl, env);
}

export async function verifyDatabaseIdentity(prisma, expectedTarget) {
  let result;
  try {
    const rows = await prisma.$queryRaw`SELECT current_database() as db_name, current_user as user_name, inet_server_addr() as server_ip`;
    result = rows && rows[0];
  } catch (err) {
    throw new Error(
      `PENGAMAN DATABASE (FAIL-CLOSED): Gagal memverifikasi identitas PostgreSQL. Koneksi tidak tersedia atau terputus: ${err.message}`,
    );
  }

  if (!result || !result.db_name) {
    throw new Error(
      "PENGAMAN DATABASE (FAIL-CLOSED): Query identitas database mengembalikan hasil kosong.",
    );
  }

  const currentDb = String(result.db_name).toLowerCase();
  const currentUser = String(result.user_name).toLowerCase();
  const serverIp = result.server_ip ? String(result.server_ip) : null;

  // 1. Verifikasi Mutlak Anti-Production
  if (currentDb.includes("prod") || currentDb.includes("production")) {
    throw new Error(
      `PENGAMAN DATABASE (FAIL-CLOSED): current_database() PostgreSQL adalah '${currentDb}', terdeteksi sebagai database production. Seed dibatalkan!`,
    );
  }

  // 2. Verifikasi Kesesuaian Target yang Diharapkan
  if (expectedTarget && expectedTarget.db) {
    const expectedDb = expectedTarget.db.toLowerCase();
    if (currentDb !== expectedDb) {
      throw new Error(
        `PENGAMAN DATABASE (FAIL-CLOSED): Identitas database aktual (${currentDb}) tidak cocok dengan target yang diharapkan (${expectedDb}). Seed dibatalkan!`,
      );
    }
  }

  return {
    verified: true,
    database: currentDb,
    user: currentUser,
    serverIp,
  };
}

export async function seedE2eData(prisma, { hashPasswordFn = hashPassword } = {}) {
  // 1. Seed Outlets
  for (const outlet of TEST_OUTLETS) {
    await prisma.outlet.upsert({
      where: { id: outlet.id },
      create: {
        id: outlet.id,
        name: outlet.name,
        code: outlet.code,
        address: outlet.address,
        isActive: outlet.isActive,
      },
      update: {
        name: outlet.name,
        code: outlet.code,
        address: outlet.address,
        isActive: outlet.isActive,
      },
    });
  }

  // 2. Seed Users & Memberships
  for (const user of TEST_USERS) {
    const passwordHash = await hashPasswordFn(user.password);
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        name: user.name,
        passwordHash,
        isActive: true,
      },
      update: {
        email: user.email,
        name: user.name,
        isActive: true,
      },
    });

    await prisma.outletMembership.upsert({
      where: {
        userId_outletId: {
          userId: user.id,
          outletId: user.outletId,
        },
      },
      create: {
        userId: user.id,
        outletId: user.outletId,
        role: user.role,
      },
      update: {
        role: user.role,
      },
    });
  }

  // Owner Mitra diberikan akses juga ke outlet kedua (multi-outlet membership)
  await prisma.outletMembership.upsert({
    where: {
      userId_outletId: {
        userId: "user-owner-mitra",
        outletId: "outlet-panam",
      },
    },
    create: {
      userId: "user-owner-mitra",
      outletId: "outlet-panam",
      role: "OWNER_MITRA",
    },
    update: {
      role: "OWNER_MITRA",
    },
  });

  // 3. Seed Master Catalog
  for (const product of TEST_PRODUCTS) {
    await prisma.product.upsert({
      where: { id: product.id },
      create: {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        isActive: true,
      },
      update: {
        name: product.name,
        description: product.description,
        category: product.category,
        isActive: true,
      },
    });

    for (const variant of product.variants) {
      await prisma.productVariant.upsert({
        where: {
          productId_name: { productId: product.id, name: variant.name },
        },
        create: {
          id: variant.id,
          productId: product.id,
          name: variant.name,
          price: new Prisma.Decimal(variant.price),
          isActive: true,
        },
        update: {
          price: new Prisma.Decimal(variant.price),
          isActive: true,
        },
      });
    }
  }

  // 4. Seed Add-Ons
  for (const addOn of TEST_ADD_ONS) {
    await prisma.addOn.upsert({
      where: { id: addOn.id },
      create: {
        id: addOn.id,
        name: addOn.name,
        price: new Prisma.Decimal(addOn.price),
        isActive: true,
      },
      update: {
        name: addOn.name,
        price: new Prisma.Decimal(addOn.price),
        isActive: true,
      },
    });
  }

  // 5. Seed OutletProductAvailability (Mengaktifkan Teh Tarik, Kopi Tarik, Milo Tarik di Rumbai; Teh Putih sengaja tidak diaktifkan)
  const availableProductIdsInRumbai = ["prod-teh-tarik", "prod-kopi-tarik", "prod-milo-tarik"];
  for (const prodId of availableProductIdsInRumbai) {
    if (prisma.outletProductAvailability?.upsert) {
      await prisma.outletProductAvailability.upsert({
        where: {
          outletId_productId: {
            outletId: "outlet-rumbai",
            productId: prodId,
          },
        },
        create: {
          outletId: "outlet-rumbai",
          productId: prodId,
          isAvailable: true,
        },
        update: {
          isAvailable: true,
        },
      });
    }
  }

  // 6. Seed Inventory & Outlet Stock
  for (const inv of TEST_INVENTORY) {
    await prisma.inventoryItem.upsert({
      where: { id: inv.id },
      create: {
        id: inv.id,
        name: inv.name,
        unit: inv.unit,
        isActive: true,
      },
      update: {
        name: inv.name,
        unit: inv.unit,
        isActive: true,
      },
    });

    for (const outlet of TEST_OUTLETS) {
      const stockId = `stock_${outlet.id}_${inv.id}`;
      if (prisma.outletStock?.upsert) {
        await prisma.outletStock.upsert({
          where: {
            outletId_inventoryItemId: {
              outletId: outlet.id,
              inventoryItemId: inv.id,
            },
          },
          create: {
            id: stockId,
            outletId: outlet.id,
            inventoryItemId: inv.id,
            quantity: new Prisma.Decimal(inv.defaultQty),
            minimumQuantity: new Prisma.Decimal(inv.minQty),
          },
          update: {
            quantity: new Prisma.Decimal(inv.defaultQty),
            minimumQuantity: new Prisma.Decimal(inv.minQty),
          },
        });
      }
    }
  }

  // 7. Seed Expense Categories
  for (const catName of provisionalExpenseCategories) {
    await prisma.expenseCategory.upsert({
      where: { name: catName },
      create: { name: catName, isProvisional: true },
      update: {},
    });
  }

  return {
    outlets: TEST_OUTLETS.length,
    users: TEST_USERS.length,
    products: TEST_PRODUCTS.length,
    addOns: TEST_ADD_ONS.length,
    inventory: TEST_INVENTORY.length,
  };
}

async function main() {
  const target = assertSafeDatabaseForSeed(process.env.DATABASE_URL || "", process.env);
  const prisma = new PrismaClient();
  try {
    const identity = await verifyDatabaseIdentity(prisma, target);
    console.info(
      `Target PostgreSQL terverifikasi secara ketat (Fail-Closed): database=${identity.database}, user=${identity.user}, server=${identity.serverIp || "local"}`,
    );

    const summary = await seedE2eData(prisma);
    console.info("Seed E2E data selesai sukses:", JSON.stringify(summary));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed-e2e.js")) {
  main().catch((err) => {
    console.error("Seed E2E gagal:", err.message);
    process.exitCode = 1;
  });
}
