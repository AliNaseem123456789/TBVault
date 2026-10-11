-- Marketplace (brands, sellers, per-seller order fulfilment, seller earnings and payouts)
-- and store credit (wallet, top-ups, gift cards).
-- Existing products and orders move to a platform seller named after the store.

-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "brands" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellers" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "store_name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "SellerStatus" NOT NULL DEFAULT 'PENDING',
    "is_platform" BOOLEAN NOT NULL DEFAULT false,
    "commission_rate" DECIMAL(5,2),
    "admin_note" VARCHAR(500),
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_orders" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "seller_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "commission_rate" DECIMAL(5,2) NOT NULL,
    "commission_amount" DECIMAL(10,2) NOT NULL,
    "seller_earnings" DECIMAL(10,2) NOT NULL,
    "earnings_credited_at" TIMESTAMP(3),
    "tracking_carrier" VARCHAR(100),
    "tracking_number" VARCHAR(100),
    "tracking_url" VARCHAR(500),
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_transactions" (
    "id" SERIAL NOT NULL,
    "seller_id" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "seller_order_id" INTEGER,
    "payout_id" INTEGER,
    "note" VARCHAR(500),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_payouts" (
    "id" SERIAL NOT NULL,
    "seller_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reference" VARCHAR(255),
    "note" VARCHAR(500),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balance_after" DECIMAL(10,2) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "order_id" INTEGER,
    "gift_card_id" INTEGER,
    "topup_id" INTEGER,
    "note" VARCHAR(500),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_topups" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "stripe_checkout_session_id" VARCHAR(255),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_topups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "note" VARCHAR(255),
    "redeemed_by" INTEGER,
    "redeemed_at" TIMESTAMP(3),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "credit_balance" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "credits_applied" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "seller_order_id" INTEGER;

-- AlterTable (seller_id is filled below, then made required)
ALTER TABLE "products" ADD COLUMN     "brand_id" INTEGER,
ADD COLUMN     "seller_id" INTEGER;

-- Backfill: the platform seller owns the existing catalogue.
INSERT INTO "sellers" ("store_name", "slug", "description", "status", "is_platform", "commission_rate", "approved_at", "updated_at")
VALUES (
    COALESCE((SELECT "value" FROM "settings" WHERE "key" = 'store_name' AND "value" <> ''), 'TBVault'),
    'official-store',
    'Products sold and shipped by the store itself.',
    'APPROVED', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

UPDATE "products" SET "seller_id" = (SELECT "id" FROM "sellers" WHERE "is_platform" = true LIMIT 1);
ALTER TABLE "products" ALTER COLUMN "seller_id" SET NOT NULL;

-- Backfill: each existing order becomes one platform shipment with the order's status and tracking.
INSERT INTO "seller_orders" (
    "order_id", "seller_id", "status", "subtotal", "commission_rate", "commission_amount", "seller_earnings",
    "earnings_credited_at", "tracking_carrier", "tracking_number", "tracking_url",
    "shipped_at", "delivered_at", "cancelled_at", "created_at", "updated_at"
)
SELECT o."id", (SELECT "id" FROM "sellers" WHERE "is_platform" = true LIMIT 1), o."status", o."subtotal", 0, 0, o."subtotal",
       CURRENT_TIMESTAMP, o."tracking_carrier", o."tracking_number", o."tracking_url",
       o."shipped_at", o."delivered_at", o."cancelled_at", o."created_at", CURRENT_TIMESTAMP
FROM "orders" o;

UPDATE "order_items" oi SET "seller_order_id" = so."id"
FROM "seller_orders" so WHERE so."order_id" = oi."order_id";

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_user_id_key" ON "sellers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_store_name_key" ON "sellers"("store_name");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_slug_key" ON "sellers"("slug");

-- CreateIndex
CREATE INDEX "sellers_status_idx" ON "sellers"("status");

-- CreateIndex
CREATE INDEX "seller_orders_seller_id_status_idx" ON "seller_orders"("seller_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seller_orders_order_id_seller_id_key" ON "seller_orders"("order_id", "seller_id");

-- CreateIndex
CREATE INDEX "seller_transactions_seller_id_created_at_idx" ON "seller_transactions"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "seller_payouts_seller_id_idx" ON "seller_payouts"("seller_id");

-- CreateIndex
CREATE INDEX "credit_transactions_user_id_created_at_idx" ON "credit_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_transactions_order_id_idx" ON "credit_transactions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_topups_stripe_checkout_session_id_key" ON "credit_topups"("stripe_checkout_session_id");

-- CreateIndex
CREATE INDEX "credit_topups_user_id_idx" ON "credit_topups"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_code_key" ON "gift_cards"("code");

-- CreateIndex
CREATE INDEX "order_items_seller_order_id_idx" ON "order_items"("seller_order_id");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "products_seller_id_idx" ON "products"("seller_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_transactions" ADD CONSTRAINT "seller_transactions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_transactions" ADD CONSTRAINT "seller_transactions_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_transactions" ADD CONSTRAINT "seller_transactions_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "seller_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_payouts" ADD CONSTRAINT "seller_payouts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_topup_id_fkey" FOREIGN KEY ("topup_id") REFERENCES "credit_topups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_topups" ADD CONSTRAINT "credit_topups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_redeemed_by_fkey" FOREIGN KEY ("redeemed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
