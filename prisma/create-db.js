// Membuat database sero_db pada cluster yang ditunjuk DATABASE_URL (port dari .env).
// Tidak mencetak kredensial.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const target = new URL(process.env.DATABASE_URL);
const dbName = target.pathname.replace(/^\//, "");
const adminUrl = new URL(target);
adminUrl.pathname = "/postgres";

const prisma = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
try {
  const exists = await prisma.$queryRawUnsafe(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    dbName,
  );
  if (exists.length > 0) {
    console.log(`database ${dbName} already exists on port ${target.port}`);
  } else {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`database ${dbName} created on port ${target.port}`);
  }
} catch (error) {
  console.log("create error:", error.message.replace(/\n+/g, " ").slice(0, 200));
} finally {
  await prisma.$disconnect();
}
