/**
 * Seed data for local development. Safe to run more than once (everything is upserted).
 *
 *   npx prisma db seed
 *
 * Admin account comes from .env, never from code:
 *   SEED_ADMIN_EMAIL=you@example.com
 *   SEED_ADMIN_PASSWORD=a-long-password
 * If that email already has an account (e.g. your Google login), it is promoted to ADMIN
 * and its password is left alone.
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import prisma from "../src/config/db.js";

const CATEGORIES = ["Audio", "Accessories", "Home", "Wearables"];

const PRODUCTS = [
  { name: "Studio Wireless Headphones", category: "Audio", price: 129.99, stock: 25, description: "Over-ear, active noise cancelling, 30-hour battery." },
  { name: "Pocket Bluetooth Speaker", category: "Audio", price: 39.99, stock: 60, description: "Water resistant, 12-hour battery, fits in a jacket pocket." },
  { name: "Braided USB-C Cable (2 m)", category: "Accessories", price: 12.5, stock: 200, description: "Fast charging, reinforced connectors." },
  { name: "Leather Laptop Sleeve 14\"", category: "Accessories", price: 49.0, stock: 15, description: "Full-grain leather with a soft felt lining." },
  { name: "Ceramic Pour-Over Set", category: "Home", price: 34.0, stock: 30, description: "Dripper, carafe and two cups." },
  { name: "Linen Throw Blanket", category: "Home", price: 58.0, stock: 0, description: "Stonewashed linen, 130 × 170 cm." },
  { name: "Fitness Band Pro", category: "Wearables", price: 79.0, stock: 40, description: "Heart rate, sleep tracking, 10-day battery." },
  {
    name: "Merino Crew Tee", category: "Wearables", price: 45.0, stock: 0, description: "Lightweight merino wool, three sizes.",
    variants: [
      { name: "S", sku: "TEE-S", options: { Size: "S" }, stock: 8, sort_order: 1 },
      { name: "M", sku: "TEE-M", options: { Size: "M" }, stock: 12, sort_order: 2 },
      { name: "L", sku: "TEE-L", options: { Size: "L" }, price: 48.0, stock: 0, sort_order: 3 },
    ],
  },
];

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email) {
    console.log("• SEED_ADMIN_EMAIL not set, skipping admin account");
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
    console.log(`• ${email} promoted to ADMIN`);
    return;
  }
  if (!password || password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be set (8+ characters) to create a new admin account");
  }
  await prisma.user.create({
    data: { email, name: "Admin", password: await bcrypt.hash(password, 12), role: "ADMIN", is_verified: true },
  });
  console.log(`• created admin ${email}`);
}

async function seedCatalog() {
  const categoryIds = {};
  for (const name of CATEGORIES) {
    const category = await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
    categoryIds[name] = category.id;
  }
  console.log(`• ${CATEGORIES.length} categories`);

  let created = 0;
  for (const p of PRODUCTS) {
    // Product names aren't unique in the schema, so check before creating.
    const exists = await prisma.product.findFirst({ where: { name: p.name } });
    if (exists) continue;
    await prisma.product.create({
      data: {
        name: p.name, description: p.description, price: p.price, stock: p.stock, category_id: categoryIds[p.category],
        ...(p.variants ? { variants: { create: p.variants } } : {}),
      },
    });
    created++;
  }
  console.log(`• ${created} new products (${PRODUCTS.length - created} already existed)`);
}

// A default shipping zone, a welcome coupon and a category sale, so checkout has something to show.
async function seedStore() {
  if ((await prisma.shippingZone.count()) === 0) {
    await prisma.shippingZone.create({ data: { name: "Standard", regions: [], rate: 5, free_over: 50, is_default: true } });
    console.log("• default shipping zone: $5, free over $50");
  }
  await prisma.coupon.upsert({
    where: { code: "WELCOME10" },
    update: {},
    create: { code: "WELCOME10", description: "10% off your first order", type: "PERCENT", value: 10, per_user_limit: 1 },
  });
  const home = await prisma.category.findUnique({ where: { name: "Home" } });
  if (home && (await prisma.sale.count({ where: { category_id: home.id } })) === 0) {
    await prisma.sale.create({
      data: { name: "Home week", percent_off: 15, category_id: home.id, starts_at: new Date(), ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
    });
    console.log("• 15% sale on Home for 14 days");
  }
  console.log("• coupon WELCOME10");
}

try {
  await seedAdmin();
  await seedCatalog();
  await seedStore();
  console.log("Seed complete.");
} catch (err) {
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
