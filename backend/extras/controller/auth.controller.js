import prisma from "../config/db.js"
import bcrypt from "bcrypt"
import {verifyRefreshToken,generateAccessToken,generateRefreshToken } from "../utils/jwt.helpers.js"
import { hashToken,verifyTokenHash } from "../utils/hash.helpers.js"
import { createUserSession } from "../utils/session.helper.js"
export const test = async (req, res) => {
  try {
    const users = await prisma.user.findUnique({where:{id:5}})
    console.log(users)
    res.status(200).json(users)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Database error" })
  }
}

export const register=async(req,res)=>{
  const {name,email,password,confirmPassword} =req.body;
  if(!name||!email||!password||!confirmPassword){
    return res.status(400).json({message:"missing fields"})
  }
  //  if(password.length>=8 && password.length<=15){
  //   return res.status(400).json({message:"Password Must be between 8 and 15 characters"});
  // }
   if(password!==confirmPassword){
    return res.status(400).json({message:"Passwords do not match"})
  }
  const normalizedEmail=email.trim().toLowerCase();
  try{
    // const emailExists=await prisma.user.findUnique({where:{email}})
    // if(emailExists){
    // return res.status(409).json({message:"Email already exists"});
    // }
   const hashedPassword=await bcrypt.hash(password,12);
   const user=await prisma.user.create({data:{name:name,email:normalizedEmail,password:hashedPassword}});
   console.log(user)
   const {refreshToken,accessToken}=await createUserSession(user,req)   
   res.cookie("refreshToken",refreshToken,{
    sameSite:false,
    httpOnly:true,
    secure:false
   })
   res.status(201).json({message:"User registered successfully",data:{accessToken}})
   
  }catch(err){
    if(err.code==="P2002"){
      return res.status(409).json({message:"Email already exists"})
    }
    res.status(500).json({message:"Database Error"})
  }

}

export const login=async(req,res)=>{
  const {email,password}=req.body;
  if(!email||!password){
    return res.status(400).json({message:"Password Must be between 8 and 15 characters"});
  }
 
  const normalizedEmail=email.trim().toLowerCase()
  try{
    const user=await prisma.user.findUnique({where:{email:normalizedEmail}});
    if(!user){
        return res.status(401).json({message:"invalid password or email"})
        }
      const passwordValid=await bcrypt.compare(password,user.password);
      if(!passwordValid){
 return res.status(401).json({message:"invalid password or email"})      }


    const {refreshToken,accessToken}=await createUserSession(user,req) 
    res.cookie("refreshToken",refreshToken,{
      sameSite:"lax",
      secure:false,
      httpOnly:true
    })
    res.status(200).json({message:"logged in sucessfully",data:{accessToken}})
  }catch(err){
    console.log(err)
    res.status(500).json({message:"Database Error"})
  }
}

export const refresh = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  
  try {
    const decoded = verifyRefreshToken(refreshToken);
    const session=await prisma.session.findUnique({where:{jti:decoded.jti}});
    if(!session){
      return res.status(401).json({message:"not authenticated"})
    }
     if(session.revoked_at){
    return res.status(401).json({message:"not authenticated"})
    }
    if(session.expires_at<Date.now()){
    return res.status(401).json({message:"session revoked"})
    }
    const tokenhash=verifyTokenHash(refreshToken,session.refresh_token_hash)
    if(!tokenhash){
      return res.status(401).json({message:"not authenticated"})
    }

    //token revocation
    
    await prisma.session.update({where: { jti: decoded.jti },data: { revoked_at: new Date() }
});
const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await createUserSession(user, req);      res.cookie("refreshToken",newRefreshToken,{
      sameSite:"lax",
      secure:false,
      httpOnly:true
    })

    return res.status(200).json({ data: { accessToken:newAccessToken } });
  } catch (err) {
    console.error(err);
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired, please log in again" });
    }
    return res.status(401).json({ message: "Invalid refresh token" });
  }
};

export const logout = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    res.clearCookie("refreshToken");
    return res.status(200).json({ message: "Logged out" });
  }
  try {
    const decoded = verifyRefreshToken(refreshToken);
    await prisma.session.update({
      where: { jti: decoded.jti },
      data: { revoked_at: new Date() },
    });
  } catch (err) {
    console.error(err);
    // token invalid/expired/session missing — nothing meaningful to revoke, treat as already logged out
  }

  res.clearCookie("refreshToken");
  return res.status(200).json({ message: "Logged out" });
};
export const logoutAll = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    res.clearCookie("refreshToken");
    return res.status(200).json({ message: "Logged out" });
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);
    await prisma.session.updateMany({
      where: { user_id: decoded.sub, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  } catch (err) {
    console.error(err);
  }

  res.clearCookie("refreshToken");
  return res.status(200).json({ message: "Logged out of all devices" });
};


