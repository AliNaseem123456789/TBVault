import "dotenv/config";
import prisma from "../src/config/db.js";
import { pickBrand, brandId } from "./brand-catalog.js";

/**
 * Gives every product without a brand a plausible one for its category (demo data).
 * Products that already have a brand are left alone, so it's safe to re-run.
 *
 *   node scripts/assign-brands.js            assign
 *   node scripts/assign-brands.js --dry-run  show what would be assigned
 */
const dryRun = process.argv.includes("--dry-run");

const main = async () => {
    const products = await prisma.product.findMany({
        where: { brand_id: null },
        select: { id: true, name: true, category: { select: { name: true } } },
        orderBy: { id: "asc" },
    });
    console.log(`${products.length} products without a brand${dryRun ? " (dry run)" : ""}`);
    const counts = {};
    for (const product of products) {
        const name = pickBrand(product.category?.name, product.id);
        counts[name] = (counts[name] ?? 0) + 1;
        if (!dryRun) await prisma.product.update({ where: { id: product.id }, data: { brand_id: await brandId(prisma, name) } });
    }
    console.table(counts);
};

main()
    .catch((err) => {
        console.error("assign-brands error:", err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
