const { DatabaseSync } = require("node:sqlite");
const { parentPort, workerData } = require("node:worker_threads");

const {
  databasePath,
  command,
  params,
  queryType,
  maxRows,
  maxRowBytes,
  maxResponseBytes
} = workerData;

function queryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeValue(value, maxRowBytes) {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    if (value.byteLength > maxRowBytes) {
      throw queryError("RESULT_TOO_LARGE", "A result row is too large");
    }
    return value.toString("base64");
  }

  if (typeof value === "string" && Buffer.byteLength(value, "utf8") > maxRowBytes) {
    throw queryError("RESULT_TOO_LARGE", "A result row is too large");
  }

  return value;
}

function normalizeRow(row, maxRowBytes) {
  const normalizedRow = {};
  for (const [column, value] of Object.entries(row)) {
    normalizedRow[column] = normalizeValue(value, maxRowBytes);
  }

  const rowBytes = Buffer.byteLength(JSON.stringify(normalizedRow), "utf8");
  if (rowBytes > maxRowBytes) {
    throw queryError("RESULT_TOO_LARGE", "A result row is too large");
  }

  return { normalizedRow, rowBytes };
}

function toSafeNumber(value) {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  return value;
}

function runQuery() {
  const database = new DatabaseSync(databasePath, { readOnly: false });
  const statement = database.prepare(command);

  try {
    const columns = statement.columns().map((column) => column.name || column.column);

    if (queryType === "read") {
      const rows = [];
      let responseBytes = 0;
      const iterator = statement.iterate(...params);

      while (rows.length < maxRows) {
        const next = iterator.next();
        if (next.done) {
          break;
        }

        const { normalizedRow, rowBytes } = normalizeRow(next.value, maxRowBytes);
        responseBytes += rowBytes;
        if (responseBytes > maxResponseBytes) {
          throw queryError("RESULT_TOO_LARGE", "The query result is too large");
        }
        rows.push(normalizedRow);
      }

      return {
        columns,
        rows,
        rowCount: rows.length,
        truncated: rows.length === maxRows,
        affectedRows: 0,
        affectedColumns: []
      };
    }

    const result = statement.run(...params);
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      affectedRows: toSafeNumber(result.changes),
      affectedColumns: workerData.affectedColumns,
      lastInsertRowid: toSafeNumber(result.lastInsertRowid)
    };
  } finally {
    database.close();
  }
}

try {
  parentPort.postMessage({
    ok: true,
    result: runQuery()
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    code: error.code || "QUERY_FAILED",
    message: error.message || "Query failed"
  });
}
