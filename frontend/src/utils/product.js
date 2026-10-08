// Base URL the storage `key` returned by the API is resolved against
// to build a fetchable image URL, e.g. `${base}/products/12/abc.jpg`.
// Override by setting VITE_MEDIA_BASE_URL in a .env file at the
// frontend root (then restart `npm run dev`). For AWS S3 that is
// https://BUCKET.s3.REGION.amazonaws.com; this default assumes local
// MinIO on its default port with the "tbvault" bucket public-read.
const MEDIA_BASE_URL = import.meta.env.VITE_MEDIA_BASE_URL || 'http://localhost:9000/tbvault';

export const getImageUrl = (key) => (key ? `${MEDIA_BASE_URL}/${key}` : undefined);

/**
 * What one unit costs, for a product or one of its variants:
 *   { price, listPrice, onSale }   (strings with 2 decimals)
 * `price` is what the customer pays (sale price when a sale is live); `listPrice`
 * is the original, for the struck-through price. The API computes sale prices,
 * so this only picks the right field.
 */
export const unitPrice = (product, variant = null) => {
  if (!product) return { price: '0.00', listPrice: '0.00', onSale: false };
  const listPrice = Number(variant?.effective_list_price ?? variant?.price ?? product.price).toFixed(2);
  const sale = variant ? variant.sale_price : product.sale_price;
  return { price: sale ? Number(sale).toFixed(2) : listPrice, listPrice, onSale: Boolean(sale) };
};

/** Active variants of a product (the API only sends active ones to the storefront). */
export const activeVariants = (product) => (product?.variants ?? []).filter((v) => v.is_active !== false);

/** In stock when the product, or any of its options, has stock. */
export const isInStock = (product) => {
  const variants = activeVariants(product);
  return variants.length ? variants.some((v) => v.stock > 0) : product.stock > 0;
};

/**
 * Maps a raw row from GET /products (see products.controller.js) to
 * the shape <ProductCard> expects. Shared by every product grid so they
 * all show prices, sale badges and stock the same way.
 *
 * Both GET /products and GET /products/:id return `images` ordered
 * primary-first, so images[0] (if present) is always the one to show.
 * ProductCard falls back to the placeholder art if there's no image,
 * or if the resolved URL 404s (see its onError handler) — so a wrong
 * MEDIA_BASE_URL degrades gracefully instead of showing a broken image.
 *
 * Products with options show the cheapest option ("From $x"), and Quick add
 * sends people to the product page to pick one.
 */
export const mapProductForCard = (product, index = 0) => {
  const variants = activeVariants(product);
  const options = variants.length ? variants.map((v) => unitPrice(product, v)) : [unitPrice(product)];
  const cheapest = options.reduce((min, o) => (Number(o.price) < Number(min.price) ? o : min), options[0]);
  const inStock = isInStock(product);
  const variesInPrice = new Set(options.map((o) => o.price)).size > 1;
  return {
    id: product.id,
    name: product.name,
    category: product.category?.name,
    price: cheapest.price,
    pricePrefix: variesInPrice ? 'From ' : '',
    oldPrice: cheapest.onSale ? cheapest.listPrice : undefined,
    tone: (index % 4) + 1,
    inStock,
    hasOptions: variants.length > 0,
    badge: !inStock ? 'Sold out' : product.sale_percent ? `-${product.sale_percent}%` : undefined,
    imageUrl: getImageUrl(product.images?.[0]?.key),
    imageUrlHover: getImageUrl(product.images?.[1]?.key),
  };
};
