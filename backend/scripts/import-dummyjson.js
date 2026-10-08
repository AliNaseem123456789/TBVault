import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import bcrypt from "bcrypt";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import prisma from "../src/config/db.js";
import storage, { BUCKET } from "../src/config/storage.js";

/**
 * Fills the store with demo products from https://dummyjson.com.
 *
 *   node scripts/import-dummyjson.js                                  all 194 products
 *   node scripts/import-dummyjson.js --categories=mens-shirts,tops    only these categories
 *   node scripts/import-dummyjson.js --limit=20                       first 20 products
 *   node scripts/import-dummyjson.js --dry-run                        show what would happen
 *
 * For each product it:
 *   - creates the category if needed ("mens-shirts" -> "Mens Shirts")
 *   - creates the product (name, description, price, stock)
 *   - downloads its photos and uploads them to the S3 bucket at products/<id>/<uuid>.webp,
 *     the same layout as admin uploads; the first photo is the primary one
 *   - turns discountPercentage >= --sale-min (default 10) into a 30-day product sale
 *   - imports its reviews, written by demo customers (@demo.tbvault.local, they can't log in)
 *
 * Safe to re-run: a product whose name already exists in that category is skipped.
 */

const API = process.env.DUMMYJSON_URL || "https://dummyjson.com";
const DEMO_EMAIL_DOMAIN = "demo.tbvault.local";
const SALE_DAYS = 30;

const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return fallback;
    return hit.includes("=") ? hit.split("=")[1] : true;
};
const onlyCategories = arg("categories", "") ? String(arg("categories")).split(",").map((s) => s.trim()) : null;
const limit = Number(arg("limit", 0)) || 0;
const saleMin = Number(arg("sale-min", 10));
const dryRun = Boolean(arg("dry-run", false));

const categoryName = (slug) => slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

const getJson = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
};

const fetchProducts = async () => {
    if (!onlyCategories) {
        const { products } = await getJson(`${API}/products?limit=0`);
        return products;
    }
    const lists = await Promise.all(onlyCategories.map((slug) => getJson(`${API}/products/category/${slug}?limit=0`)));
    return lists.flatMap((l) => l.products);
};

// Downloads one image and stores it under the product's folder in the bucket.
const uploadImage = async (productId, url, isPrimary) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/webp";
    const extension = path.extname(new URL(url).pathname) || ".webp";
    const key = `products/${productId}/${crypto.randomUUID()}${extension}`;

    await storage.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: mime }));

    return {
        product_id: productId,
        key,
        original_name: path.basename(new URL(url).pathname),
        mime_type: mime,
        size: body.length,
        is_primary: isPrimary,
    };
};

const categoryIds = new Map();
const getCategoryId = async (slug) => {
    if (!categoryIds.has(slug)) {
        const name = categoryName(slug);
        const category = await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
        categoryIds.set(slug, category.id);
    }
    return categoryIds.get(slug);
};

// Reviewers become customer accounts with an unusable random password.
let reviewerPassword;
const reviewerIds = new Map();
const getReviewerId = async (review) => {
    const local = review.reviewerEmail?.split("@")[0] || review.reviewerName.toLowerCase().replace(/[^a-z0-9]+/g, ".");
    const email = `${local}@${DEMO_EMAIL_DOMAIN}`;
    if (!reviewerIds.has(email)) {
        reviewerPassword ??= await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
        const user = await prisma.user.upsert({
            where: { email },
            update: {},
            create: { email, name: review.reviewerName.slice(0, 50), password: reviewerPassword, is_verified: true },
        });
        reviewerIds.set(email, user.id);
    }
    return reviewerIds.get(email);
};

