const { randomBytes } = require("node:crypto");

function generateApiKey() {
  try {
    return `sk_live_statsey:${randomBytes(64).toString("hex")}`;
  } catch (error) {
    return undefined;
  }
}

module.exports = {
  generateApiKey
};
