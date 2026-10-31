const path = require('node:path');
const { loadEnvFile } = require('node:process');
const express = require('express');
const { createRateLimiter } = require('../utils/rateLimit.js');

try {
  loadEnvFile(path.resolve(__dirname, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}
const app = express();
const port = process.env.PORT || 8000;

app.use(createRateLimiter({
  limit: 120,
  windowMs: 60_000
}));
app.use(express.json({ limit: "64kb" }));

app.get('/', (req, res) => {
  res.send('homepade fucker');
});

const cors = require("cors");
app.use(cors());

app.use("/api/auth", require("../routes/auth"));
app.use("/api/projects", require("../routes/project"));

app.listen(port, () => {
  console.log(`Server started on the port something idfk ${port}`);
});
