import api from "./apiClient";

/**
 * Product management, for two audiences with the same screens:
 *   adminCatalog  — every product (/admin/products, /products, /variants)
 *   sellerCatalog — only the signed-in seller's products (/seller/...)
 * ProductEditor / VariantsEditor / AdminProducts take one of these through CatalogApiContext.
 */
const makeCatalog = ({ list, item, write, variantsOf, variant }) => ({
  listProducts: async (params = {}) => (await api.get(list, { params })).data,
  getProduct: async (id) => (await api.get(item(id))).data,
  createProduct: async (data) => (await api.post(write(), data)).data,
  updateProduct: async (id, data) => (await api.put(write(id), data)).data,
  deleteProduct: async (id) => {
    await api.delete(write(id));
  },
  uploadProductImages: async (id, files, primaryIndex) => {
    const form = new FormData();
    files.forEach((file) => form.append("image", file));
    if (primaryIndex !== undefined) form.append("primaryIndex", String(primaryIndex));
    return (await api.post(`${write(id)}/image`, form)).data;
  },
  deleteProductImage: async (productId, imageId) => {
    await api.delete(`${write(productId)}/images/${imageId}`);
  },
  setPrimaryImage: async (productId, imageId) => (await api.patch(`${write(productId)}/images/${imageId}/primary`)).data,
  listVariants: async (productId) => (await api.get(variantsOf(productId, "list"))).data,
  createVariant: async (productId, data) => (await api.post(variantsOf(productId, "create"), data)).data,
  updateVariant: async (variantId, data) => (await api.put(variant(variantId), data)).data,
  deleteVariant: async (variantId) => {
    await api.delete(variant(variantId));
  },
});

export const adminCatalog = makeCatalog({
  list: "/admin/products",
  item: (id) => `/admin/products/${id}`,
  write: (id) => (id === undefined ? "/products" : `/products/${id}`),
  variantsOf: (productId, kind) => (kind === "list" ? `/admin/products/${productId}/variants` : `/products/${productId}/variants`),
  variant: (id) => `/variants/${id}`,
});

export const sellerCatalog = makeCatalog({
  list: "/seller/products",
  item: (id) => `/seller/products/${id}`,
  write: (id) => (id === undefined ? "/seller/products" : `/seller/products/${id}`),
  variantsOf: (productId) => `/seller/products/${productId}/variants`,
  variant: (id) => `/seller/variants/${id}`,
});
