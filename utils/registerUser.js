const { writeFile } = require('fs/promises');
const { generateApiKey } = require('./keys.js');
const fs = require("fs/promises");
async function registerUser(email, handel) {
  const handelPattern = /^[a-zA-Z0-9_-]{3,16}$/;
  const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
  const isHandelValid = handelPattern.test(handel);
  const isEmailValid = emailPattern.test(email);
  const apiKey = generateApiKey();
  if (isEmailValid || isHandelValid) {
    try {
      const Data = {
        handel: handel,
        email: email,
        apikey: apiKey
      }
      //determines if the acc alrdy exists
      const doesAccountExist = await fs.access(UserEntiresPath)
      const DataString = JSON.stringify(Data);
      const UserEntiresPath = `user_meta/${handel}.json`
      try {
        await fs.access(UserEntiresPath)
        return { message: "This User already exists", statusCode: 409 }
      } catch {
        try {
          await writeFile(UserEntiresPath, DataString)
          return { message: "user registered successfully", apikey: apiKey, statusCode: 200}
        } catch (error) {
          return { message: "An error occured while registering yeah pack ur bags what are you looking at like cuh", statusCode: 500}
        }
      }
    } catch (error) {
      return { message: "An error occured while registering yeah pack ur bags what are you looking at like cuh", statusCode: 500}
    }
  }

}
