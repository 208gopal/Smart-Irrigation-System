import { Device } from "../models/Device.js";
import { SensorReading } from "../models/SensorReading.js";

export const saveTelemetry = async ({ deviceId, payload, source = "device" }) => {
  const linkedDevice = await Device.findOne({ deviceId });
  if (!linkedDevice) {
    throw new Error("Device not linked yet");
  }

  // Accept both backend-style keys and ESP32 firmware keys.
  const temperature = payload.temperature ?? payload.temp;
  const humidity = payload.humidity ?? payload.hum;
  const soilMoisture = payload.soilMoisture ?? payload.soil;
  const waterLevel = payload.waterLevel ?? payload.water;
  const pumpState = payload.pumpState ?? payload.pump ?? linkedDevice.desiredPumpState;

  const reading = await SensorReading.create({
    deviceId,
    temperature,
    humidity,
    soilMoisture,
    waterLevel,
    pumpState,
    batteryVoltage: payload.batteryVoltage,
    solarVoltage: payload.solarVoltage,
    source,
  });

  linkedDevice.lastSeenAt = new Date();
  await linkedDevice.save();

  return { reading, desiredPumpState: linkedDevice.desiredPumpState };
};
