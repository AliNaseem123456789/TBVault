// What shoppers may see: products that aren't hidden, from sellers that are approved.
// (A suspended seller's products disappear from the store without being edited.)
export const PUBLIC_PRODUCT_WHERE = { is_hidden: false, seller: { status: "APPROVED" } }

// For rows loaded with `seller: { select: { status: true } }`.
export const isPublicProduct = (product) => Boolean(product) && !product.is_hidden && product.seller?.status === "APPROVED"

// What the storefront shows about a seller.
export const PUBLIC_SELLER_SELECT = { id: true, store_name: true, slug: true, is_platform: true }
