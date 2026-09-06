import redis from "../config/redis.client.js";
 
export const loginRateLimiter = async (req, res, next) => {
  const ipAddress = req.ip;
  const key = `rate_limit:login:${ipAddress}`;
 console.log("ran redis")
 console.log(key)
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
 