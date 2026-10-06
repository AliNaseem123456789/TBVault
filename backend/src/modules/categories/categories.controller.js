import prisma from "../../config/db.js"
export const createCategories=async(req,res)=>{
    const {name}=req.body;
    try{
        const category=await prisma.category.create({data:{name:name}})
        res.status(201).json({message:"Category created",data:category})
    }
    catch(err){
        if(err.code=="P2002"){
            return res.status(409).json({message:"Category already exisits"})
        }
    }
}
export const getCategoriesById=async(req,res)=>{
    const id=Number(req.params.id);
    if(!Number.isInteger(id)){
        return res.status(400).json({message:"id must be number"})
    }
    try{
        const category=await prisma.category.findUnique({where:{id:id}})
        if(!category){
            return res.status(404).json({message:"catgory not found"})
        }
        res.status(200).json({message:"Category fetched",data:category})
    }
    catch(err){
        return res.status(500).json({message:"Database Error"})
    }
}

export const getCategories=async(req,res)=>{
    try{
        const categories=await prisma.category.findMany({})
        res.status(200).json({message:"Category fetched",data:categories})
    }
    catch(err){
        return res.status(500).json({message:"Database Error"})

    }
}

export const updateCategoryName=async(req,res)=>{
    const id=Number(req.params.id);
    const {name}=req.body
    if(!Number.isNaN(id)){
        return res.status(400).json({message:"id must be number"})
    }
    try{
        const category=await prisma.category.update({where:{id:id},data:{name:name}})
        if(!category){
            return res.status(404).json({message:"catgory not found"})
        }
        res.status(200).json({message:"Category updated",data:category})
    }
    catch(err){
        if(err.code="P2025"){
            return res.status(404).json({message:"category not found"})
        }
        return res.status(500).json({message:"Database Error"})
    }
}

export const deleteCategory=async(req,res)=>{
    const id=Number(req.params.id);
    if(Number.isNaN(id)||!Number.isInteger(id)){
        return res.status(400).json({message:"id must be number"})
    }
    try{
        const category=await prisma.category.delete({where:{id:id}})
      
        res.status(204).send();
    }
    catch(err){
        if(err.code="P2025"){
            return res.status(404).json({message:"category not found"})
        }
        return res.status(500).json({message:"Database Error"})
    }
}

export const getProductsByCategory=async(req,res)=>{
    const id=Number(req.params.id);
    if(!Number.isInteger(id)){
        return res.status(400).json({message:"id must be number"})
    }
    try{
        const categories=await prisma.category.findMany({where:{id:id},include:{products:true}})      
        res.status(200).json({message:"Category fetched",data:categories})
    }
    catch(err){
        if(err.code="P2025"){
            return res.status(404).json({message:"category not found"})
        }
        return res.status(500).json({message:"Database Error"})
    }
}

// model Category {
//   id         Int       @id @default(autoincrement())
//   name       String    @unique @db.VarChar(100)
//   created_at DateTime  @default(now())
//   products   Product[]
//   @@map("categories")
// }
