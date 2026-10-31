const path = require("node:path");
const { mkdir, rm, writeFile } = require("node:fs/promises");
const { generateApiKey } = require("./keys.js");
const { sendApiKeyEmail } = require("./email.js");

const userEntriesDirectory = path.resolve(__dirname, "..", "user_meta");

async function registerUser(email, handle) {
  const handlePattern = /^[a-zA-Z0-9_-]{3,16}$/;
  const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
  const isHandleValid = typeof handle === "string" && handlePattern.test(handle);
  const isEmailValid = typeof email === "string" && emailPattern.test(email);

  if (!isEmailValid) {
    return {
      message: "A valid email is required to receive the API key",
      statusCode: 400
    };
  }

  const apiKey = generateApiKey();
  if (!apiKey) {
    return { message: "Unable to generate an API key", statusCode: 500 };
  }

  const userData = {
    handle: isHandleValid ? handle : undefined,
    email: isEmailValid ? email : undefined,
    apikey: apiKey,
    projectIds: []
  };
  const identity = isHandleValid ? handle : email;
  const userEntriesPath = path.join(userEntriesDirectory, `${encodeURIComponent(identity)}.json`);

  let userFileCreated = false;
  try {
    await mkdir(userEntriesDirectory, { recursive: true });
    await writeFile(userEntriesPath, JSON.stringify(userData), { flag: "wx" });
    userFileCreated = true;

    await sendApiKeyEmail({
      to: email,
      apiKey,
      handle: isHandleValid ? handle : undefined,
      purpose: "registration"
    });

    return {
      message: "User registered successfully. The API key was sent by email.",
      statusCode: 200
    };
  } catch (error) {
    if (userFileCreated) {
      await rm(userEntriesPath, { force: true }).catch(() => {});
    }

    if (error.code === "EEXIST") {
      return { message: "This User already exists", statusCode: 409 };
    }
    if (Number.isInteger(error.statusCode)) {
      return { message: error.message, statusCode: error.statusCode };
    }

    return {
      message: "An error occurred while registering the user",
      statusCode: 500
    };
  }
}

module.exports = {
  registerUser
};
