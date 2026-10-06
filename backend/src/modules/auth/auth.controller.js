import prisma from "../../config/db.js"
import bcrypt from "bcrypt"
import crypto from "crypto"
import { verifyRefreshToken } from "../../utils/jwt.helpers.js"
import { hashToken,verifyTokenHash } from "../../utils/hash.helpers.js"
import { createUserSession } from "../../utils/session.helper.js"
import { OAuth2Client } from "google-auth-library"
import redis from "../../config/redis.client.js"

import { publishAuthEvents } from "../../events/publishers/auth.publisher.js"
import { AUTH_EVENTS } from "../../events/eventNames.js"

// One place for refresh-cookie settings so every route sets it the same way.
const REFRESH_COOKIE = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
}

// bcrypt only reads the first 72 bytes, so cap there.
const validatePassword = (password) => {
  if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters"
  if (password.length > 72) return "Password must be at most 72 characters"
  return null
}

export const register=async(req,res)=>{
  const {name,email,password,confirmPassword} =req.body;
  if(!name||!email||!password||!confirmPassword){
    return res.status(400).json({message:"missing fields"})
  }
  const passwordError=validatePassword(password)
  if(passwordError){
    return res.status(400).json({message:passwordError})
  }
   if(password!==confirmPassword){
    return res.status(400).json({message:"Passwords do not match"})
  }
  const normalizedEmail=email.trim().toLowerCase();
  try{
   const hashedPassword=await bcrypt.hash(password,12);
   const user=await prisma.user.create({data:{name:name,email:normalizedEmail,password:hashedPassword}});
   const {refreshToken,accessToken}=await createUserSession(user,req)   
   res.cookie("refreshToken",refreshToken,REFRESH_COOKIE)
   res.status(201).json({message:"User registered successfully",data:{accessToken}})  
  }catch(err){
    if(err.code==="P2002"){
      return res.status(409).json({message:"Email already exists"})
    }
    console.error("register error:",err)
    res.status(500).json({message:"Database Error"})
  }

}

export const login=async(req,res)=>{
  const {email,password}=req.body;
  if(!email||!password){
    return res.status(400).json({message:"email and password needed"});
  }
  const normalizedEmail=email.trim().toLowerCase()
  try{
    const user=await prisma.user.findUnique({where:{email:normalizedEmail}});
    const key=`login:failed:${normalizedEmail}`
    const failures=await redis.get(key)
   if (failures && Number(failures) >= 3) {
      return res.status(429).json({ message: "too many failed attempts, try again later" });
    }
    if(!user){
        return res.status(401).json({message:"invalid password or email"})
        }
      // Google-only accounts have no password; treat them like a wrong password.
      const passwordValid=user.password ? await bcrypt.compare(password,user.password) : false;
      if(!passwordValid){
        const attempts=await redis.incr(key)
         if (attempts === 1) {
        await redis.expire(key, 15 * 60); // 15 min lockout window
      }
      return res.status(401).json({message:"invalid password or email"})  
    }
    await redis.del(key)
    const {refreshToken,accessToken}=await createUserSession(user,req) 
    res.cookie("refreshToken",refreshToken,REFRESH_COOKIE)
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
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await createUserSession(user, req);      res.cookie("refreshToken",newRefreshToken,REFRESH_COOKIE)
    return res.status(200).json({ data: { accessToken:newAccessToken } });
  } catch (err) {
    console.error(err);
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired, please log in again" });
    }
    return res.status(401).json({ message: "Invalid refresh token" });
  }
};
const PROFILE_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  is_verified: true,
  password: true,          // only used to compute has_password, never sent
  created_at: true,
}

// Google-only accounts have no password, so the frontend hides "change password" for them.
const toProfile = ({ password, ...user }) => ({ ...user, has_password: Boolean(password) })

export const me=async(req,res)=>{
  const userId=Number(req.user?.sub)
  if(!userId){
    return res.status(401).json({message:"not authenticated"})
  }
  try{
    const user=await prisma.user.findUnique({where:{id:userId},select:PROFILE_FIELDS})
    if(!user){
      return res.status(404).json({message:"User not found"})
    }
    return res.status(200).json({data:toProfile(user)})
  }catch(err){
    console.error("me error:",err)
    return res.status(500).json({message:"Database Error"})
  }
}

// PATCH /auth/me   body: { name }
export const updateMe=async(req,res)=>{
  const userId=Number(req.user?.sub)
  const name=typeof req.body.name==="string" ? req.body.name.trim() : ""
  if(!name || name.length>50){
    return res.status(400).json({message:"name must be 1-50 characters"})
  }
  try{
    const user=await prisma.user.update({where:{id:userId},data:{name},select:PROFILE_FIELDS})
    return res.status(200).json({message:"Profile updated",data:toProfile(user)})
  }catch(err){
    if(err.code==="P2025") return res.status(404).json({message:"User not found"})
    console.error("updateMe error:",err)
    return res.status(500).json({message:"Database Error"})
  }
}

