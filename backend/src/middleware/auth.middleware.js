import { verifyAccessToken } from "../utils/jwt.helpers.js";
export const authenticate=async(req,res,next)=>{
   const authHeader=req.headers["authorization"];
   console.log("AUTH HEADER:", req.headers["authorization"]);
   
   if(!authHeader || !authHeader.startsWith("Bearer")){
    return res.status(401).json({message:"Not authenticated"})
   }
   const accessToken=authHeader.split(" ")[1] 
   try{
   const decoded=verifyAccessToken(accessToken,process.env.ACCESS_TOKEN)
   req.user=decoded
   next()   
}
   catch(err){
    res.status(401).json("not authenticated")
   }

}
export const authorize=(...allowedRoles)=>{
    return(req,res,next)=>{
        if(!req.user || !req.user.role){
            return res.status(401).json({message:"Not authenticated"});
        }
        if(!allowedRoles.includes(req.user.role)){
            return res.status(403).json({message:"Not authorized"});
        }
        next()
    }
} 