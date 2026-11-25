import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { verifyPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();
const [email, password] = process.argv.slice(2);

const user = await prisma.user.findUnique({
  where: { email: (email || "").toLowerCase() },
  select: { id: true, email: true, isActive: true, mustChangePassword: true, passwordHash: true, memberships: { select: { role: true } } },
});

if (!user) {
  console.log("RESULT: EMAIL NOT FOUND");
  const all = await prisma.user.findMany({ select: { email: true, isActive: true }, take: 20 });
  console.log("existing users:", all.map((u) => `${u.email} (active=${u.isActive})`).join(", ") || "(none)");
} else {
  const ok = await verifyPassword(password || "", user.passwordHash);
  console.log("RESULT: email found | passwordMatch:", ok, "| isActive:", user.isActive, "| mustChangePassword:", user.mustChangePassword, "| roles:", user.memberships.map((m) => m.role).join(","));
}
await prisma.$disconnect();
