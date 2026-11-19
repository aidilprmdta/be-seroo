import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { writeAuditLog } from "../audit/service.js";
import { OutletAvailabilityError } from "./availabilityErrors.js";

const availabilitySchema = z.object({
  isAvailable: z.boolean({
    required_error: "Status ketersediaan (isAvailable) wajib diisi.",
    invalid_type_error: "Status ketersediaan harus berupa boolean.",
  }),
});

function assertOutletId(outletId) {
  if (!outletId || typeof outletId !== "string" || outletId.length > 64) {
    throw new OutletAvailabilityError(
      "VALIDATION_ERROR",
      400,
      "Outlet ID tidak valid.",
    );
  }
}

function assertProductId(productId) {
  if (!productId || typeof productId !== "string" || productId.length > 64) {
    throw new OutletAvailabilityError(
      "VALIDATION_ERROR",
      400,
      "Product ID tidak valid.",
    );
  }
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
    throw new OutletAvailabilityError(
      "FORBIDDEN",
      403,
      "Akses ke ketersediaan menu outlet ini tidak diizinkan.",
    );
  }

  return membership.role;
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new OutletAvailabilityError(
        "VALIDATION_ERROR",
        400,
        "Format permintaan JSON tidak valid.",
      );
    }
    throw error;
  }
}

export function createCatalogAvailabilityRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  // GET /:outletId/catalog/products/availability
  // Mengembalikan daftar produk beserta status ketersediaan pada outlet
  routes.get(
    "/:outletId/catalog/products/availability",
    authenticate,
    async (c) => {
      const outletId = c.req.param("outletId");
      assertOutletId(outletId);
      const auth = c.get("auth");

      // Periksa apakah outlet ada di sistem
      const outlet = await prisma.outlet.findUnique({
        where: { id: outletId },
        select: { id: true, name: true, isActive: true },
      });
      if (!outlet) {
        throw new OutletAvailabilityError(
          "NOT_FOUND",
          404,
          "Outlet tidak ditemukan.",
        );
      }

      // Validasi membership: Manager, Owner, Owner Mitra, atau Admin Pusat
      await requireMembership(prisma, auth.userId, outletId, [
        "MANAGER",
        "OWNER",
        "OWNER_MITRA",
        "ADMIN_PUSAT",
      ]);

      // Ambil seluruh produk aktif secara global beserta ketersediaannya khusus pada outlet ini
      const products = await prisma.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          category: true,
          description: true,
          imageUrl: true,
          isActive: true,
          variants: {
            where: { isActive: true },
            select: { id: true, name: true, price: true },
            orderBy: { name: "asc" },
          },
          outletAvailabilities: {
            where: { outletId },
            select: {
              id: true,
              isAvailable: true,
              updatedAt: true,
              updatedById: true,
            },
          },
        },
        orderBy: { name: "asc" },
      });

      // Format output DTO: jika record belum ada, default isAvailable: false (Rule 43)
      const mappedProducts = products.map((product) => {
        const record = product.outletAvailabilities?.[0] ?? null;
        return {
          id: product.id,
          name: product.name,
          category: product.category,
          description: product.description,
          imageUrl: product.imageUrl,
          isAvailable: Boolean(record && record.isAvailable),
          hasAvailabilityRecord: Boolean(record),
          updatedAt: record?.updatedAt?.toISOString?.() ?? null,
          variants: (product.variants ?? []).map((v) => ({
            id: v.id,
            name: v.name,
            price: v.price.toString(),
          })),
        };
      });

      return c.json({
        success: true,
        data: {
          outletId,
          outletName: outlet.name,
          products: mappedProducts,
        },
      });
    },
  );

  // PATCH /:outletId/catalog/products/:productId/availability
  // Mengubah ketersediaan suatu produk pada outlet tertentu (Manager only)
  routes.patch(
    "/:outletId/catalog/products/:productId/availability",
    authenticate,
    async (c) => {
      const outletId = c.req.param("outletId");
      const productId = c.req.param("productId");
      assertOutletId(outletId);
      assertProductId(productId);
      const auth = c.get("auth");

      const bodyRaw = await readJson(c);
      const parsed = availabilitySchema.safeParse(bodyRaw);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues?.[0];
        throw new OutletAvailabilityError(
          "VALIDATION_ERROR",
          400,
          firstIssue?.message || "Format permintaan tidak valid.",
        );
      }
      const { isAvailable } = parsed.data;

      // Periksa apakah outlet ada di sistem
      const outlet = await prisma.outlet.findUnique({
        where: { id: outletId },
        select: { id: true, isActive: true },
      });
      if (!outlet) {
        throw new OutletAvailabilityError(
          "NOT_FOUND",
          404,
          "Outlet tidak ditemukan.",
        );
      }

      // Validasi otorisasi: Khusus role MANAGER yang berwenang mengatur ketersediaan outlet
      await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);

      // Periksa apakah produk ada di sistem
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true, isActive: true },
      });
      if (!product) {
        throw new OutletAvailabilityError(
          "NOT_FOUND",
          404,
          "Produk tidak ditemukan.",
        );
      }

      // Simpan perubahan dengan upsert
      const record = await prisma.outletProductAvailability.upsert({
        where: {
          outletId_productId: {
            outletId,
            productId,
          },
        },
        create: {
          outletId,
          productId,
          isAvailable,
          updatedById: auth.userId,
        },
        update: {
          isAvailable,
          updatedById: auth.userId,
        },
      });

      // Catat log audit
      await writeAuditLog(prisma, {
        actorUserId: auth.userId,
        sessionId: auth.sessionId,
        outletId,
        action: isAvailable
          ? "PRODUCT_AVAILABILITY_ENABLED"
          : "PRODUCT_AVAILABILITY_DISABLED",
        resourceType: "OutletProductAvailability",
        resourceId: record.id,
        metadata: {
          productId,
          productName: product.name,
          isAvailable,
        },
      });

      return c.json({
        success: true,
        data: {
          outletId,
          productId,
          isAvailable: record.isAvailable,
          updatedAt: record.updatedAt?.toISOString?.() ?? new Date().toISOString(),
        },
      });
    },
  );

  return routes;
}
