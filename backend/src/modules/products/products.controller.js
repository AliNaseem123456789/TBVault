import prisma from "../../config/db.js"
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import storage, { BUCKET } from "../../config/storage.js";
import path from "path"
import crypto from "crypto";
import { withSalePricing } from "../../services/pricing/pricing.service.js";
import { notifyBackInStock } from "../../services/inventory/inventory.service.js";
import { parseProductInput } from "./product.validation.js";
import { PUBLIC_PRODUCT_WHERE, PUBLIC_SELLER_SELECT, isPublicProduct } from "../../utils/visibility.js";

import { ensurePlatformSeller } from "../../services/marketplace/platform-seller.service.js";
import { notifyCatalogChanged } from "../../events/publishers/catalog.publisher.js"

// Products added by an admin belong to the store's own (platform) seller unless seller_id is given.
const platformSellerId = async () => (await ensurePlatformSeller()).id;


// POST /products (admin, body.seller_id optional) and POST /seller/products (the seller's own store)
export const createProducts=async(req,res)=>{
    const { data, error } = parseProductInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try{
        if (req.seller) {
            data.seller_id = req.seller.id
        } else if (req.body.seller_id !== undefined && req.body.seller_id !== null) {
            const sellerId = Number(req.body.seller_id)
            const seller = Number.isInteger(sellerId) ? await prisma.seller.findUnique({ where: { id: sellerId }, select: { id: true } }) : null
            if (!seller) return res.status(400).json({ message: "Seller doesn't exist" })
            data.seller_id = seller.id
        } else {
            data.seller_id = await platformSellerId()
        }
        const product=await prisma.product.create({ data })
        notifyCatalogChanged({ product_ids: [product.id] })
        return res.status(201).json({message:"product Created",data:{product}})
    }catch(err){
        if(err.code==="P2003"){
            return res.status(400).json({message:"Category or brand doesn't exist"})
        }
        console.error("createProducts error:",err);
        return res.status(500).json({ message: "Database Error" });
    }
}

// Admin listing: same filters as the public one, but hidden products are included.
export const getProductsAdmin = (req, res) => getProductsByCategory(req, res, { includeHidden: true })
// GET /seller/products — a seller's own products, hidden ones included.
export const getProductsSeller = (req, res) => getProductsByCategory(req, res, { includeHidden: true, sellerId: req.seller.id })

// Units sold per product, counting every order that wasn't cancelled.
const unitsSoldByProduct = async () => {
  const rows = await prisma.orderItem.groupBy({
    by: ["product_id"],
    where: { order: { status: { not: "cancelled" } } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.product_id, r._sum.quantity ?? 0]));
};

/**
 * One page of products ranked by units sold (best sellers first; products nobody
 * has bought yet follow, newest first). The ranking needs every matching id, so
 * this suits a store-sized catalog; a big one would keep a sales counter instead.
 */
const bestSellingPage = async ({ where, include, offset, limit }) => {
  const [sold, matching] = await Promise.all([
    unitsSoldByProduct(),
    prisma.product.findMany({ where, select: { id: true, created_at: true } }),
  ]);
  const ranked = matching.sort(
    (a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || b.created_at - a.created_at
  );
  const pageIds = ranked.slice(offset, offset + limit).map((p) => p.id);
  const rows = await prisma.product.findMany({ where: { id: { in: pageIds } }, include });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const products = pageIds.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id), units_sold: sold.get(id) ?? 0 }));
  return { products, totalItems: matching.length };
};

