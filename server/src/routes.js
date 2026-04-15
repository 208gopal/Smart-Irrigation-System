import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "./models/User.js";
import { Device } from "./models/Device.js";
import { SensorReading } from "./models/SensorReading.js";
import { authRequired } from "./middleware/auth.js";
import { recommendSeeds } from "./services/recommendationService.js";
import { publishPumpCommand } from "./services/mqttService.js";
import { saveTelemetry } from "./services/telemetryService.js";
import {
  broadcastNotification,
  isSenderAllowed,
  parseTwilioCommand,
  twimlResponse,
} from "./services/twilioService.js";

export const router = express.Router();

const createToken = (user) =>
  jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

const allowedDeviceIds = () =>
  (process.env.HARDWARE_DEVICE_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const defaultTwilioDeviceId = () =>
  String(process.env.TWILIO_CONTROL_DEVICE_ID || "").trim() ||
  allowedDeviceIds()[0] ||
  "";

const commandHelpText = () =>
  [
    "Smart Irrigation Controls",
    "",
    "Available commands:",
    "• pump on  - turn pump ON manually",
    "• auto     - return to AUTO mode",
    "• kill     - emergency stop (kill switch ON)",
    "• getinfo  - latest device telemetry",
    "",
    "Tip: send one command per message.",
  ].join("\n");

router.get("/health", (_req, res) => res.json({ ok: true }));

router.post("/auth/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "name, email and password are required" });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password: hash });
  const token = createToken(user);
  return res.status(201).json({ token, user: { id: user._id, name, email } });
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const token = createToken(user);
  return res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
});

router.get("/devices/my", authRequired, async (req, res) => {
  const devices = await Device.find({ userId: req.user.id }).sort({ createdAt: -1 });
  return res.json(devices);
});

router.post("/devices/link", authRequired, async (req, res) => {
  const { deviceId, label } = req.body;
  const requestedDeviceId = String(deviceId || "").trim();
  if (!requestedDeviceId) {
    return res.status(400).json({ message: "deviceId is required" });
  }

  const provisionedIds = allowedDeviceIds();
  const matchedProvisionedId = provisionedIds.find(
    (id) => id.toLowerCase() === requestedDeviceId.toLowerCase()
  );
  if (!matchedProvisionedId) {
    return res.status(400).json({
      message: "Invalid deviceId. Not provisioned in hardware list.",
      allowedDeviceIds: provisionedIds,
    });
  }

  const normalizedDeviceId = matchedProvisionedId;
  const existing = await Device.findOne({ deviceId: normalizedDeviceId });
  if (existing) {
    if (String(existing.userId) !== req.user.id) {
      return res.status(409).json({ message: "This device is already linked to another user" });
    }
    return res.json(existing);
  }

  const device = await Device.create({
    deviceId: normalizedDeviceId,
    userId: req.user.id,
    label: label || `Farm Unit ${normalizedDeviceId}`,
  });
  return res.status(201).json(device);
});

router.get("/devices/:deviceId/latest", authRequired, async (req, res) => {
  const { deviceId } = req.params;
  const device = await Device.findOne({ deviceId, userId: req.user.id });
  if (!device) {
    return res.status(404).json({ message: "Device not found" });
  }
  const latest = await SensorReading.findOne({ deviceId }).sort({ createdAt: -1 });
  return res.json({ device, latest });
});

router.post("/control/:deviceId/pump", authRequired, async (req, res) => {
  const { deviceId } = req.params;
  const { on } = req.body;
  const device = await Device.findOne({ deviceId, userId: req.user.id });
  if (!device) {
    return res.status(404).json({ message: "Device not found" });
  }
  if (typeof on !== "boolean") {
    return res.status(400).json({ message: "on must be true or false" });
  }

  device.desiredPumpState = on;
  await device.save();
  await SensorReading.create({ deviceId, pumpState: on, source: "manual" });
  console.log(`[CONTROL] Pump request for ${deviceId}: on=${on}`);
  const mqttPublished = publishPumpCommand(deviceId, on, { withRetry: true });
  await broadcastNotification(`Pump command for ${deviceId}: ${on ? "ON" : "AUTO/OFF"}`);

  return res.json({
    message: `Pump turned ${on ? "ON" : "OFF"}`,
    desiredPumpState: on,
    mqttPublished,
  });
});

