import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
const authToken = process.env.TWILIO_AUTH_TOKEN || "";
const fromNumber = process.env.TWILIO_PHONE_NUMBER || "";
const notifyNumbers = (process.env.TWILIO_NOTIFY_TO || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const allowedSenders = new Set(
  (process.env.TWILIO_ALLOWED_FROM || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

let client = null;
if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
}

export const isTwilioConfigured = () => Boolean(client && fromNumber);

export const isSenderAllowed = (from) => {
  if (!from) return false;
  if (allowedSenders.size === 0) return true;
  return allowedSenders.has(String(from).trim());
};

export const normalizeCommand = (value) => String(value || "").trim().toLowerCase();

export const parseTwilioCommand = (rawText) => {
  const text = normalizeCommand(rawText);
  if (!text) return { action: "help" };
  if (text === "help" || text === "commands") return { action: "help" };
  if (text === "pump on" || text === "on") return { action: "pump_on" };
  if (text === "auto" || text === "pump auto" || text === "off") return { action: "auto" };
  if (text === "kill" || text === "pump kill") return { action: "kill" };
  if (text === "getinfo" || text === "get info" || text === "info" || text === "status") {
    return { action: "get_info" };
  }
  return { action: "unknown" };
};

export const twimlResponse = (message) => {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
  return body;
};

export const sendSms = async (to, body) => {
  if (!isTwilioConfigured()) return false;
  if (!to) return false;
  try {
    await client.messages.create({
      from: fromNumber,
      to,
      body,
    });
    return true;
  } catch (error) {
    console.error("Twilio sendSms failed:", error.message);
    return false;
  }
};

export const broadcastNotification = async (message) => {
  if (!isTwilioConfigured() || notifyNumbers.length === 0) return;
  await Promise.all(notifyNumbers.map((to) => sendSms(to, message)));
};
