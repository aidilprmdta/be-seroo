import { hashPassword } from "../src/auth/password.js";

export class DevelopmentAccountSeedError extends Error {
  constructor(message) {
    super(message);
    this.name = "DevelopmentAccountSeedError";
  }
}

export async function seedDevelopmentAdminAccount(
  prisma,
  {
    nodeEnv,
    enabled,
    databaseUrl,
    email,
    name,
    password,
    outletId,
  },
  hashPasswordFn = hashPassword,
) {
  if (nodeEnv !== "development" || enabled !== "true") {
    throw new DevelopmentAccountSeedError(
      "Developer account seed requires NODE_ENV=development and SEROO_DEV_ACCOUNT_SEED_ENABLED=true.",
    );
  }

  let databaseHost;
  try {
    const parsedDatabaseUrl = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
      throw new Error();
    }
    databaseHost = parsedDatabaseUrl.hostname.toLowerCase();
  } catch {
    throw new DevelopmentAccountSeedError(
      "DATABASE_URL must point to a local PostgreSQL development database.",
    );
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
    throw new DevelopmentAccountSeedError(
      "Developer account seed only supports a local PostgreSQL database.",
    );
  }

  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedName = name?.trim();
  const normalizedOutletId = outletId?.trim();

  if (
    !normalizedEmail ||
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    throw new DevelopmentAccountSeedError(
      "SEROO_DEV_ACCOUNT_EMAIL must be a valid email address.",
    );
  }
  if (!normalizedName || normalizedName.length > 100) {
    throw new DevelopmentAccountSeedError(
      "SEROO_DEV_ACCOUNT_NAME must contain 1 to 100 characters.",
    );
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new DevelopmentAccountSeedError(
      "SEROO_DEV_ACCOUNT_PASSWORD must contain 12 to 1024 characters.",
    );
  }
  if (!normalizedOutletId || normalizedOutletId.length > 64) {
    throw new DevelopmentAccountSeedError(
      "SEROO_DEV_ACCOUNT_OUTLET_ID must identify an existing outlet.",
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, isActive: true },
  });
  if (existingUser) {
    const membership = await prisma.outletMembership.findUnique({
      where: {
        userId_outletId: {
          userId: existingUser.id,
          outletId: normalizedOutletId,
        },
      },
      select: { role: true },
    });
    if (!existingUser.isActive || membership?.role !== "ADMIN_PUSAT") {
      throw new DevelopmentAccountSeedError(
        "An account with this email already exists without the expected active ADMIN_PUSAT membership; refusing to change its access.",
      );
    }

    return { created: false, userId: existingUser.id };
  }

  const passwordHash = await hashPasswordFn(password);
  return prisma.$transaction(async (tx) => {
    const outlet = await tx.outlet.findUnique({
      where: { id: normalizedOutletId },
      select: { id: true, isActive: true },
    });
    if (!outlet?.isActive) {
      throw new DevelopmentAccountSeedError(
        "SEROO_DEV_ACCOUNT_OUTLET_ID must identify an active outlet.",
      );
    }

    const user = await tx.user.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        passwordHash,
        isActive: true,
      },
      select: { id: true },
    });
    await tx.outletMembership.create({
      data: {
        userId: user.id,
        outletId: normalizedOutletId,
        role: "ADMIN_PUSAT",
      },
    });

    return { created: true, userId: user.id };
  });
}
