const path = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const { generateApiKey } = require("./keys.js");

const userEntriesDirectory = path.resolve(__dirname, "..", "user_meta");

async function registerUser(email, handle) {
  const handlePattern = /^[a-zA-Z0-9_-]{3,16}$/;
  const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
  const isHandleValid = typeof handle === "string" && handlePattern.test(handle);
  const isEmailValid = typeof email === "string" && emailPattern.test(email);

  if (!isEmailValid && !isHandleValid) {
    return { message: "Enter a valid email or handle", statusCode: 400 };
  }

  const apiKey = generateApiKey();
  if (!apiKey) {
    return { message: "Unable to generate an API key", statusCode: 500 };
  }

  const userData = {
    handle: isHandleValid ? handle : undefined,
    email: isEmailValid ? email : undefined,
    apikey: apiKey
  };
  const identity = isHandleValid ? handle : email;
  const userEntriesPath = path.join(userEntriesDirectory, `${encodeURIComponent(identity)}.json`);

  try {
    await mkdir(userEntriesDirectory, { recursive: true });
    await writeFile(userEntriesPath, JSON.stringify(userData), { flag: "wx" });

    return {
      message: "user registered successfully",
      apikey: apiKey,
      statusCode: 200
    };
  } catch (error) {
    if (error.code === "EEXIST") {
      return { message: "This User already exists", statusCode: 409 };
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
