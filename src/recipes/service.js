import { Prisma } from "@prisma/client";
import { RecipeError } from "./errors.js";

export function recipeDto(r) {
  return {
    id: r.id,
    productVariantId: r.productVariantId,
    productId: r.productVariant?.product?.id ?? r.productVariant?.productId ?? null,
    productName: r.productVariant?.product?.name ?? "Produk",
    variantName: r.productVariant?.name ?? "Varian",
    variantPrice: r.productVariant?.price ? r.productVariant.price.toString() : "0.00",
    inventoryItemId: r.inventoryItemId,
    ingredientName: r.inventoryItem?.name ?? "Bahan",
    quantity: r.quantity ? Number(r.quantity).toFixed(3) : "0.000",
    unit: r.inventoryItem?.unit ?? "",
  };
}

export async function listRecipes(prisma, { productId, productVariantId } = {}) {
  const where = {};
  if (productVariantId) {
    where.productVariantId = productVariantId;
  } else if (productId) {
    where.productVariant = { productId };
  }

  const recipes = await prisma.recipeItem.findMany({
    where,
    include: {
      productVariant: {
        include: { product: true },
      },
      inventoryItem: true,
    },
    orderBy: [
      { productVariant: { product: { name: "asc" } } },
      { productVariant: { name: "asc" } },
      { inventoryItem: { name: "asc" } },
    ],
  });

  return recipes.map(recipeDto);
}

export async function getVariantRecipe(prisma, variantId) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });

  if (!variant) {
    throw new RecipeError("NOT_FOUND", 404, "Varian produk tidak ditemukan.");
  }

  const items = await prisma.recipeItem.findMany({
    where: { productVariantId: variantId },
    include: {
      productVariant: { include: { product: true } },
      inventoryItem: true,
    },
    orderBy: { inventoryItem: { name: "asc" } },
  });

  return {
    productVariantId: variant.id,
    productId: variant.productId,
    productName: variant.product.name,
    variantName: variant.name,
    variantPrice: variant.price.toString(),
    items: items.map(recipeDto),
  };
}

export async function setVariantRecipe(prisma, variantId, items) {
  if (!Array.isArray(items)) {
    throw new RecipeError("VALIDATION_ERROR", 400, "Daftar bahan resep harus berupa array.");
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });
  if (!variant) {
    throw new RecipeError("NOT_FOUND", 404, "Varian produk tidak ditemukan.");
  }

  // Validate items
  const validatedItems = [];
  const seenItems = new Set();

  for (const it of items) {
    if (!it.inventoryItemId || typeof it.inventoryItemId !== "string") {
      throw new RecipeError("VALIDATION_ERROR", 400, "ID bahan baku wajib diisi.");
    }
    if (seenItems.has(it.inventoryItemId)) {
      throw new RecipeError("VALIDATION_ERROR", 400, "Bahan baku tidak boleh diduplikasi dalam satu resep.");
    }
    seenItems.add(it.inventoryItemId);

    const qtyNum = Number(it.quantity);
    if (!it.quantity || isNaN(qtyNum) || qtyNum <= 0) {
      throw new RecipeError("VALIDATION_ERROR", 400, "Jumlah pemakaian bahan harus lebih besar dari 0.");
    }

    validatedItems.push({
      inventoryItemId: it.inventoryItemId,
      quantity: new Prisma.Decimal(it.quantity.toString()),
    });
  }

  // Check all inventory items exist
  if (validatedItems.length > 0) {
    const itemIds = validatedItems.map((it) => it.inventoryItemId);
    const existingItems = await prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, isActive: true },
    });
    if (existingItems.length !== itemIds.length) {
      throw new RecipeError("NOT_FOUND", 404, "Sebagian bahan baku tidak ditemukan atau tidak aktif.");
    }
  }

  return await prisma.$transaction(async (tx) => {
    // Delete old recipe items for this variant
    await tx.recipeItem.deleteMany({
      where: { productVariantId: variantId },
    });

    // Insert new items
    for (const it of validatedItems) {
      await tx.recipeItem.create({
        data: {
          productVariantId: variantId,
          inventoryItemId: it.inventoryItemId,
          quantity: it.quantity,
        },
      });
    }

    // Return updated recipe
    const updated = await tx.recipeItem.findMany({
      where: { productVariantId: variantId },
      include: {
        productVariant: { include: { product: true } },
        inventoryItem: true,
      },
      orderBy: { inventoryItem: { name: "asc" } },
    });

    return {
      productVariantId: variant.id,
      productId: variant.productId,
      productName: variant.product.name,
      variantName: variant.name,
      variantPrice: variant.price.toString(),
      items: updated.map(recipeDto),
    };
  });
}

export async function createOrUpdateRecipeItem(prisma, { productVariantId, inventoryItemId, quantity }) {
  if (!productVariantId || !inventoryItemId || !quantity) {
    throw new RecipeError("VALIDATION_ERROR", 400, "Varian, bahan baku, dan jumlah pemakaian wajib diisi.");
  }

  const qtyNum = Number(quantity);
  if (isNaN(qtyNum) || qtyNum <= 0) {
    throw new RecipeError("VALIDATION_ERROR", 400, "Jumlah pemakaian bahan harus lebih besar dari 0.");
  }

  const [variant, item] = await Promise.all([
    prisma.productVariant.findUnique({
      where: { id: productVariantId },
      include: { product: true },
    }),
    prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    }),
  ]);

  if (!variant) throw new RecipeError("NOT_FOUND", 404, "Varian produk tidak ditemukan.");
  if (!item || !item.isActive) throw new RecipeError("NOT_FOUND", 404, "Bahan baku tidak ditemukan.");

  const decQty = new Prisma.Decimal(quantity.toString());

  const recipe = await prisma.recipeItem.upsert({
    where: {
      productVariantId_inventoryItemId: {
        productVariantId,
        inventoryItemId,
      },
    },
    create: {
      productVariantId,
      inventoryItemId,
      quantity: decQty,
    },
    update: {
      quantity: decQty,
    },
    include: {
      productVariant: { include: { product: true } },
      inventoryItem: true,
    },
  });

  return recipeDto(recipe);
}

export async function deleteRecipeItem(prisma, id) {
  const existing = await prisma.recipeItem.findUnique({ where: { id } });
  if (!existing) {
    throw new RecipeError("NOT_FOUND", 404, "Resep tidak ditemukan.");
  }

  await prisma.recipeItem.delete({ where: { id } });
  return { deleted: true, id };
}
