const path = require("node:path");
const { timingSafeEqual } = require("node:crypto");
const { readdir, readFile } = require("node:fs/promises");

const userEntriesDirectory = path.resolve(__dirname, "..", "user_meta");
const tokenPattern = /^sk_live_statsey:[a-f0-9]{128}$/;

function normalizeToken(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const token = value.trim();
  if (/^Bearer\s/i.test(token)) {
    return token.slice(7).trim();
  }

  return token;
}

function hasValidTokenFormat(token) {
  return typeof token === "string" && tokenPattern.test(token);
}

function tokensMatch(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function getUserInfoFromToken(value) {
  const token = normalizeToken(value);
  if (!hasValidTokenFormat(token)) {
    return null;
  }

  let entries;
  try {
    entries = await readdir(userEntriesDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    let userInfo;
    try {
      const contents = await readFile(path.join(userEntriesDirectory, entry.name), "utf8");
      userInfo = JSON.parse(contents);
    } catch {
      // Ignore malformed metadata files and continue looking for the token.
      continue;
    }

    if (!userInfo || typeof userInfo.apikey !== "string" || !tokensMatch(token, userInfo.apikey)) {
      continue;
    }

    const { apikey, ...safeUserInfo } = userInfo;
    return safeUserInfo;
  }

  return null;
}

async function validateToken(value) {
  return (await getUserInfoFromToken(value)) !== null;
}

module.exports = {
  getUserInfoFromToken,
  getUserInfo: getUserInfoFromToken,
  validateToken,
  normalizeToken
};