router.post("/control/:deviceId/kill", authRequired, async (req, res) => {
  const { deviceId } = req.params;
  const { enabled } = req.body;
  const device = await Device.findOne({ deviceId, userId: req.user.id });
  if (!device) {
    return res.status(404).json({ message: "Device not found" });
  }
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ message: "enabled must be true or false" });
  }

  device.killSwitchActive = enabled;
  if (enabled) {
    // Keep pump desired state false while kill switch is active.
    device.desiredPumpState = false;
  }
  await device.save();
  console.log(`[CONTROL] Kill request for ${deviceId}: enabled=${enabled}`);
  publishPumpCommand(deviceId, false, { killSwitchActive: enabled, withRetry: true });
  await broadcastNotification(
    `Kill switch for ${deviceId}: ${enabled ? "ENABLED" : "DISABLED"}`
  );

  return res.json({
    message: enabled
      ? "Kill switch enabled. Device will shut down on next telemetry cycle."
      : "Kill switch disabled.",
    killSwitchActive: device.killSwitchActive,
  });
});

router.post("/devices/:deviceId/telemetry", async (req, res) => {
  const ingestSecret = req.headers["x-device-secret"];
  if (!ingestSecret || ingestSecret !== process.env.DEVICE_INGEST_SECRET) {
    return res.status(401).json({ message: "Unauthorized hardware request" });
  }
  const { deviceId } = req.params;
  try {
    const { reading, desiredPumpState } = await saveTelemetry({
      deviceId,
      payload: req.body,
      source: "device",
    });
    const device = await Device.findOne({ deviceId });
    const killSwitchActive = Boolean(device?.killSwitchActive);

    return res.status(201).json({
      message: "Telemetry stored",
      desiredPumpState: killSwitchActive ? false : desiredPumpState,
      killSwitchActive,
      reading,
    });
  } catch (error) {
    if (error.message === "Device not linked yet") {
      return res.status(404).json({ message: error.message });
    }
    throw error;
  }
});

router.post("/twilio/webhook", express.urlencoded({ extended: false }), async (req, res) => {
  const from = String(req.body?.From || "").trim();
  const body = String(req.body?.Body || "");
  if (!isSenderAllowed(from)) {
    res.type("text/xml");
    return res.send(twimlResponse("Unauthorized number."));
  }

  const deviceId = defaultTwilioDeviceId();
  if (!deviceId) {
    res.type("text/xml");
    return res.send(twimlResponse("No device configured. Set TWILIO_CONTROL_DEVICE_ID."));
  }

  const device = await Device.findOne({ deviceId });
  if (!device) {
    res.type("text/xml");
    return res.send(twimlResponse(`Device ${deviceId} not found.`));
  }

  const command = parseTwilioCommand(body);
  let message = "";

  if (command.action === "pump_on") {
    device.desiredPumpState = true;
    device.killSwitchActive = false;
    await device.save();
    publishPumpCommand(deviceId, true, { withRetry: true });
    await SensorReading.create({ deviceId, pumpState: true, source: "manual" });
    message = [
      "Pump turned ON",
      `Device: ${deviceId}`,
      "Mode: Manual",
      "",
      "Use 'auto' to return control to automation.",
    ].join("\n");
    await broadcastNotification(`SMS command: Pump ON for ${deviceId}`);
  } else if (command.action === "auto") {
    device.desiredPumpState = false;
    device.killSwitchActive = false;
    await device.save();
    publishPumpCommand(deviceId, false, { withRetry: true });
    await SensorReading.create({ deviceId, pumpState: false, source: "manual" });
    message = ["AUTO mode enabled", `Device: ${deviceId}`, "Pump control returned to automation."].join(
      "\n"
    );
    await broadcastNotification(`SMS command: AUTO mode for ${deviceId}`);
  } else if (command.action === "kill") {
    device.killSwitchActive = true;
    device.desiredPumpState = false;
    await device.save();
    publishPumpCommand(deviceId, false, { killSwitchActive: true, withRetry: true });
    message = [
      "Emergency stop enabled",
      `Device: ${deviceId}`,
      "Kill switch: ON",
      "",
      "Pump is forced OFF until kill switch is disabled from app/API.",
    ].join("\n");
    await broadcastNotification(`SMS command: KILL enabled for ${deviceId}`);
  } else if (command.action === "get_info") {
    const latest = await SensorReading.findOne({ deviceId }).sort({ createdAt: -1 });
    if (!latest) {
      message = ["Device status", `Device: ${deviceId}`, "", "No telemetry available yet."].join("\n");
    } else {
      message =
        [
          "Device status",
          `Device: ${deviceId}`,
          "",
          `Temp: ${latest.temperature ?? "--"} C`,
          `Humidity: ${latest.humidity ?? "--"} %`,
          `Soil moisture: ${latest.soilMoisture ?? "--"}`,
          `Water level: ${latest.waterLevel ?? "--"}`,
          `Pump: ${latest.pumpState ? "ON" : "OFF"}`,
          `Kill switch: ${device.killSwitchActive ? "ON" : "OFF"}`,
        ].join("\n");
    }
  } else if (command.action === "help") {
    message = commandHelpText();
  } else {
    message = ["I did not understand that command.", "", commandHelpText()].join("\n");
  }

  res.type("text/xml");
  return res.send(twimlResponse(message));
});

