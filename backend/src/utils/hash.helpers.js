import crypto, { hash } from "node:crypto";

export const hashToken=(token)=>{
    return crypto.createHash("sha256").update(token).digest("hex")
}

export const verifyTokenHash=(token,storedhash)=>{
    const hashedToken=hashToken(token);
    return crypto.timingSafeEqual(Buffer.from(hashedToken,"hex"),(Buffer.from(storedhash,"hex")))
}

