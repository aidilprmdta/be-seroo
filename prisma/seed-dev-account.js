import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth/password.js";
import {
  DevelopmentAccountSeedError,
  seedDevelopmentAdminAccount,
} from "./dev-account-seed.js";

async function main() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.SEROO_DEV_ACCOUNT_SEED_ENABLED !== "true"
  ) {
    throw new DevelopmentAccountSeedError(
      "Set NODE_ENV=development and SEROO_DEV_ACCOUNT_SEED_ENABLED=true to run this local-only seed.",
    );
  }

  const prisma = new PrismaClient();
  try {
    const result = await seedDevelopmentAdminAccount(
      prisma,
      {
        nodeEnv: process.env.NODE_ENV,
        enabled: process.env.SEROO_DEV_ACCOUNT_SEED_ENABLED,
        databaseUrl: process.env.DATABASE_URL,
        email: process.env.SEROO_DEV_ACCOUNT_EMAIL,
        name: process.env.SEROO_DEV_ACCOUNT_NAME,
        password: process.env.SEROO_DEV_ACCOUNT_PASSWORD,
        outletId: process.env.SEROO_DEV_ACCOUNT_OUTLET_ID,
      },
      hashPassword,
    );
    console.info(
      result.created
        ? "Development ADMIN_PUSAT account created."
        : "Development ADMIN_PUSAT account already exists; credentials were not changed.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  if (error instanceof DevelopmentAccountSeedError) {
    console.error("Developer account seed failed:", error.message);
  } else {
    console.error(
      "Developer account seed failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
  }
  process.exitCode = 1;
});