router.get("/recommendation/:deviceId", authRequired, async (req, res) => {
  const { deviceId } = req.params;
  const device = await Device.findOne({ deviceId, userId: req.user.id });
  if (!device) {
    return res.status(404).json({ message: "Device not found" });
  }
  const latest = await SensorReading.findOne({ deviceId }).sort({ createdAt: -1 });
  if (!latest) {
    return res.status(404).json({ message: "No sensor data available for recommendation" });
  }

  const recommendations = recommendSeeds({
    temperature: latest.temperature,
    humidity: latest.humidity,
    soilMoisture: latest.soilMoisture,
  });

  return res.json({
    input: {
      temperature: latest.temperature,
      humidity: latest.humidity,
      soilMoisture: latest.soilMoisture,
    },
    recommendations,
  });
});

/** OpenStreetMap Nominatim — use responsibly (debounce client; ~1 req/s guidance). */
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  "SmartIrrigationDashboard/1.0 (farm dashboard; contact via project maintainer)";

router.get("/places/search", authRequired, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) {
    return res.json({ results: [] });
  }

  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q,
    format: "json",
    addressdetails: "0",
    limit: "8",
  })}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "en",
      },
    });
    if (!response.ok) {
      return res.status(502).json({ message: "Place search failed", results: [] });
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) {
      return res.json({ results: [] });
    }
    const results = rows
      .map((row) => ({
        id: String(row.place_id),
        label: row.display_name,
        lat: Number.parseFloat(row.lat),
        lon: Number.parseFloat(row.lon),
      }))
      .filter((r) => r.id && Number.isFinite(r.lat) && Number.isFinite(r.lon));

    return res.json({ results });
  } catch {
    return res.status(502).json({ message: "Place search unavailable", results: [] });
  }
});

function parseCoord(value) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

async function resolveForecastCoords(req) {
  const queryLat = parseCoord(req.query.lat);
  const queryLon = parseCoord(req.query.lon);
  if (queryLat !== null && queryLon !== null) {
    return { lat: queryLat, lon: queryLon };
  }

  const envLat = parseCoord(process.env.OPENWEATHER_LAT);
  const envLon = parseCoord(process.env.OPENWEATHER_LON);
  if (envLat !== null && envLon !== null) {
    return { lat: envLat, lon: envLon };
  }

  const city = String(req.query.city || process.env.OPENWEATHER_CITY || "").trim();
  if (!city) {
    return null;
  }

  const geocodeUrl = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: city,
    format: "json",
    addressdetails: "0",
    limit: "1",
  })}`;
  const geocodeResponse = await fetch(geocodeUrl, {
    headers: {
      "User-Agent": NOMINATIM_USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en",
    },
  });
  if (!geocodeResponse.ok) {
    return null;
  }
  const rows = await geocodeResponse.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  const lat = parseCoord(rows[0].lat);
  const lon = parseCoord(rows[0].lon);
  if (lat === null || lon === null) {
    return null;
  }
  return { lat, lon };
}

async function sendOpenWeather(req, res) {
  const apiKey = (process.env.OPENWEATHER_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(503).json({ message: "OpenWeather API key is not configured" });
  }

  const units = process.env.OPENWEATHER_UNITS || "metric";
  const requestCity = String(req.query.city || "").trim();
  const queryLat = req.query.lat;
  const queryLon = req.query.lon;
  const lat = queryLat || process.env.OPENWEATHER_LAT;
  const lon = queryLon || process.env.OPENWEATHER_LON;
  const cityEnv = process.env.OPENWEATHER_CITY;

  let url;
  if (requestCity) {
    url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
      requestCity
    )}&appid=${encodeURIComponent(apiKey)}&units=${encodeURIComponent(units)}`;
  } else if (lat && lon) {
    url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lon)}&appid=${encodeURIComponent(apiKey)}&units=${encodeURIComponent(
      units
    )}`;
  } else if (cityEnv) {
    url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
      cityEnv
    )}&appid=${encodeURIComponent(apiKey)}&units=${encodeURIComponent(units)}`;
  } else {
    return res.status(503).json({
      message: "Set OPENWEATHER_LAT/OPENWEATHER_LON or OPENWEATHER_CITY in .env",
    });
  }

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    return res
      .status(502)
      .json({ message: "Failed to fetch weather data from OpenWeather", details: text });
  }

  const data = await response.json();
  return res.json({
    location: data.name,
    description: data.weather?.[0]?.description || "N/A",
    icon: data.weather?.[0]?.icon || null,
    temperature: data.main?.temp,
    feelsLike: data.main?.feels_like,
    humidity: data.main?.humidity,
    windSpeed: data.wind?.speed,
    pressure: data.main?.pressure,
    visibility: data.visibility,
    units,
    fetchedAt: new Date().toISOString(),
  });
}

