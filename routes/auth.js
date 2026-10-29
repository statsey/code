const express = require("express");
const router = express.Router();
const { registerUser } = require("../utils/registerUser.js");
const { getUserInfoFromToken } = require("../utils/token.js");

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
