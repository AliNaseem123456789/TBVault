import crypto from "node:crypto";
import prisma from "../config/db.js";
import { generateAccessToken, generateRefreshToken } from "./jwt.helpers.js";

export const createUserSession = async (user, req) => {
  const jti = crypto.randomUUID();
  const accessToken = generateAccessToken(user.id, user.role);
  const refreshToken = generateRefreshToken(user.id, user.role, jti);
  const hashedRefreshToken = crypto.createHash("sha256").update(refreshToken).digest("hex");

  const now = new Date();
  const expires_at = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      user_id: user.id,
      refresh_token_hash: hashedRefreshToken,
      jti: jti,
      expires_at: expires_at,
      user_agent: req.headers["user-agent"],
      ip_address: req.ip,
      device_name: null,
    },
  });

  return { accessToken, refreshToken };
};