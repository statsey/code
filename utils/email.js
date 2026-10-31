const nodemailer = require("nodemailer");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let transporter;

function createEmailError(message, code, statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function getTransporter() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465;
  const from = process.env.SMTP_FROM || user;

  if (
    host !== "smtp.gmail.com" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !user ||
    !pass ||
    !from
  ) {
    throw createEmailError(
      "Gmail SMTP is not configured. Set SMTP_USER, SMTP_PASS, and optionally SMTP_FROM.",
      "SMTP_NOT_CONFIGURED"
    );
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user || pass ? { user, pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000
    });
  }

  return { transporter, from };
}

async function sendApiKeyEmail({ to, apiKey, handle, purpose }) {
  if (typeof to !== "string" || !emailPattern.test(to)) {
    throw createEmailError("A valid email address is required to deliver the API key", "EMAIL_REQUIRED", 400);
  }
  if (typeof apiKey !== "string" || !apiKey) {
    throw new TypeError("An API key is required to send the email");
  }

  const { transporter, from } = getTransporter();
  const action = purpose === "rotation" ? "rotated" : "created";
  const greeting = handle ? `Hello ${handle},` : "Hello,";

  try {
    await transporter.sendMail({
      from,
      to,
      subject: `Your Statsey API key was ${action}`,
      text: `${greeting}\n\nYour Statsey API key is:\n\n${apiKey}\n\nKeep this key private. If you did not request this, rotate it immediately.\n`
    });
  } catch (error) {
    const deliveryError = createEmailError(
      "Unable to deliver the API key email",
      "EMAIL_DELIVERY_FAILED"
    );
    deliveryError.cause = error;
    throw deliveryError;
  }
}

module.exports = {
  sendApiKeyEmail
};
