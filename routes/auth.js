const express = require("express");
const router = express.Router();
const { registerUser } = require('../utils/registerUser.js');

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

module.exports = router;
