import { randomBytes, createHash } from "node:crypto";

function generateApiKey() {
  try {
    const apiKey = `sk_live_statsey:${randomBytes(64).toString("hex")}`;
    return apiKey;
  } catch (error) {
    return undefined;
  }
}

module.exports = {
  generateApiKey
}
