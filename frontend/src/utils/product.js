// Base URL the storage `key` returned by the API is resolved against
// to build a fetchable image URL, e.g. `${base}/products/12/abc.jpg`.
// Override by setting VITE_MEDIA_BASE_URL in a .env file at the
// frontend root (then restart `npm run dev`) once you confirm the
// real MinIO endpoint/bucket — this default assumes local MinIO on
// its default port with the "tbvault" bucket public-read.
const MEDIA_BASE_URL = import.meta.env.VITE_MEDIA_BASE_URL || 'http://localhost:9000/tbvault';

export const getImageUrl = (key) => (key ? `${MEDIA_BASE_URL}/${key}` : undefined);

/**
 * Maps a raw row from GET /products (see products.controller.js) to
 * the shape <ProductCard> expects. Shared by the landing page's
 * TrendingProducts section and the Shop page so both stay in sync
 * with the API's actual fields (category name, images, stock, etc.)
 * in one place instead of two.
 *
 * Both GET /products and GET /products/:id return `images` ordered
 * primary-first, so images[0] (if present) is always the one to show.
 * ProductCard falls back to the placeholder art if there's no image,
 * or if the resolved URL 404s (see its onError handler) — so a wrong
 * MEDIA_BASE_URL degrades gracefully instead of showing a broken image.
 *
 * imageUrlHover is images[1] (if a product has a second photo) —
 * ProductCard crossfades to it on hover, and falls back to the
 * single-image hover-zoom when it's undefined.
 */
export const mapProductForCard = (product, index = 0) => ({
  id: product.id,
  name: product.name,
  category: product.category?.name,
  price: Number(product.price).toFixed(2),
  tone: (index % 4) + 1,
  inStock: product.stock > 0,
  badge: product.stock <= 0 ? 'Sold out' : undefined,
  imageUrl: getImageUrl(product.images?.[0]?.key),
  imageUrlHover: getImageUrl(product.images?.[1]?.key),
});
