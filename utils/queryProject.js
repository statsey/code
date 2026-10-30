const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");

const projectEntriesDirectory = path.resolve(__dirname, "..", "projects");
const queryWorkerPath = path.join(__dirname, "runQueryWorker.js");

const MAX_QUERY_BYTES = 16 * 1024;
const MAX_PARAMS = 100;
const MAX_PARAMS_BYTES = 32 * 1024;
const MAX_NUMERIC_PARAMETER = 10_000_000;
const MAX_ROWS = 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ROW_BYTES = 512 * 1024;
const QUERY_TIMEOUT_MS = 2000;
const projectIdPattern = /^[a-f0-9]{32}$/;

class QueryError extends Error {
  constructor(message, statusCode = 400, code = "QUERY_ERROR") {
    super(message);
    this.name = "QueryError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function validateProjectId(projectId) {
  if (typeof projectId !== "string" || !projectIdPattern.test(projectId)) {
    throw new QueryError("Invalid project ID");
  }
}

function normalizeCommand(command) {
  if (typeof command !== "string") {
    throw new QueryError("command must be a SQL string");
  }

  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    throw new QueryError("command cannot be empty");
  }
  if (Buffer.byteLength(normalizedCommand, "utf8") > MAX_QUERY_BYTES) {
    throw new QueryError("command is too large", 413, "QUERY_TOO_LARGE");
  }
  if (normalizedCommand.includes(";")) {
    throw new QueryError("Only one SQL statement is allowed");
  }
  if (/\b(randomblob|zeroblob|readfile|writefile|printf|format)\s*\(/i.test(normalizedCommand)) {
    throw new QueryError("Potentially unbounded result functions are not allowed");
  }

  const firstKeyword = normalizedCommand.match(/^([a-z]+)/i)?.[1].toUpperCase();
  const readKeywords = new Set(["SELECT", "EXPLAIN"]);
  const writeKeywords = new Set([
    "ALTER",
    "CREATE",
    "DELETE",
    "DROP",
    "INSERT",
    "REPLACE",
    "UPDATE"
  ]);

  if (readKeywords.has(firstKeyword)) {
    return { command: normalizedCommand, queryType: "read" };
  }
  if (writeKeywords.has(firstKeyword)) {
    return { command: normalizedCommand, queryType: "write" };
  }

  throw new QueryError(
    "Only SELECT, EXPLAIN, INSERT, REPLACE, UPDATE, DELETE, and basic schema statements are allowed"
  );
}

function validateParams(params) {
  if (params === undefined) {
    return [];
  }
  if (!Array.isArray(params)) {
    throw new QueryError("params must be an array");
  }
  if (params.length > MAX_PARAMS) {
    throw new QueryError("Too many query parameters", 413, "PARAMS_TOO_LARGE");
  }

  let serializedParams;
  try {
    serializedParams = JSON.stringify(params);
  } catch {
    throw new QueryError("params must contain JSON-compatible values");
  }
  if (Buffer.byteLength(serializedParams, "utf8") > MAX_PARAMS_BYTES) {
    throw new QueryError("Query parameters are too large", 413, "PARAMS_TOO_LARGE");
  }

  for (const param of params) {
    if (
      param !== null &&
      typeof param !== "string" &&
      typeof param !== "number" &&
      typeof param !== "boolean"
    ) {
      throw new QueryError("params may only contain strings, numbers, booleans, or null");
    }
    if (typeof param === "number" && !Number.isFinite(param)) {
      throw new QueryError("params cannot contain non-finite numbers");
    }
    if (typeof param === "number" && Math.abs(param) > MAX_NUMERIC_PARAMETER) {
      throw new QueryError("Numeric parameters are too large", 413, "PARAMS_TOO_LARGE");
    }
  }

  return params;
}

function splitTopLevel(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function cleanColumnName(value) {
  return value
    .trim()
    .replace(/^[`"[]/, "")
    .replace(/[`"\]]$/, "")
    .split(".")
    .pop();
}

function extractAffectedColumns(command, queryType) {
  if (queryType !== "write") {
    return [];
  }

  const normalized = command.replace(/\s+/g, " ").trim();
  const keyword = normalized.match(/^([a-z]+)/i)?.[1].toUpperCase();

  if (keyword === "UPDATE") {
    const setClause = normalized.match(/\bSET\b([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/i)?.[1];
    return setClause
      ? splitTopLevel(setClause).map((part) => cleanColumnName(part.split("=")[0]))
      : [];
  }

  if (keyword === "INSERT" || keyword === "REPLACE") {
    const columns = normalized.match(/\bINTO\b[^()]+\(([^()]*)\)/i)?.[1];
    return columns ? splitTopLevel(columns).map(cleanColumnName) : [];
  }

  if (keyword === "ALTER") {
    const column = normalized.match(/\bADD\s+(?:COLUMN\s+)?([`"\w]+)/i)?.[1];
    return column ? [cleanColumnName(column)] : [];
  }

  if (keyword === "CREATE") {
    const definitions = normalized.match(/\((.*)\)/)?.[1];
    if (!definitions) {
      return [];
    }
    return splitTopLevel(definitions)
      .filter((definition) => !/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(definition))
      .map((definition) => cleanColumnName(definition.split(/\s+/)[0]));
  }

  return [];
}

function workerError(code, message) {
  const statusCode =
    code === "RESULT_TOO_LARGE" || code === "QUERY_TOO_LARGE" || code === "PARAMS_TOO_LARGE"
      ? 413
      : 400;
  return new QueryError(message, statusCode, code);
}

function runQueryInWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(queryWorkerPath, {
      workerData,
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16
      }
    });
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      worker.terminate();
      reject(new QueryError("Query exceeded the execution time limit", 408, "QUERY_TIMEOUT"));
    }, QUERY_TIMEOUT_MS);

    worker.once("message", (message) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (message.ok) {
        resolve(message.result);
      } else {
        reject(workerError(message.code, message.message));
      }
    });

    worker.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new QueryError(error.message, 500, "QUERY_WORKER_ERROR"));
    });

    worker.once("exit", (exitCode) => {
      if (!settled && exitCode !== 0) {
        settled = true;
        clearTimeout(timeout);
        reject(new QueryError("Query worker stopped unexpectedly", 500, "QUERY_WORKER_ERROR"));
      }
    });
  });
}

async function executeProjectQuery(projectId, command, params) {
  validateProjectId(projectId);
  const { command: normalizedCommand, queryType } = normalizeCommand(command);
  const normalizedParams = validateParams(params);
  const affectedColumns = extractAffectedColumns(normalizedCommand, queryType);
  const databasePath = path.join(projectEntriesDirectory, projectId, "project.sqlite");
  const startedAt = performance.now();

  const result = await runQueryInWorker({
    databasePath,
    command: normalizedCommand,
    params: normalizedParams,
    queryType,
    affectedColumns,
    maxRows: MAX_ROWS,
    maxRowBytes: MAX_ROW_BYTES,
    maxResponseBytes: MAX_RESPONSE_BYTES
  });

  return {
    ...result,
    queryType,
    durationMs: Number((performance.now() - startedAt).toFixed(2))
  };
}

module.exports = {
  executeProjectQuery,
  QueryError
};