const importProduct = async (item) => {
    const name = item.title.slice(0, 100);
    const categoryId = await getCategoryId(item.category);

    const existing = await prisma.product.findFirst({ where: { name, category_id: categoryId }, select: { id: true } });
    if (existing) return { skipped: true };

    const product = await prisma.product.create({
        data: {
            name,
            description: item.description,
            price: item.price.toFixed(2),
            stock: item.stock ?? 0,
            category_id: categoryId,
        },
    });

    // Photos: the product's gallery, or the thumbnail if it has none. Uploaded in parallel.
    const urls = item.images?.length ? item.images : [item.thumbnail].filter(Boolean);
    const settled = await Promise.allSettled(urls.map((url, i) => uploadImage(product.id, url, i === 0)));
    const images = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
    settled.filter((s) => s.status === "rejected").forEach((s) => console.warn(`  ! image failed: ${s.reason.message}`));
    if (images.length && !images.some((img) => img.is_primary)) images[0].is_primary = true;
    if (images.length) await prisma.productImage.createMany({ data: images });

    let sale = false;
    const percentOff = Math.min(90, Math.round(item.discountPercentage ?? 0));
    if (percentOff >= saleMin) {
        const now = new Date();
        await prisma.sale.create({
            data: {
                name: `${percentOff}% off ${name}`.slice(0, 100),
                percent_off: percentOff,
                product_id: product.id,
                starts_at: now,
                ends_at: new Date(now.getTime() + SALE_DAYS * 24 * 60 * 60 * 1000),
            },
        });
        sale = true;
    }

    let reviews = 0;
    for (const review of item.reviews ?? []) {
        const userId = await getReviewerId(review);
        const created = await prisma.review.createMany({
            data: [{
                product_id: product.id,
                user_id: userId,
                rating: Math.min(5, Math.max(1, Math.round(review.rating))),
                comment: review.comment,
                created_at: review.date ? new Date(review.date) : undefined,
            }],
            skipDuplicates: true, // one review per user per product
        });
        reviews += created.count;
    }

    return { id: product.id, images: images.length, imageTotal: urls.length, sale, reviews };
};

const main = async () => {
    if (!dryRun) await prisma.$queryRaw`SELECT 1`; // fail fast if DATABASE_URL is wrong or unreachable
    console.log(`Fetching products from ${API}${onlyCategories ? ` (categories: ${onlyCategories.join(", ")})` : ""}...`);
    let items = await fetchProducts();
    if (limit) items = items.slice(0, limit);
    console.log(`${items.length} products to import into bucket "${BUCKET}"${dryRun ? " (dry run)" : ""}`);

    if (dryRun) {
        const byCategory = {};
        for (const item of items) byCategory[categoryName(item.category)] = (byCategory[categoryName(item.category)] ?? 0) + 1;
        console.table(byCategory);
        console.log(`Images: ${items.reduce((n, i) => n + (i.images?.length || 1), 0)}, sales: ${items.filter((i) => Math.round(i.discountPercentage ?? 0) >= saleMin).length}, reviews: ${items.reduce((n, i) => n + (i.reviews?.length ?? 0), 0)}`);
        return;
    }

    const totals = { created: 0, skipped: 0, failed: 0, images: 0, sales: 0, reviews: 0 };
    for (const [index, item] of items.entries()) {
        const label = `[${index + 1}/${items.length}] ${item.title}`;
        try {
            const result = await importProduct(item);
            if (result.skipped) {
                totals.skipped++;
                console.log(`${label} - already exists, skipped`);
                continue;
            }
            totals.created++;
            totals.images += result.images;
            totals.sales += result.sale ? 1 : 0;
            totals.reviews += result.reviews;
            console.log(`${label} -> #${result.id}, ${result.images}/${result.imageTotal} images${result.sale ? ", on sale" : ""}, ${result.reviews} reviews`);
        } catch (err) {
            totals.failed++;
            console.error(`${label} - failed: ${err.message}`);
        }
    }

    console.log("\nDone.");
    console.table(totals);
};

main()
    .catch((err) => {
        console.error("import-dummyjson error:", err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
