import { Hono } from "hono";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { RecipeError } from "./errors.js";
import {
  listRecipes,
  getVariantRecipe,
  setVariantRecipe,
  createOrUpdateRecipeItem,
  deleteRecipeItem,
} from "./service.js";

async function requireAdminPusat(prisma, userId) {
  const adminMembership = await prisma.outletMembership.findFirst({
    where: {
      userId,
      role: "ADMIN_PUSAT",
    },
  });

  if (!adminMembership) {
    throw new RecipeError(
      "FORBIDDEN",
      403,
      "Hanya Admin Pusat / Brand Owner yang berwenang mengatur resep menu.",
    );
  }
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new RecipeError("VALIDATION_ERROR", 400, "Format permintaan JSON tidak valid.");
    }
    throw error;
  }
}

export function createRecipeRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  // List all recipes (accessible to all authenticated roles)
  routes.get("/", authenticate, async (c) => {
    const productId = c.req.query("productId");
    const productVariantId = c.req.query("productVariantId");
    const data = await listRecipes(prisma, { productId, productVariantId });
    return c.json({ success: true, data: { recipes: data } });
  });

  // List active ingredients/inventory items for recipe building
  routes.get("/ingredients", authenticate, async (c) => {
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    });
    return c.json({ success: true, data: { ingredients: items } });
  });

  // Get recipe for a single variant
  routes.get("/variants/:variantId", authenticate, async (c) => {
    const variantId = c.req.param("variantId");
    const data = await getVariantRecipe(prisma, variantId);
    return c.json({ success: true, data });
  });

  // Replace / set entire recipe for a variant (Admin Pusat only)
  routes.put("/variants/:variantId", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const variantId = c.req.param("variantId");
    const body = await readJson(c);
    const data = await setVariantRecipe(prisma, variantId, body.items || []);
    return c.json({ success: true, data });
  });

  // Add or update a single recipe item (Admin Pusat only)
  routes.post("/", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const body = await readJson(c);
    const data = await createOrUpdateRecipeItem(prisma, body);
    return c.json({ success: true, data: { recipe: data } }, 201);
  });

  // Delete a recipe item (Admin Pusat only)
  routes.delete("/:id", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const id = c.req.param("id");
    const data = await deleteRecipeItem(prisma, id);
    return c.json({ success: true, data });
  });

  return routes;
}

