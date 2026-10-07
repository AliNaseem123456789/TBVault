import redis from "../config/redis.client.js";
 
export const loginRateLimiter = async (req, res, next) => {
  const ipAddress = req.ip;
  const key = `rate_limit:login:${ipAddress}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }
    if (count > 5) {
      return res.status(429).json({ message: "Too many requests" });
    }
    next();
  } catch (err) {
    console.error(err);
    // fail open: don't block logins if Redis itself is down
    next();
  }
};

/**
 * General fixed-window limiter.
 *   rateLimit({ name: "forgot-password", max: 5, windowSec: 3600 })
 * keyFn picks what is limited (default: the client IP). Returning null skips the
 * limit for that request, e.g. when the body has no email yet. Fails open if Redis is down.
 */
export const rateLimit = ({ name, max, windowSec, keyFn = (req) => req.ip, message = "Too many requests, please try again later" }) =>
  async (req, res, next) => {
    const id = keyFn(req)
    if (!id) return next()
    const key = `rate_limit:${name}:${String(id).toLowerCase()}`
    try {
      const count = await redis.incr(key)
      if (count === 1) await redis.expire(key, windowSec)
      if (count > max) return res.status(429).json({ message })
      next()
    } catch (err) {
      console.error(`[rateLimit:${name}]`, err.message)
      next()
    }
  }
