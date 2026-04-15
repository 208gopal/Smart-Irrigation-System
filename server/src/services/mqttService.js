import mqtt from "mqtt";
import { saveTelemetry } from "./telemetryService.js";

let mqttClient = null;
const pendingCommands = new Map();

const topicPrefix = () => process.env.MQTT_TOPIC_PREFIX || "smart-irrigation";
const telemetryTopics = () => [`${topicPrefix()}/+/telemetry`, `${topicPrefix()}/+/data`];
const controlTopics = (deviceId) => [
  `${topicPrefix()}/${deviceId}/control`,
  `${topicPrefix()}/${deviceId}/pump/set`,
];

const parseDeviceIdFromTopic = (topic) => {
  const parts = topic.split("/");
  if (parts.length < 3) return null;
  return parts[1];
};

const buildControlPayload = (on, options = {}) => {
  const normalizedOn = Boolean(on);
  const normalizedKill = Boolean(options.killSwitchActive);
  return {
    // Keep payload minimal for constrained device parsers.
    pump: normalizedOn,
    kill: normalizedKill,
  };
};

const publishControlPayload = (deviceId, payload) => {
  if (!mqttClient || !mqttClient.connected) return false;
  const message = JSON.stringify(payload);
  controlTopics(deviceId).forEach((topic) => {
    // Use qos0 for widest compatibility with PubSubClient subscriptions.
    mqttClient.publish(topic, message, { qos: 0, retain: false }, (err) => {
      if (err) {
        console.error(`MQTT control publish failed (${topic}):`, err.message);
        return;
      }
      console.log(`[MQTT CONTROL] Published ${topic}: ${message}`);
    });
  });
  return true;
};

export const initMqtt = () => {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    console.log("MQTT disabled: MQTT_BROKER_URL not set");
    return;
  }

  mqttClient = mqtt.connect(brokerUrl, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 2000,
  });

  mqttClient.on("connect", () => {
    console.log("MQTT connected");
    const topics = telemetryTopics();
    mqttClient.subscribe(topics, (err) => {
      if (err) {
        console.error("MQTT subscribe failed:", err.message);
        return;
      }
      topics.forEach((topic) => console.log(`MQTT subscribed: ${topic}`));
    });

    // If a command was issued during a reconnect window, flush it immediately.
    pendingCommands.forEach((pending, deviceId) => {
      publishControlPayload(deviceId, pending.payload);
    });
  });

  mqttClient.on("message", async (topic, messageBuffer) => {
    try {
      const deviceId = parseDeviceIdFromTopic(topic);
      const isTelemetryTopic = topic.endsWith("/telemetry") || topic.endsWith("/data");
      if (!deviceId || !isTelemetryTopic) return;
      const payload = JSON.parse(messageBuffer.toString());
      await saveTelemetry({ deviceId, payload, source: "device" });
    } catch (error) {
      console.error("MQTT telemetry handling error:", error.message);
    }
  });

  mqttClient.on("error", (error) => {
    console.error("MQTT error:", error.message);
  });
};

export const publishPumpCommand = (deviceId, on, options = {}) => {
  const withRetry = Boolean(options.withRetry);
  const payload = buildControlPayload(on, options);
  pendingCommands.set(deviceId, { payload, sentAt: Date.now() });

  // Retry only for user-initiated control actions to avoid stale command races.
  const attemptDelays = withRetry ? [0, 300, 900] : [0];
  attemptDelays.forEach((delayMs) => {
    setTimeout(() => {
      publishControlPayload(deviceId, payload);
    }, delayMs);
  });

  // Keep latest command for reconnect fallback for a short window.
  setTimeout(() => {
    const pending = pendingCommands.get(deviceId);
    if (pending && pending.payload.pump === payload.pump && pending.payload.kill === payload.kill) {
      pendingCommands.delete(deviceId);
    }
  }, 10000);

  return Boolean(mqttClient && mqttClient.connected);
};