// GET /products?
// search=phone&categoryId=2&minPrice=100&maxPrice=1000&inStock=true&sortBy=price
// &order=asc&page=2&limit=10&brandId=4&sellerId=7
// sortBy=best_selling ranks by units sold (order is ignored: always most sold first).
export const getProductsByCategory = async (req, res, { includeHidden = false, sellerId = null } = {}) => {
  const { search, sortBy, order, inStock } = req.query;

  let categoryId;
  let minPrice;
  let maxPrice;
  
  const page = req.query.page !== undefined? Number(req.query.page): 1;
  const limit = req.query.limit !== undefined? Number(req.query.limit): 10;
  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({message: "invalid page"});
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({message: "invalid limit"});
  }
  const offset = (page - 1) * limit;
  // Category validation
  if (req.query.categoryId !== undefined) {
    categoryId = Number(req.query.categoryId);

    if (!Number.isInteger(categoryId) || categoryId < 1) {
      return res.status(400).json({message: "invalid Category Id"});
    }
  }
  // Brand and seller (store page) filters
  let brandId;
  let sellerFilter;
  for (const [key, label] of [["brandId", "brand"], ["sellerId", "seller"]]) {
    if (req.query[key] === undefined) continue;
    const n = Number(req.query[key]);
    if (!Number.isInteger(n) || n < 1) return res.status(400).json({message: `invalid ${label} id`});
    if (key === "brandId") brandId = n; else sellerFilter = n;
  }
  // Price validation
  if (req.query.minPrice !== undefined) {
    minPrice = Number(req.query.minPrice);

    if (!Number.isFinite(minPrice) || minPrice < 0) {
      return res.status(400).json({message: "invalid minPrice"});
    }
  }

  if (req.query.maxPrice !== undefined) {
    maxPrice = Number(req.query.maxPrice);

    if (!Number.isFinite(maxPrice) || maxPrice < 0) {
      return res.status(400).json({message: "invalid maxPrice"});
    }
  }

  if (
    minPrice !== undefined &&
    maxPrice !== undefined &&
    minPrice > maxPrice
  ) {
    return res.status(400).json({message: "minPrice cannot be greater than maxPrice"});
  }
  // Stock validation
  // A product with options is in stock when any active option is.
  let stockFilter;
  if (inStock !== undefined) {
    const variantInStock = { variants: { some: { is_active: true, stock: { gt: 0 } } } };
    if (inStock === "true") {
      stockFilter = { OR: [{ stock: { gt: 0 } }, variantInStock] };
    } else if (inStock === "false") {
      stockFilter = { stock: { lte: 0 }, NOT: variantInStock };
    } else {
      return res.status(400).json({message: "inStock must be true or false"});
    }
  }
  // ids=3,8,12 — e.g. the "recently viewed" strip. At most 50.
  let ids;
  if (req.query.ids !== undefined) {
    ids = String(req.query.ids).split(",").filter(Boolean).map(Number);
    if (ids.length === 0 || ids.length > 50 || ids.some((n) => !Number.isInteger(n) || n < 1)) {
      return res.status(400).json({message: "ids must be a comma-separated list of up to 50 product ids"});
    }
  }
  // Sorting validation
  const allowedFields = ["name","price","stock","created_at","best_selling"];
  const allowedOrders = ["asc","desc"];

  if (sortBy !== undefined) {
    if (!allowedFields.includes(sortBy)) {
      return res.status(400).json({message: "Invalid sort fields"});
    }
  }

  if (order !== undefined) {
    if (!allowedOrders.includes(order)) {
      return res.status(400).json({message: "Invalid sort order"});
    }
  }
  // Search validation
  if (search !== undefined) {
    if (search.trim().length === 0) {
      return res.status(400).json({message: "search cannot be empty"});
    }
  }
  // Build WHERE dynamically
  // Hidden products (and suspended sellers' products) are only visible to admins and their seller.
  const where = includeHidden ? {} : { ...PUBLIC_PRODUCT_WHERE };
  if (sellerId) where.seller_id = sellerId;
  else if (sellerFilter !== undefined) where.seller_id = sellerFilter;
  if (brandId !== undefined) where.brand_id = brandId;
 
  if (search) {
    where.OR = [
      {
        name: {
          contains: search,
          mode: "insensitive"
        }
      },
      {
        description: {
          contains: search,
          mode: "insensitive"
        }
      }
    ];
  }

  if (categoryId !== undefined) {
    where.category_id = categoryId;
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    where.price = {};

    if (minPrice !== undefined) {
      where.price.gte = minPrice;
    }

    if (maxPrice !== undefined) {
      where.price.lte = maxPrice;
    }
  }

  if (stockFilter !== undefined) {
    where.AND = [...(where.AND ?? []), stockFilter];
  }
  if (ids !== undefined) {
    where.id = { in: ids };
  }
  // onSale=true — products with a live sale of their own or on their category (the Deals page).
  if (req.query.onSale === "true") {
    const now = new Date();
    const live = { is_active: true, starts_at: { lte: now }, ends_at: { gt: now } };
    where.AND = [...(where.AND ?? []), { OR: [{ sales: { some: live } }, { category: { sales: { some: live } } }] }];
  }
  // Sorting
  const finalSortBy = sortBy || "created_at";
  const finalOrder = order || "desc";
  // What every product row carries for the storefront cards.
  const include = {
    category: { select: { id: true, name: true } },
    brand: { select: { id: true, name: true } },
    seller: { select: PUBLIC_SELLER_SELECT },
    images: { orderBy: [{ is_primary: "desc" }, { created_at: "asc" }], take: 2 },
    // Enough to show "from $x" and whether any option is in stock.
    variants: {
      where: includeHidden ? {} : { is_active: true },
      select: { id: true, name: true, price: true, stock: true, is_active: true },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    },
  };
  // Database query
  try {
    const { products, totalItems } = finalSortBy === "best_selling"
      ? await bestSellingPage({ where, include, offset, limit })
      : await Promise.all([
          prisma.product.findMany({ where, include, orderBy: { [finalSortBy]: finalOrder }, skip: offset, take: limit }),
          prisma.product.count({ where }),
        ]).then(([products, totalItems]) => ({ products, totalItems }));

    const totalPages = Math.ceil(totalItems / limit);

    return res.status(200).json({
      message: "Products Found",

      data: {
        products: await withSalePricing(products)
      },

      metaData: {
        totalPages: totalPages,
        currentPage: page,
        hasNext: totalPages > page,
        hasPrev: page > 1,
        itemsPerPage: limit,
        totalItems: totalItems
      }
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Database Error"
    });
  }
};

