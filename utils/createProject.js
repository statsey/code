const path = require("node:path");
const { mkdir, rm } = require("node:fs/promises");
const { randomBytes } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const projectEntriesDirectory = path.resolve(__dirname, "..", "projects");
const projectNamePattern = /^.{1,100}$/u;

function createProjectId() {
  return randomBytes(16).toString("hex");
}

function validateProjectName(projectName) {
  if (typeof projectName !== "string") {
    throw new TypeError("Project name must be a string");
  }

  const normalizedName = projectName.trim();
  if (!projectNamePattern.test(normalizedName)) {
    throw new TypeError("Project name must be between 1 and 100 characters");
  }

  return normalizedName;
}

async function createProject(projectName) {
  const normalizedName = validateProjectName(projectName);
  await mkdir(projectEntriesDirectory, { recursive: true });

  let projectId;
  let projectPath;
  let database;

  try {
    // A random ID keeps the user-provided name out of filesystem paths.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      projectId = createProjectId();
      projectPath = path.join(projectEntriesDirectory, projectId);

      try {
        await mkdir(projectPath);
        break;
      } catch (error) {
        if (error.code !== "EEXIST" || attempt === 4) {
          throw error;
        }
      }
    }

    const databasePath = path.join(projectPath, "project.sqlite");
    database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE project_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    database
      .prepare(
        "INSERT INTO project_metadata (id, name, created_at) VALUES (1, ?, ?)"
      )
      .run(normalizedName, new Date().toISOString());

    return {
      projectId,
      name: normalizedName
    };
  } catch (error) {
    if (projectPath) {
      await rm(projectPath, { recursive: true, force: true }).catch(() => {});
    }

    throw error;
  } finally {
    database?.close();
  }
}

async function deleteProject(projectId) {
  if (typeof projectId !== "string" || !/^[a-f0-9]{32}$/.test(projectId)) {
    throw new TypeError("Invalid project ID");
  }

  await rm(path.join(projectEntriesDirectory, projectId), {
    recursive: true,
    force: true
  });
}

module.exports = {
  createProject,
  deleteProject
};