// POST /auth/change-password   body: { currentPassword, newPassword, confirmPassword }
// Signs out every other device; the current one gets a fresh session.
export const changePassword=async(req,res)=>{
  const userId=Number(req.user?.sub)
  const {currentPassword,newPassword,confirmPassword}=req.body
  if(!currentPassword||!newPassword||!confirmPassword){
    return res.status(400).json({message:"missing fields"})
  }
  if(newPassword!==confirmPassword){
    return res.status(400).json({message:"Passwords do not match"})
  }
  const passwordError=validatePassword(newPassword)
  if(passwordError){
    return res.status(400).json({message:passwordError})
  }
  try{
    const user=await prisma.user.findUnique({where:{id:userId}})
    if(!user) return res.status(404).json({message:"User not found"})
    if(!user.password){
      return res.status(400).json({message:"This account signs in with Google. Use \"Forgot password\" to set a password."})
    }
    const valid=await bcrypt.compare(currentPassword,user.password)
    if(!valid){
      return res.status(401).json({message:"Current password is incorrect"})
    }
    const hashedPassword=await bcrypt.hash(newPassword,12)
    await prisma.$transaction([
      prisma.user.update({where:{id:userId},data:{password:hashedPassword}}),
      prisma.session.updateMany({where:{user_id:userId,revoked_at:null},data:{revoked_at:new Date()}}),
    ])
    const {refreshToken,accessToken}=await createUserSession(user,req)
    res.cookie("refreshToken",refreshToken,REFRESH_COOKIE)
    return res.status(200).json({message:"Password changed",data:{accessToken}})
  }catch(err){
    console.error("changePassword error:",err)
    return res.status(500).json({message:"Database Error"})
  }
}


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

// Always answers the same way, so the response can't be used to find out which emails have accounts.
const FORGOT_PASSWORD_RESPONSE = { message: "If an account exists for that email, a reset link has been sent." }

export const forgotPassword=async(req,res)=>{
  const {email}=req.body;
  if(!email){
    return res.status(400).json({message:"email missing"})
  }
  const emailNormalized=email.trim().toLowerCase();

  try{
    const exists=await prisma.user.findUnique({where:{email:emailNormalized}})
    if(!exists){
      return res.status(200).json(FORGOT_PASSWORD_RESPONSE)
    }
    const forgetPasswordBytes=crypto.randomBytes(32);
    const forgetPasswordToken=hashToken(forgetPasswordBytes);
    const expires_at = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // A new request cancels any older links that haven't been used yet.
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({
        where:{user_id:exists.id,used_at:null},
        data:{used_at:new Date()}
      }),
      prisma.passwordResetToken.create({data:{
        user_id:exists.id,
        token_hash:forgetPasswordToken,
        expires_at:expires_at
      }})
    ])
    const rawToken=forgetPasswordBytes.toString("hex")
    const resetLink=`${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`

    // Awaited: if the broker doesn't accept the job, the user gets an error instead of a 200 and no email.
    await publishAuthEvents(AUTH_EVENTS.PASSWORD_RESET_REQUESTED,{
      userId:exists.id,
      email:exists.email,
      resetLink
    })
    return res.status(200).json(FORGOT_PASSWORD_RESPONSE)
  }catch(err){
    console.error("forgotPassword error:", err);
    return res.status(500).json({ message: "Something went wrong, please try again" });
  }
}

// POST /auth/reset-password?token=...   body: { password, confirmPassword? }
export const resetPassword = async (req, res) => {
  const { password, confirmPassword } = req.body;
  const rawToken = req.query.token;

  if (typeof rawToken !== "string" || !/^[0-9a-f]{64}$/i.test(rawToken)) {
    return res.status(400).json({ message: "invalid or missing reset link" });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ message: passwordError });
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }

  try {
    const tokenHash = hashToken(Buffer.from(rawToken, "hex"));
    const token = await prisma.passwordResetToken.findUnique({ where: { token_hash: tokenHash } });

    if (!token) {
      return res.status(403).json({ message: "invalid token" });
    }
    if (token.used_at) {
      return res.status(403).json({ message: "token already used" });
    }
    if (token.expires_at < new Date()) {
      return res.status(403).json({ message: "token expired" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    // Password, token and sessions change together: someone resetting because they
    // think they're compromised shouldn't leave the attacker's session alive.
    await prisma.$transaction([
      prisma.user.update({ where: { id: token.user_id }, data: { password: hashedPassword } }),
      prisma.passwordResetToken.update({ where: { id: token.id }, data: { used_at: new Date() } }),
      prisma.session.updateMany({ where: { user_id: token.user_id, revoked_at: null }, data: { revoked_at: new Date() } }),
    ]);
    return res.status(200).json({ message: "password changed successfully" });
  } catch (err) {
    console.error("resetPassword error:", err);
    return res.status(500).json({ message: "database error" });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.user.sub) } });
    if (!user) return res.status(404).json({ message: "user not found" });
    if (user.is_verified) return res.status(400).json({ message: "email already verified" });

    const emailVerifyBytes = crypto.randomBytes(32);
    const tokenHash = hashToken(emailVerifyBytes);
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.emailVerificationToken.updateMany({
        where: { user_id: user.id, used_at: null },
        data: { used_at: new Date() },
      }),
      prisma.emailVerificationToken.create({
        data: { user_id: user.id, token_hash: tokenHash, expires_at },
      }),
    ]);

    const rawToken = emailVerifyBytes.toString("hex");
    const verifyLink = `${process.env.FRONTEND_URL}/confirm-email?token=${rawToken}`;
    await publishAuthEvents(AUTH_EVENTS.EMAIL_VERIFICATION_REQUESTED, {
      userId: user.id,
      email: user.email,
      verifyLink,
    });

    return res.status(200).json({ message: "verification email sent" });
  } catch (err) {
    console.error("verifyEmail error:", err);
    return res.status(500).json({ message: "Something went wrong, please try again" });
  }
};