export const getProductsById=async(req,res,{ includeHidden = false } = {})=>{
    const id=Number(req.params.id)
    if(!Number.isInteger(id) || id < 1){
        return res.status(400).json({message:"invalid product id"})
    }
    try{
        const product=await prisma.product.findUnique(
            {
                where:{id:id},
                include:{
                    images:{orderBy:[{is_primary:"desc"},{created_at:"asc"}]},
                    category:{select:{id:true,name:true}},
                    brand:{select:{id:true,name:true}},
                    seller:{select:{...PUBLIC_SELLER_SELECT,status:true}},
                    variants:{
                        where: includeHidden ? {} : { is_active: true },
                        orderBy:[{sort_order:"asc"},{id:"asc"}],
                    },
                }
            }
        )
        if (!product || (!includeHidden && !isPublicProduct(product))) {
         return res.status(404).json({ message: "Product not found" });
            }
        return res.status(200).json({message:"product found",data:{product: await withSalePricing(product)}})
    }catch(err){
    console.error("getProductsById error:",err)
    return res.status(500).json({message:"Database Error"})
    }
}
export const updateProductsById=async(req,res)=>{
    const id=Number(req.params.id)
    if(!Number.isInteger(id) || id < 1){
        return res.status(400).json({message:"invalid product id"})
    }
    const { data, error } = parseProductInput(req.body, { partial: true })
    if (error) return res.status(400).json({ message: error })
     try{
        const before=await prisma.product.findUnique({where:{id:id},select:{stock:true}})
        const product=await prisma.product.update({where:{id:id},data})
        // Restocked from zero: tell everyone who asked to be notified.
        if(before && before.stock<=0 && product.stock>0) notifyBackInStock({productId:id,variantId:null})
        notifyCatalogChanged({ product_ids: [id] })
        return res.status(200).json({message:"product found",data:{product}})
    }catch(err){
        if(err.code==="P2025"){
            return res.status(404).json({message:"Product doesnt Exist"})
        }
        if(err.code==="P2003"){
            return res.status(400).json({message:"Category or brand doesn't exist"})
        }
    console.error("updateProductsById error:",err)
    return res.status(500).json({message:"Database Error"})
    }
}

