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

router.post("/add", async (req, res) => {
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

module.exports = router;
