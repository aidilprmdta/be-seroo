import { Prisma } from "@prisma/client";
import { CatalogAdminError } from "./errors.js";

export async function listAdminCatalog(prisma) {
  const [products, addOns] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        imageUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        variants: {
          select: {
            id: true,
            name: true,
            price: true,
            isActive: true,
          },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.addOn.findMany({
      select: {
        id: true,
        name: true,
        price: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    products: products.map((product) => ({
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        price: variant.price.toString(),
      })),
    })),
    addOns: addOns.map((addOn) => ({
      ...addOn,
      price: addOn.price.toString(),
    })),
  };
}

export async function createProduct(prisma, { name, description, category, imageUrl, variants }) {
  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new CatalogAdminError("VALIDATION_ERROR", 400, "Nama produk wajib diisi.");
  }

  if (!Array.isArray(variants) || variants.length === 0) {
    throw new CatalogAdminError("VALIDATION_ERROR", 400, "Produk harus memiliki minimal satu varian ukuran/harga.");
  }

  const variantRecords = variants.map((v) => {
    const vName = v.name?.trim();
    if (!vName) {
      throw new CatalogAdminError("VALIDATION_ERROR", 400, "Nama varian wajib diisi.");
    }
    const priceNum = Number(v.price);
    if (isNaN(priceNum) || priceNum < 0) {
      throw new CatalogAdminError("VALIDATION_ERROR", 400, "Harga varian harus berupa angka non-negatif.");
    }
    return {
      name: vName,
      price: new Prisma.Decimal(v.price.toString()),
      isActive: v.isActive !== undefined ? Boolean(v.isActive) : true,
    };
  });

  const created = await prisma.product.create({
    data: {
      name: trimmedName,
      description: description?.trim() || null,
      category: category?.trim() || null,
      imageUrl: imageUrl?.trim() || null,
      isActive: true,
      variants: {
        create: variantRecords,
      },
    },
    include: {
      variants: true,
    },
  });

  return {
    ...created,
    variants: created.variants.map((v) => ({
      ...v,
      price: v.price.toString(),
    })),
  };
}

export async function updateProduct(prisma, productId, data) {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
  });
  if (!existing) {
    throw new CatalogAdminError("NOT_FOUND", 404, "Produk tidak ditemukan.");
  }

  const updateData = {};
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) throw new CatalogAdminError("VALIDATION_ERROR", 400, "Nama produk tidak boleh kosong.");
    updateData.name = trimmed;
  }
  if (data.description !== undefined) updateData.description = data.description ? data.description.trim() : null;
  if (data.category !== undefined) updateData.category = data.category ? data.category.trim() : null;
  if (data.isActive !== undefined) updateData.isActive = Boolean(data.isActive);

  const updated = await prisma.product.update({
    where: { id: productId },
    data: updateData,
    include: {
      variants: true,
    },
  });

  return {
    ...updated,
    variants: updated.variants.map((v) => ({
      ...v,
      price: v.price.toString(),
    })),
  };
}

export async function updateVariant(prisma, variantId, data) {
  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
  });
  if (!existing) {
    throw new CatalogAdminError("NOT_FOUND", 404, "Varian produk tidak ditemukan.");
  }

  const updateData = {};
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) throw new CatalogAdminError("VALIDATION_ERROR", 400, "Nama varian tidak boleh kosong.");
    updateData.name = trimmed;
  }
  if (data.price !== undefined) {
    const priceNum = Number(data.price);
    if (isNaN(priceNum) || priceNum < 0) {
      throw new CatalogAdminError("VALIDATION_ERROR", 400, "Harga varian harus berupa angka non-negatif.");
    }
    updateData.price = new Prisma.Decimal(data.price.toString());
  }
  if (data.isActive !== undefined) updateData.isActive = Boolean(data.isActive);

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: updateData,
  });

  return {
    ...updated,
    price: updated.price.toString(),
  };
}

export async function createAddOn(prisma, { name, price }) {
  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new CatalogAdminError("VALIDATION_ERROR", 400, "Nama add-on wajib diisi.");
  }
  const priceNum = Number(price);
  if (isNaN(priceNum) || priceNum < 0) {
    throw new CatalogAdminError("VALIDATION_ERROR", 400, "Harga add-on harus berupa angka non-negatif.");
  }

  const created = await prisma.addOn.create({
    data: {
      name: trimmedName,
      price: new Prisma.Decimal(price.toString()),
      isActive: true,
    },
  });

  return {
    ...created,
    price: created.price.toString(),
  };
}

export async function updateAddOn(prisma, addOnId, data) {
  const existing = await prisma.addOn.findUnique({
    where: { id: addOnId },
  });
  if (!existing) {
    throw new CatalogAdminError("NOT_FOUND", 404, "Add-on tidak ditemukan.");
  }

  const updateData = {};
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) throw new CatalogAdminError("VALIDATION_ERROR", 400, "Nama add-on tidak boleh kosong.");
    updateData.name = trimmed;
  }
  if (data.price !== undefined) {
    const priceNum = Number(data.price);
    if (isNaN(priceNum) || priceNum < 0) {
      throw new CatalogAdminError("VALIDATION_ERROR", 400, "Harga add-on harus berupa angka non-negatif.");
    }
    updateData.price = new Prisma.Decimal(data.price.toString());
  }
  if (data.isActive !== undefined) updateData.isActive = Boolean(data.isActive);

  const updated = await prisma.addOn.update({
    where: { id: addOnId },
    data: updateData,
  });

  return {
    ...updated,
    price: updated.price.toString(),
  };
}

