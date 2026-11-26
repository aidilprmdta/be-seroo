import { Hono } from "hono";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { CatalogAdminError } from "./errors.js";
import {
  listAdminCatalog,
  createProduct,
  updateProduct,
  createVariant,
  updateVariant,
  createAddOn,
  updateAddOn,
} from "./service.js";

async function requireAdminPusat(prisma, userId) {
  const adminMembership = await prisma.outletMembership.findFirst({
    where: {
      userId,
      role: "ADMIN_PUSAT",
    },
  });

  if (!adminMembership) {
    throw new CatalogAdminError(
      "FORBIDDEN",
      403,
      "Hanya Admin Pusat / Brand Owner yang berwenang mengatur katalog menu dan harga.",
    );
  }
}

async function readJson(c) {
  try {
    const raw = await c.req.json();
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CatalogAdminError("VALIDATION_ERROR", 400, "Format permintaan JSON tidak valid.");
    }
    throw error;
  }
}

export function createCatalogAdminRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  // List all catalog items (Admin view)
  routes.get("/products", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const data = await listAdminCatalog(prisma);
    return c.json({ success: true, data });
  });

  // Create product
  routes.post("/products", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const body = await readJson(c);
    const product = await createProduct(prisma, body);
    return c.json({ success: true, data: { product } }, 201);
  });

  // Update product
  routes.patch("/products/:id", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const productId = c.req.param("id");
    const body = await readJson(c);
    const product = await updateProduct(prisma, productId, body);
    return c.json({ success: true, data: { product } });
  });

  // Create variant for an existing product
  routes.post("/variants", authenticate, async (c) => {
    const caller = c.get("auth");
    await requireAdminPusat(prisma, caller.userId);
    const body = await readJson(c);
    const variant = await createVariant(prisma, body);
    return c.json({ success: true, data: { variant } }, 201);
  });

  // Update variant price / status
  routes.patch("/variants/:id", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const variantId = c.req.param("id");
    const body = await readJson(c);
    const variant = await updateVariant(prisma, variantId, body);
    return c.json({ success: true, data: { variant } });
  });

  // Create add-on
  routes.post("/add-ons", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const body = await readJson(c);
    const addOn = await createAddOn(prisma, body);
    return c.json({ success: true, data: { addOn } }, 201);
  });

  // Update add-on price / status
  routes.patch("/add-ons/:id", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const addOnId = c.req.param("id");
    const body = await readJson(c);
    const addOn = await updateAddOn(prisma, addOnId, body);
    return c.json({ success: true, data: { addOn } });
  });

  return routes;
}

