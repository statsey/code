const { createHash } = require("node:crypto");

function defaultKeyGenerator(req) {
  const authorization = req.get("authorization");
  const token = typeof authorization === "string" ? authorization.trim() : "";

  if (/^Bearer\s+sk_live_statsey:[a-f0-9]{128}$/i.test(token)) {
    return `token:${createHash("sha256").update(token).digest("hex")}`;
  }

  return `ip:${req.ip || "unknown"}`;
}

function createRateLimiter({ limit, windowMs, keyGenerator = defaultKeyGenerator }) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError("Rate limit must be a positive integer");
  }
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new TypeError("Rate limit window must be a positive integer");
  }

  const buckets = new Map();
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, windowMs);
  cleanupTimer.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator(req);
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + windowMs
      };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    const resetInSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.set("X-RateLimit-Limit", String(limit));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      res.set("Retry-After", String(resetInSeconds));
      return res.status(429).json({
        message: "Rate limit exceeded",
        retryAfterSeconds: resetInSeconds
      });
    }

    return next();
  };
}

module.exports = {
  createRateLimiter
};
