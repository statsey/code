const express = require("express");
const router = express.Router();
const {
  createProject,
  deleteProject
} = require("../utils/createProject.js");
const {
  addProjectIdToUser,
  getUserInfoFromToken
} = require("../utils/token.js");
const { executeProjectQuery } = require("../utils/queryProject.js");
const {
  getTransactions,
  appendTransaction,
  getRequestSource,
  getSafeActor
} = require("../utils/transactions.js");
const { createRateLimiter } = require("../utils/rateLimit.js");

const projectCreationRateLimit = createRateLimiter({
  limit: 10,
  windowMs: 60_000
});
const queryRateLimit = createRateLimiter({
  limit: 20,
  windowMs: 60_000
});
const transactionReadRateLimit = createRateLimiter({
  limit: 60,
  windowMs: 60_000
});

router.post("/add", projectCreationRateLimit, async (req, res) => {
  try {
    const authorization = req.get("authorization");
    const userInfo = await getUserInfoFromToken(authorization);

    if (!userInfo) {
      return res.status(401).json({
        message: "Invalid or missing token"
      });
    }

    const projectName = req.body?.projectName;
    const project = await createProject(projectName);

    try {
      const updatedUser = await addProjectIdToUser(authorization, project.projectId);
      if (!updatedUser) {
        await deleteProject(project.projectId);
        return res.status(401).json({
          message: "Invalid or missing token"
        });
      }
    } catch (error) {
      await deleteProject(project.projectId);
      throw error;
    }

    return res.status(201).json({
      message: "Project created successfully",
      project
    });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({
        message: error.message
      });
    }

    console.error("Project creation error:", error);
    return res.status(500).json({
      message: "Unable to create project"
    });
  }
});

router.get("/:projectId/transactions", transactionReadRateLimit, async (req, res) => {
  try {
    const authorization = req.get("authorization");
    const userInfo = await getUserInfoFromToken(authorization);

    if (!userInfo) {
      return res.status(401).json({
        message: "Invalid or missing token"
      });
    }

    const { projectId } = req.params;
    if (!Array.isArray(userInfo.projectIds) || !userInfo.projectIds.includes(projectId)) {
      return res.status(403).json({
        message: "You do not have access to this project"
      });
    }

    const transactions = await getTransactions(projectId);
    return res.status(200).json({
      projectId,
      count: transactions.length,
      transactions
    });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({
        message: error.message
      });
    }

    console.error("Transaction history error:", error);
    return res.status(500).json({
      message: "Unable to read transaction history"
    });
  }
});

router.post("/action", queryRateLimit, async (req, res) => {
  try {
    const authorization = req.get("authorization");
    const userInfo = await getUserInfoFromToken(authorization);

    if (!userInfo) {
      return res.status(401).json({
        message: "Invalid or missing token"
      });
    }

    const { command, params, projectId } = req.body || {};
    if (
      typeof projectId !== "string" ||
      !Array.isArray(userInfo.projectIds) ||
      !userInfo.projectIds.includes(projectId)
    ) {
      return res.status(403).json({
        message: "You do not have access to this project"
      });
    }

    const result = await executeProjectQuery(projectId, command, params);
    let transaction = null;
    let transactionLogError = null;

    if (result.queryType === "write") {
      try {
        transaction = await appendTransaction(projectId, {
          actor: getSafeActor(userInfo),
          source: getRequestSource(req),
          change: {
            command: command.trim(),
            params: params || []
          },
          result: {
            durationMs: result.durationMs,
            affectedRows: result.affectedRows,
            affectedColumns: result.affectedColumns,
            lastInsertRowid: result.lastInsertRowid || null
          }
        });
      } catch (error) {
        console.error("Transaction log error:", error);
        transactionLogError = "The database change succeeded, but its transaction could not be logged";
      }
    }

    return res.status(200).json({
      message: "Query executed successfully",
      projectId,
      ...result,
      transaction,
      ...(transactionLogError ? { transactionLogError } : {})
    });
  } catch (error) {
    if (Number.isInteger(error.statusCode)) {
      return res.status(error.statusCode).json({
        message: error.message
      });
    }

    console.error("Project action error:", error);
    return res.status(500).json({
      message: "Unable to execute project action"
    });
  }
});

module.exports = router;