export const deleteProducts=async(req,res)=>{
    const id=Number(req.params.id)
    if(!Number.isInteger(id) || id < 1){
        return res.status(400).json({message:"invalid product id"})
    }
     try{
        // OrderItem cascades on product delete, which would erase order history.
        const ordered=await prisma.orderItem.count({where:{product_id:id}})
        if(ordered>0){
            return res.status(409).json({message:"This product is in past orders. Hide it instead of deleting it."})
        }
        const images=await prisma.productImage.findMany({where:{product_id:id},select:{key:true}})
        await prisma.product.delete({where:{id:id}})
        notifyCatalogChanged({ product_ids: [id] })
        await Promise.all(images.map(({key})=>storage.send(new DeleteObjectCommand({Bucket:BUCKET,Key:key})).catch(()=>{})))
        return res.status(204).send()
    }catch(err){
        if(err.code==="P2025"){
            return res.status(404).json({message:"Product doesnt Exist"})
        }
    return res.status(500).json({message:"Database Error"})
    }
}
export const productUpload = async (req, res) => {
  const productId = Number(req.params.productId);

  try {
    // Validate product ID
    if (!Number.isInteger(productId) || productId < 1) {
      return res.status(400).json({message: "Invalid product id"});
    }
    // Check product exists
    const exists = await prisma.product.findUnique({
      where: {
        id: productId
      }
    });
    if (!exists) {
      return res.status(404).json({message: "Product doesn't exist"});
    }
    // Check files
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({message: "At least one image is required"});
    }

    // Convert primaryIndex from string to number
    const primaryIndex = req.body.primaryIndex !== undefined
      ? Number(req.body.primaryIndex)
      : undefined;

    // Validate primaryIndex
if (primaryIndex !== undefined &&(!Number.isInteger(primaryIndex) ||primaryIndex < 0 ||primaryIndex >= req.files.length)) 
    {
      return res.status(400).json({message: "Invalid primaryIndex"});
    }

    // Check existing primary image
    const existingPrimary = await prisma.productImage.findFirst({
      where: {
        product_id: productId,
        is_primary: true
      }
    });

    // Decide which uploaded image becomes primary
    let selectedIndex;

    if (primaryIndex !== undefined) {
      selectedIndex = primaryIndex;
    } else if (!existingPrimary) {
      selectedIndex = 0;
    } else {
      selectedIndex = undefined;
    }

    // Remove old primary if a new one is selected
    if (selectedIndex !== undefined) {
      await prisma.productImage.updateMany({
        where: {
          product_id: productId,
          is_primary: true
        },
        data: {
          is_primary: false
        }
      });
    }

    // Upload images to the S3 bucket
    const uploaded = await Promise.all(
      req.files.map(async (file, index) => {
        const extension = path.extname(file.originalname);

        const filename = `${crypto.randomUUID()}${extension}`;

        const key = `products/${productId}/${filename}`;

        await storage.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype
          })
        );

        return {
          product_id: productId,
          key: key,
          original_name: file.originalname,
          mime_type: file.mimetype,
          size: file.size,

          // Selected image becomes primary
          is_primary: selectedIndex === index
        };
      })
    );

    // Save image metadata in database
    await prisma.productImage.createMany({
      data: uploaded
    });
    notifyCatalogChanged({ product_ids: [productId] });

    return res.status(201).json({
      message: "Images uploaded",
      count: uploaded.length,

      data: uploaded.map(image => ({
        key: image.key,
        original_name: image.original_name,
        size: image.size,
        is_primary: image.is_primary
      }))
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Upload failed"
    });
  }
};
export const getProductByIdAdmin = (req, res) => getProductsById(req, res, { includeHidden: true })

