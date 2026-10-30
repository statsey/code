const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readFile, writeFile } = require("node:fs/promises");

const projectEntriesDirectory = path.resolve(__dirname, "..", "projects");
const projectIdPattern = /^[a-f0-9]{32}$/;
const transactionQueues = new Map();

function validateProjectId(projectId) {
  if (typeof projectId !== "string" || !projectIdPattern.test(projectId)) {
    throw new TypeError("Invalid project ID");
  }
}

function getTransactionsPath(projectId) {
  validateProjectId(projectId);
  return path.join(projectEntriesDirectory, projectId, "transactions.json");
}

async function readTransactions(transactionsPath) {
  try {
    const contents = await readFile(transactionsPath, "utf8");
    const transactions = JSON.parse(contents);
    if (!Array.isArray(transactions)) {
      throw new Error("Transaction journal must contain an array");
    }
    return transactions;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function getRequestCountry(req) {
  const countryHeader =
    req.get("cf-ipcountry") ||
    req.get("x-vercel-ip-country") ||
    req.get("x-country");

  if (typeof countryHeader !== "string") {
    return null;
  }

  const country = countryHeader.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function getRequestSource(req) {
  return {
    ip: typeof req.ip === "string" ? req.ip : null,
    country: getRequestCountry(req),
    userAgent: req.get("user-agent") || null,
    method: req.method,
    path: req.originalUrl || req.path || null
  };
}

function getSafeActor(userInfo) {
  return {
    handle: typeof userInfo?.handle === "string" ? userInfo.handle : null,
    email: typeof userInfo?.email === "string" ? userInfo.email : null
  };
}

async function appendTransaction(projectId, details) {
  const transactionsPath = getTransactionsPath(projectId);
  const previous = transactionQueues.get(projectId) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const transactions = await readTransactions(transactionsPath);
    const transaction = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...details
    };

    const updatedTransactions = [...transactions, transaction].slice(-100);
    await writeFile(transactionsPath, JSON.stringify(updatedTransactions, null, 2), "utf8");
    return transaction;
  });

  const trackedOperation = operation.finally(() => {
    if (transactionQueues.get(projectId) === trackedOperation) {
      transactionQueues.delete(projectId);
    }
  });
  transactionQueues.set(projectId, trackedOperation);

  return trackedOperation;
}

module.exports = {
  appendTransaction,
  getRequestSource,
  getSafeActor
};
