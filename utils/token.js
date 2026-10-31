const path = require("node:path");
const { createHash, timingSafeEqual } = require("node:crypto");
const { readdir, readFile, writeFile } = require("node:fs/promises");
const { generateApiKey } = require("./keys.js");

const userEntriesDirectory = path.resolve(__dirname, "..", "user_meta");
const tokenPattern = /^sk_live_statsey:[a-f0-9]{128}$/;
const apiKeyRotationQueues = new Map();

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

async function findUserEntryFromToken(value) {
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
    const entryPath = path.join(userEntriesDirectory, entry.name);
    try {
      const contents = await readFile(entryPath, "utf8");
      userInfo = JSON.parse(contents);
    } catch {
      // Ignore malformed metadata files and continue looking for the token.
      continue;
    }

    if (!userInfo || typeof userInfo.apikey !== "string" || !tokensMatch(token, userInfo.apikey)) {
      continue;
    }

    return { entryPath, userInfo };
  }

  return null;
}

function withoutApiKey(userInfo) {
  const { apikey, ...safeUserInfo } = userInfo;
  return safeUserInfo;
}

async function getUserInfoFromToken(value) {
  const userEntry = await findUserEntryFromToken(value);
  return userEntry ? withoutApiKey(userEntry.userInfo) : null;
}

async function addProjectIdToUser(value, projectId) {
  if (typeof projectId !== "string" || !/^[a-f0-9]{32}$/.test(projectId)) {
    throw new TypeError("Invalid project ID");
  }

  const userEntry = await findUserEntryFromToken(value);
  if (!userEntry) {
    return null;
  }

  const currentProjectIds = Array.isArray(userEntry.userInfo.projectIds)
    ? userEntry.userInfo.projectIds.filter((id) => typeof id === "string")
    : [];
  const projectIds = currentProjectIds.includes(projectId)
    ? currentProjectIds
    : [...currentProjectIds, projectId];

  const updatedUserInfo = {
    ...userEntry.userInfo,
    projectIds
  };
  await writeFile(userEntry.entryPath, JSON.stringify(updatedUserInfo), "utf8");

  return withoutApiKey(updatedUserInfo);
}

async function rotateApiKey(value) {
  const token = normalizeToken(value);
  if (!hasValidTokenFormat(token)) {
    return null;
  }

  const queueKey = createHash("sha256").update(token).digest("hex");
  const previous = apiKeyRotationQueues.get(queueKey) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const userEntry = await findUserEntryFromToken(token);
    if (!userEntry) {
      return null;
    }

    const apiKey = generateApiKey();
    if (!apiKey) {
      throw new Error("Unable to generate an API key");
    }

    const updatedUserInfo = {
      ...userEntry.userInfo,
      apikey: apiKey
    };
    await writeFile(userEntry.entryPath, JSON.stringify(updatedUserInfo), "utf8");

    return {
      apikey: apiKey,
      userInfo: withoutApiKey(updatedUserInfo)
    };
  });

  const trackedOperation = operation.finally(() => {
    if (apiKeyRotationQueues.get(queueKey) === trackedOperation) {
      apiKeyRotationQueues.delete(queueKey);
    }
  });
  apiKeyRotationQueues.set(queueKey, trackedOperation);

  return trackedOperation;
}

async function validateToken(value) {
  return (await getUserInfoFromToken(value)) !== null;
}

module.exports = {
  getUserInfoFromToken,
  getUserInfo: getUserInfoFromToken,
  addProjectIdToUser,
  rotateApiKey,
  validateToken,
  normalizeToken
};
