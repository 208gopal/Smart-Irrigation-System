import mqtt from "mqtt";
import { saveTelemetry } from "./telemetryService.js";

let mqttClient = null;

const topicPrefix = () => process.env.MQTT_TOPIC_PREFIX || "smart-irrigation";
const telemetryTopic = () => `${topicPrefix()}/+/telemetry`;
const pumpCommandTopic = (deviceId) => `${topicPrefix()}/${deviceId}/pump/set`;

const parseDeviceIdFromTopic = (topic) => {
  const parts = topic.split("/");
  if (parts.length < 3) return null;
  return parts[1];
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
    mqttClient.subscribe(telemetryTopic(), (err) => {
      if (err) {
        console.error("MQTT subscribe failed:", err.message);
      } else {
        console.log(`MQTT subscribed: ${telemetryTopic()}`);
      }
    });
  });

  mqttClient.on("message", async (topic, messageBuffer) => {
    try {
      const deviceId = parseDeviceIdFromTopic(topic);
      if (!deviceId || !topic.endsWith("/telemetry")) return;
      const payload = JSON.parse(messageBuffer.toString());
      const result = await saveTelemetry({ deviceId, payload, source: "device" });
      publishPumpCommand(deviceId, result.desiredPumpState);
    } catch (error) {
      console.error("MQTT telemetry handling error:", error.message);
    }
  });

  mqttClient.on("error", (error) => {
    console.error("MQTT error:", error.message);
  });
};

export const publishPumpCommand = (deviceId, on) => {
  if (!mqttClient || !mqttClient.connected) return false;
  mqttClient.publish(pumpCommandTopic(deviceId), JSON.stringify({ on: Boolean(on) }), { qos: 1 });
  return true;
};
