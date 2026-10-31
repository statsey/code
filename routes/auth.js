const express = require("express");
const router = express.Router();
const { registerUser } = require("../utils/registerUser.js");
const {
  getUserInfoFromToken,
  rotateApiKey
} = require("../utils/token.js");
const { createRateLimiter } = require("../utils/rateLimit.js");

const keyRotationRateLimit = createRateLimiter({
  limit: 5,
  windowMs: 60_000
});

router.post("/register", async (req, res) => {
  const { email, handle } = req.body;

  if (!email && !handle) {
    return res.status(400).json({
      message: "Twin, add your handle or email"
    });
  }

  try {
    const result = await registerUser(email, handle);

    return res.status(result.statusCode).json(result);
  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
});

router.post("/rotate-key", keyRotationRateLimit, async (req, res) => {
  try {
    const result = await rotateApiKey(req.get("authorization"));

    if (!result) {
      return res.status(401).json({
        message: "Invalid or missing token"
      });
    }

    return res.status(200).json({
      message: "API key rotated successfully",
      apikey: result.apikey,
      user: result.userInfo
    });
  } catch (error) {
    console.error("API key rotation error:", error);

    return res.status(500).json({
      message: "Unable to rotate API key"
    });
  }
});

router.get("/userinfo", async (req, res) => {
  try {
    const userInfo = await getUserInfoFromToken(req.get("authorization"));

    if (!userInfo) {
      return res.status(401).json({
        message: "Invalid or missing token"
      });
    }

    return res.status(200).json(userInfo);
  } catch (error) {
    console.error("User info error:", error);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
});

module.exports = router;
