import { Device } from "../models/Device.js";
import { SensorReading } from "../models/SensorReading.js";

export const saveTelemetry = async ({ deviceId, payload, source = "device" }) => {
  const linkedDevice = await Device.findOne({ deviceId });
  if (!linkedDevice) {
    throw new Error("Device not linked yet");
  }

  const reading = await SensorReading.create({
    deviceId,
    temperature: payload.temperature,
    humidity: payload.humidity,
    soilMoisture: payload.soilMoisture,
    waterLevel: payload.waterLevel,
    pumpState: payload.pumpState ?? linkedDevice.desiredPumpState,
    batteryVoltage: payload.batteryVoltage,
    solarVoltage: payload.solarVoltage,
    source,
  });

  linkedDevice.lastSeenAt = new Date();
  await linkedDevice.save();

  return { reading, desiredPumpState: linkedDevice.desiredPumpState };
};
