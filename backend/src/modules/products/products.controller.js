import prisma from "../../config/db.js"
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import storage, { BUCKET } from "../../config/storage.js";
import path from "path"
import crypto from "crypto";

// Validates and normalises a product body. `partial` is for updates, where every field is optional.
const parseProductInput = (body, { partial = false } = {}) => {
    const data = {}
    const has = (k) => body[k] !== undefined

    if (has("name") || !partial) {
        const name = typeof body.name === "string" ? body.name.trim() : ""
        if (!name || name.length > 100) return { error: "name must be 1-100 characters" }
        data.name = name
    }
    if (has("description")) {
        if (body.description !== null && typeof body.description !== "string") return { error: "description must be text" }
        data.description = body.description
    }
    if (has("price") || !partial) {
        const price = Number(body.price)
        if (!Number.isFinite(price) || price < 0) return { error: "price must be a number of 0 or more" }
        data.price = price
    }
    if (has("stock")) {
        const stock = Number(body.stock)
        if (!Number.isInteger(stock) || stock < 0) return { error: "stock must be a whole number of 0 or more" }
        data.stock = stock
    }
    if (has("is_hidden")) {
        if (typeof body.is_hidden !== "boolean") return { error: "is_hidden must be true or false" }
        data.is_hidden = body.is_hidden
    }
    if (has("category_id") || !partial) {
        const category_id = Number(body.category_id)
        if (!Number.isInteger(category_id) || category_id < 1) return { error: "category_id must be a positive integer" }
        data.category_id = category_id
    }
    return { data }
}

export const createProducts=async(req,res)=>{
    const { data, error } = parseProductInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try{
        const product=await prisma.product.create({ data })
        return res.status(201).json({message:"product Created",data:{product}})
    }catch(err){
        if(err.code==="P2003"){
            return res.status(400).json({message:"Category doesn't exist"})
        }
        console.error("createProducts error:",err);
        return res.status(500).json({ message: "Database Error" });
    }
}

// Admin listing: same filters as the public one, but hidden products are included.
export const getProductsAdmin = (req, res) => getProductsByCategory(req, res, { includeHidden: true })

// GET /products?
// search=phone&categoryId=2&minPrice=100&maxPrice=1000&inStock=true&sortBy=price
// &order=asc&page=2&limit=10
export const getProductsByCategory = async (req, res, { includeHidden = false } = {}) => {
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
  let stockFilter;
  if (inStock !== undefined) {
    if (inStock === "true") {
      stockFilter = {
        gt: 0
      };
    } else if (inStock === "false") {
      stockFilter = {
        equals: 0
      };
    } else {
      return res.status(400).json({message: "inStock must be true or false"});
    }
  }
  // Sorting validation
  const allowedFields = ["name","price","stock","created_at"];
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
  // Hidden products are only visible to admins.
  const where = includeHidden ? {} : { is_hidden: false };
 
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
    where.stock = stockFilter;
  }
  // Sorting
  const finalSortBy = sortBy || "created_at";
  const finalOrder = order || "desc";
  // Database query
  try {
    const [products, totalItems] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: {
            select: {
              id: true,
              name: true
            }
          },
        images: {
            orderBy: [
            { is_primary: "desc" },     
            { created_at: "asc" },       
                 ],
                take: 2,}
        },
        orderBy: {
          [finalSortBy]: finalOrder
        },

        skip: offset,
        take: limit
      }),

      prisma.product.count({
        where
      })
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return res.status(200).json({
      message: "Products Found",

      data: {
        products
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
                    category:{select:{id:true,name:true}}
                }
            }
        )
        if (!product || (product.is_hidden && !includeHidden)) {
         return res.status(404).json({ message: "Product not found" });
            }
        return res.status(200).json({message:"product found",data:{product}})
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
        const product=await prisma.product.update({where:{id:id},data})
        return res.status(200).json({message:"product found",data:{product}})
    }catch(err){
        if(err.code==="P2025"){
            return res.status(404).json({message:"Product doesnt Exist"})
        }
        if(err.code==="P2003"){
            return res.status(400).json({message:"Category doesn't exist"})
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

    // Upload images to MinIO
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
    return res.status(200).json({ message: "Primary image updated" });
  } catch (err) {
    console.error("setPrimaryImage error:", err);
    return res.status(500).json({ message: "Database Error" });
  }
};