export const confirmEmail = async (req, res) => {
  const rawToken = req.query.token;
  if (!rawToken) {
    return res.status(400).json({ message: "missing token" });
  }

  try {
    const tokenHash = hashToken(Buffer.from(rawToken, "hex"));
    const tokenRecord = await prisma.emailVerificationToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!tokenRecord) {
      return res.status(403).json({ message: "invalid token" });
    }
    if (tokenRecord.used_at) {
      return res.status(403).json({ message: "token already used" });
    }
    if (tokenRecord.expires_at < new Date()) {
      return res.status(403).json({ message: "token expired" });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: tokenRecord.user_id },
        data: { is_verified: true },
            }),
      prisma.emailVerificationToken.update({
        where: { id: tokenRecord.id },
        data: { used_at: new Date() },
      }),
    ]);

    return res.status(200).json({ message: "email verified" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "database error" });
  }
};

const googleClient=new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
)
export const googleAuth=async(req,res)=>{
  try{
  const state=crypto.randomBytes(32).toString("hex");
  const codeVerifier=crypto.randomBytes(32).toString("base64url")
const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url")
  const key=`oauth:state:${state}`
await redis.set(key, codeVerifier, "EX", 300);
   const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      response_type: "code",           
      scope: "openid email profile",  
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    })
  const googleAuthorizationUrl=`https://accounts.google.com/o/oauth2/auth?${params.toString()}`

  return res.redirect(googleAuthorizationUrl);
}catch(err){
  console.error("Google auth error",err)
  return res.status(500).json({message:"Unable to start google authentication"})
}
}

//now google redirects to /auth/google/callback
// STEP 2: Google redirects here with ?code=&state=
export const googleCallback = async (req, res) => {
  const { code, state } = req.query
  if (!code || !state) {
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_params`)
  }

  try {
    const key = `oauth:state:${state}`
    const codeVerifier = await redis.get(key)
    if (!codeVerifier) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`)
    }
    await redis.del(key)

    // exchange code for Google tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    })
    //fetch returns tokenResponse ok,sttus,statusText,headers,body
  if (!tokenResponse.ok) {
  const errText = await tokenResponse.text()
  console.error("Google token exchange failed:", errText)
  return res.redirect(`${process.env.FRONTEND_URL}/login?error=token_exchange_failed`)
}
    const tokens = await tokenResponse.json()
    const { id_token } = tokens
    if (!id_token) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_id_token`)
    }

    // verify Google's ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    const payload = ticket.getPayload()
    if (!payload) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_token`)
    }

    const { sub: googleId, email, email_verified, name } = payload
    if (!googleId || !email) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_identity`)
    }
    if (!email_verified) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=email_not_verified`)
    }

    const normalizedEmail = email.trim().toLowerCase()

    // find existing OAuth link
    let oauthAccount = await prisma.oAuthAccount.findUnique({
      where: {
        provider_provider_user_id: {
          provider: "google",
          provider_user_id: googleId,
        },
      },
      include: { user: true },
    })

    let user

    if (oauthAccount) {
      user = oauthAccount.user
    } else {
      // check if a local account already exists with this email
      user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

      if (!user) {
        user = await prisma.user.create({
          data: {
            name: name || "Google User",
            email: normalizedEmail,
            is_verified: true, // Google already verified this email
          },
        })
      }

      await prisma.oAuthAccount.create({
        data: {
          provider: "google",
          provider_user_id: googleId,
          user_id: user.id,
        },
      })
    }

    // issue YOUR tokens the same way createUserSession does for password login
    const { refreshToken, accessToken } = await createUserSession(user, req)

    res.cookie("refreshToken", refreshToken, REFRESH_COOKIE)

    // redirect back to frontend with the access token
    return res.redirect(`${process.env.FRONTEND_URL}/oauth-success?token=${accessToken}`)
  } catch (err) {
    console.error("Google callback error:", err)
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`)
  }
}