// DELETE /products/:productId/images/:imageId
export const deleteProductImage = async (req, res) => {
  const productId = Number(req.params.productId);
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(productId) || !Number.isInteger(imageId)) {
    return res.status(400).json({ message: "invalid id" });
  }
  try {
    const image = await prisma.productImage.findFirst({ where: { id: imageId, product_id: productId } });
    if (!image) return res.status(404).json({ message: "Image not found" });

    await prisma.productImage.delete({ where: { id: image.id } });
    // If we removed the primary image, promote the oldest remaining one.
    if (image.is_primary) {
      const next = await prisma.productImage.findFirst({ where: { product_id: productId }, orderBy: { created_at: "asc" } });
      if (next) await prisma.productImage.update({ where: { id: next.id }, data: { is_primary: true } });
    }
    notifyCatalogChanged({ product_ids: [productId] });
    await storage.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: image.key })).catch((err) =>
      console.error("[storage] failed to delete object", image.key, err.message)
    );
    return res.status(204).send();
  } catch (err) {
    console.error("deleteProductImage error:", err);
    return res.status(500).json({ message: "Database Error" });
  }
};

// PATCH /products/:productId/images/:imageId/primary
export const setPrimaryImage = async (req, res) => {
  const productId = Number(req.params.productId);
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(productId) || !Number.isInteger(imageId)) {
    return res.status(400).json({ message: "invalid id" });
  }
  try {
    const image = await prisma.productImage.findFirst({ where: { id: imageId, product_id: productId } });
    if (!image) return res.status(404).json({ message: "Image not found" });
    await prisma.$transaction([
      prisma.productImage.updateMany({ where: { product_id: productId }, data: { is_primary: false } }),
      prisma.productImage.update({ where: { id: image.id }, data: { is_primary: true } }),
    ]);
    notifyCatalogChanged({ product_ids: [productId] });
    return res.status(200).json({ message: "Primary image updated" });
  } catch (err) {
    console.error("setPrimaryImage error:", err);
    return res.status(500).json({ message: "Database Error" });
  }
};

// GET /products/:id/related?limit=4
// Same category first, then the newest other products to fill the row.
export const getRelatedProducts = async (req, res) => {
  const id = Number(req.params.id);
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : 4;
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "invalid product id" });
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) return res.status(400).json({ message: "invalid limit" });
  const include = {
    category: { select: { id: true, name: true } },
    brand: { select: { id: true, name: true } },
    seller: { select: PUBLIC_SELLER_SELECT },
    images: { orderBy: [{ is_primary: "desc" }, { created_at: "asc" }], take: 2 },
    variants: { where: { is_active: true }, select: { id: true, name: true, price: true, stock: true, is_active: true } },
  };
  try {
    const product = await prisma.product.findUnique({ where: { id }, select: { category_id: true, is_hidden: true, seller: { select: { status: true } } } });
    if (!isPublicProduct(product)) return res.status(404).json({ message: "Product not found" });
    const sameCategory = await prisma.product.findMany({
      where: { ...PUBLIC_PRODUCT_WHERE, category_id: product.category_id, id: { not: id } },
      orderBy: { created_at: "desc" },
      take: limit,
      include,
    });
    let related = sameCategory;
    if (related.length < limit) {
      const others = await prisma.product.findMany({
        where: { ...PUBLIC_PRODUCT_WHERE, id: { notIn: [id, ...related.map((p) => p.id)] } },
        orderBy: { created_at: "desc" },
        take: limit - related.length,
        include,
      });
      related = [...related, ...others];
    }
    return res.status(200).json({ message: "Related products", data: { products: await withSalePricing(related) } });
  } catch (err) {
    console.error("getRelatedProducts error:", err);
    return res.status(500).json({ message: "Database Error" });
  }
};