async function sendWeeklyForecast(req, res) {
  const units = process.env.OPENWEATHER_UNITS || "metric";
  const forecastTempUnit = units === "imperial" ? "fahrenheit" : "celsius";
  const forecastWindUnit = units === "imperial" ? "mph" : "ms";
  const coords = await resolveForecastCoords(req);
  if (!coords) {
    return res.status(503).json({
      message: "Select a valid place, share browser location, or set OPENWEATHER_LAT/OPENWEATHER_LON.",
    });
  }

  const forecastUrl = `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lon),
    timezone: "auto",
    forecast_days: "7",
    daily: "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    hourly: "temperature_2m,relative_humidity_2m,precipitation_probability,weathercode,windspeed_10m",
    temperature_unit: forecastTempUnit,
    windspeed_unit: forecastWindUnit,
  })}`;

  const response = await fetch(forecastUrl);
  if (!response.ok) {
    const text = await response.text();
    return res.status(502).json({ message: "Failed to fetch weekly forecast", details: text });
  }

  const data = await response.json();
  const daily = data.daily || {};
  const hourly = data.hourly || {};
  const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
  const hourlyTimes = Array.isArray(hourly.time) ? hourly.time : [];

  const dailySummaries = dailyTimes.map((date, i) => ({
    date,
    tempMax: daily.temperature_2m_max?.[i],
    tempMin: daily.temperature_2m_min?.[i],
    precipitationProbabilityMax: daily.precipitation_probability_max?.[i],
    weatherCode: daily.weathercode?.[i],
    sunrise: daily.sunrise?.[i],
    sunset: daily.sunset?.[i],
  }));

  const hourlyByDay = dailyTimes.map((date) => {
    const slots = [];
    for (let i = 0; i < hourlyTimes.length; i += 1) {
      if (!String(hourlyTimes[i]).startsWith(`${date}T`)) continue;
      slots.push({
        time: hourly.time?.[i],
        temperature: hourly.temperature_2m?.[i],
        humidity: hourly.relative_humidity_2m?.[i],
        precipitationProbability: hourly.precipitation_probability?.[i],
        weatherCode: hourly.weathercode?.[i],
        windSpeed: hourly.windspeed_10m?.[i],
      });
    }
    return { date, slots };
  });

  return res.json({
    timezone: data.timezone,
    latitude: data.latitude,
    longitude: data.longitude,
    units: {
      temperature: data.daily_units?.temperature_2m_max || (units === "imperial" ? "°F" : "°C"),
      windSpeed: data.hourly_units?.windspeed_10m || (units === "imperial" ? "mph" : "m/s"),
      precipitationProbability: "%",
      humidity: "%",
    },
    daily: dailySummaries,
    hourlyByDay,
    fetchedAt: new Date().toISOString(),
  });
}

/** Must be registered before /weather/:deviceId so "me" is not captured as a device id. */
router.get("/weather/me", authRequired, (req, res) => sendOpenWeather(req, res));
router.get("/weather/forecast/me", authRequired, (req, res) => sendWeeklyForecast(req, res));

router.get("/weather/forecast/:deviceId", authRequired, async (req, res) => {
  const { deviceId } = req.params;
  const device = await Device.findOne({ deviceId, userId: req.user.id });
  if (!device) {
    return res.status(404).json({ message: "Device not found" });
  }
  return sendWeeklyForecast(req, res);
});

router.get("/weather/:deviceId", authRequired, async (req, res) => {
  const { deviceId } = req.params;
  const device = await Device.findOne({ deviceId, userId: req.user.id });
  if (!device) {
    return res.status(404).json({ message: "Device not found" });
  }
  return sendOpenWeather(req, res);
});
