// Seed data MVP Seroo: katalog, add-on, item stok, stok per outlet, kategori pengeluaran.
// Aman dijalankan ulang (idempoten) dan hanya boleh terhadap database lokal.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedProvisionalExpenseCategories } from "./seed.js";

const PRODUCTS = [
  {
    id: "prod-teh-tarik",
    name: "Teh Tarik Seroo",
    description: "Teh tarik khas Seroo dengan susu kental manis.",
    category: "Teh Tarik",
    variants: [
      { id: "var-teh-regular", name: "Regular", price: "10000" },
      { id: "var-teh-large", name: "Large", price: "12000" },
      { id: "var-teh-special", name: "Special", price: "15000" },
    ],
  },
  {
    id: "prod-kopi-tarik",
    name: "Kopi Tarik",
    description: "Kopi tarik dengan perpaduan kopi dan susu.",
    category: "Kopi",
    variants: [
      { id: "var-kopi-regular", name: "Regular", price: "12000" },
      { id: "var-kopi-large", name: "Large", price: "14000" },
    ],
  },
  {
    id: "prod-teh-putih",
    name: "Teh Putih",
    description: "Teh putih disajikan panas atau dingin.",
    category: "Teh",
    variants: [
      { id: "var-teh-putih-panas", name: "Panas", price: "10000" },
      { id: "var-teh-putih-dingin", name: "Dingin", price: "10000" },
    ],
  },
  {
    id: "prod-milo-tarik",
    name: "Milo Tarik",
    description: "Minuman cokelat malt khas Seroo.",
    category: "Cokelat",
    variants: [
      { id: "var-milo-regular", name: "Regular", price: "14000" },
      { id: "var-milo-large", name: "Large", price: "16000" },
    ],
  },
];

const ADD_ONS = [
  { id: "addon-extra-susu", name: "Extra Susu", price: "3000" },
  { id: "addon-extra-teh", name: "Extra Teh", price: "2000" },
  { id: "addon-whipped-cream", name: "Whipped Cream", price: "4000" },
  { id: "addon-gula-aren", name: "Gula Aren", price: "2000" },
];

const INVENTORY_ITEMS = [
  { id: "inv-teh-bubuk", name: "Teh Bubuk", unit: "kg", quantity: "5" },
  { id: "inv-kopi-bubuk", name: "Kopi Bubuk", unit: "kg", quantity: "3" },
  { id: "inv-milo-bubuk", name: "Milo Bubuk", unit: "kg", quantity: "4" },
  { id: "inv-susu-kental", name: "Susu Kental Manis", unit: "kaleng", quantity: "48" },
  { id: "inv-gula-pasir", name: "Gula Pasir", unit: "kg", quantity: "10" },
  { id: "inv-air-galon", name: "Air Galon", unit: "galon", quantity: "8" },
  { id: "inv-es-batu", name: "Es Batu", unit: "karung", quantity: "6" },
  { id: "inv-cup-kecil", name: "Cup Kecil", unit: "pcs", quantity: "300" },
  { id: "inv-cup-besar", name: "Cup Besar", unit: "pcs", quantity: "200" },
  { id: "inv-sedotan", name: "Sedotan", unit: "pack", quantity: "20" },
];

function assertLocalDatabase(databaseUrl) {
  let host;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL tidak valid.");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error("Seed hanya diizinkan untuk database PostgreSQL lokal.");
  }
}

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL || "");

  const prisma = new PrismaClient();
  try {
    await seedProvisionalExpenseCategories(prisma);

    const outlets = await prisma.outlet.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let variantCount = 0;
    for (const product of PRODUCTS) {
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
            price: variant.price,
            isActive: true,
          },
          update: { price: variant.price, isActive: true },
        });
        variantCount += 1;
      }
    }

    for (const addOn of ADD_ONS) {
      await prisma.addOn.upsert({
        where: { id: addOn.id },
        create: { ...addOn, isActive: true },
        update: { name: addOn.name, price: addOn.price, isActive: true },
      });
    }

    for (const item of INVENTORY_ITEMS) {
      await prisma.inventoryItem.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          name: item.name,
          unit: item.unit,
          isActive: true,
        },
        update: { name: item.name, unit: item.unit, isActive: true },
      });

      for (const outlet of outlets) {
        // Prisma Client menyisipkan default minimumQuantity dari schema,
        // tetapi kolom itu belum ada di DB. Gunakan SQL mentah yang hanya
        // menulis kolom yang benar-benar tersedia.
        await prisma.$executeRaw`
          INSERT INTO "OutletStock"
            ("id", "outletId", "inventoryItemId", "quantity", "updatedAt")
          VALUES
            (${`stock_${outlet.id}_${item.id}`}, ${outlet.id}, ${item.id}, ${item.quantity}::numeric, NOW())
          ON CONFLICT ("outletId", "inventoryItemId") DO NOTHING
        `;
      }
    }

    const counts = {
      products: await prisma.product.count(),
      variants: await prisma.productVariant.count(),
      addOns: await prisma.addOn.count(),
      inventoryItems: await prisma.inventoryItem.count(),
      outletStocks: await prisma.outletStock.count(),
      expenseCategories: await prisma.expenseCategory.count(),
    };

    console.info("Seed katalog selesai:", JSON.stringify(counts));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    "Seed katalog gagal:",
    error instanceof Error ? error.message : "UnknownError",
  );
  process.exitCode = 1;
});
