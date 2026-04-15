import twilio from "twilio";

const parseCsv = (value) =>
  String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

let cachedClient = null;
let cachedSid = "";
let cachedToken = "";
const recentBroadcasts = new Map();
const inFlightBroadcasts = new Set();
const DUPLICATE_WINDOW_MS = 15000;

const getTwilioRuntimeConfig = () => ({
  accountSid: String(process.env.TWILIO_ACCOUNT_SID || "").trim(),
  authToken: String(process.env.TWILIO_AUTH_TOKEN || "").trim(),
  fromNumber: String(process.env.TWILIO_PHONE_NUMBER || "").trim(),
  notifyNumbers: parseCsv(process.env.TWILIO_NOTIFY_TO),
  allowedSenders: new Set(parseCsv(process.env.TWILIO_ALLOWED_FROM)),
});

const getTwilioClient = (accountSid, authToken) => {
  if (!accountSid || !authToken) return null;

  if (!cachedClient || cachedSid !== accountSid || cachedToken !== authToken) {
    cachedSid = accountSid;
    cachedToken = authToken;
    cachedClient = twilio(accountSid, authToken);
  }

  return cachedClient;
};

export const isTwilioConfigured = () => {
  const { accountSid, authToken, fromNumber } = getTwilioRuntimeConfig();

  const ok = Boolean(getTwilioClient(accountSid, authToken) && fromNumber);

  if (!ok) {
    console.error("Twilio config missing:", {
      accountSid: !!accountSid,
      authToken: !!authToken,
      fromNumber: !!fromNumber,
    });
  }

  return ok;
};

export const isSenderAllowed = (from) => {
  const { allowedSenders } = getTwilioRuntimeConfig();

  if (!from) return false;
  if (allowedSenders.size === 0) return true;

  return allowedSenders.has(String(from).trim());
};

export const normalizeCommand = (value) =>
  String(value || "").trim().toLowerCase();

export const parseTwilioCommand = (rawText) => {
  const text = normalizeCommand(rawText);

  if (!text) return { action: "help" };
  if (text === "help" || text === "commands") return { action: "help" };
  if (text === "pump on" || text === "on") return { action: "pump_on" };
  if (text === "auto" || text === "pump auto" || text === "off")
    return { action: "auto" };
  if (text === "kill" || text === "pump kill")
    return { action: "kill" };
  if (
    text === "getinfo" ||
    text === "get info" ||
    text === "info" ||
    text === "status"
  ) {
    return { action: "get_info" };
  }

  return { action: "unknown" };
};

export const twimlResponse = (message) => {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
};

export const sendSms = async (to, body) => {
  const { accountSid, authToken, fromNumber } =
    getTwilioRuntimeConfig();

  const client = getTwilioClient(accountSid, authToken);

  if (!client || !fromNumber) {
    console.error("sendSms: Twilio not configured");
    return false;
  }

  if (!to) {
    console.error("sendSms: Missing recipient");
    return false;
  }

  try {
    const res = await client.messages.create({
      from: fromNumber,
      to,
      body,
    });

    console.log("SMS sent:", to, res.sid);
    return true;
  } catch (error) {
    console.error("Twilio sendSms failed:", to, error.message);
    return false;
  }
};

export const broadcastNotification = async (message) => {
  const { notifyNumbers } = getTwilioRuntimeConfig();

  if (!isTwilioConfigured()) {
    console.error("Broadcast skipped: Twilio not configured");
    return;
  }

  if (notifyNumbers.length === 0) {
    console.error("Broadcast skipped: No notify numbers");
    return;
  }

  const key = String(message || "").trim();

  if (!key) {
    console.error("Broadcast skipped: Empty message");
    return;
  }

  const now = Date.now();

  const lastSentAt = recentBroadcasts.get(key) || 0;
  if (now - lastSentAt < DUPLICATE_WINDOW_MS) {
    console.log("Duplicate broadcast skipped");
    return;
  }

  if (inFlightBroadcasts.has(key)) {
    console.log("Broadcast already in progress");
    return;
  }

  inFlightBroadcasts.add(key);

  // cleanup old entries
  recentBroadcasts.forEach((sentAt, msgKey) => {
    if (now - sentAt > DUPLICATE_WINDOW_MS * 4) {
      recentBroadcasts.delete(msgKey);
    }
  });

  try {
    console.log("Sending broadcast to:", notifyNumbers);

    const results = await Promise.all(
      notifyNumbers.map((to) => sendSms(to, message))
    );

    console.log("Broadcast results:", results);

    const deliveredCount = results.filter(Boolean).length;

    if (deliveredCount > 0) {
      recentBroadcasts.set(key, Date.now());
      console.log(`Delivered to ${deliveredCount} recipients`);
    } else {
      console.error("Broadcast failed: No messages delivered");
    }
  } finally {
    inFlightBroadcasts.delete(key);
  }
};