import jwt from "jsonwebtoken";


export const generateAccessToken=(userId,role)=>{
    return jwt.sign({sub:userId,role:role},process.env.ACCESS_TOKEN,{expiresIn:"15m"})
}
export const generateRefreshToken=(userId,role,jti)=>{
    return jwt.sign({sub:userId,role:role,jti:jti},process.env.REFRESH_TOKEN,{expiresIn:"7d"})
}
export const verifyAccessToken=(Token)=>{
    return jwt.verify(Token,process.env.ACCESS_TOKEN)
}
export const verifyRefreshToken=(Token)=>{
    return jwt.verify(Token,process.env.REFRESH_TOKEN)
}
