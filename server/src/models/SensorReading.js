import mongoose from "mongoose";

const sensorReadingSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    temperature: { type: Number },
    humidity: { type: Number },
    soilMoisture: { type: Number },
    waterLevel: { type: Number },
    rainDetected: { type: Boolean, default: false },
    pumpState: { type: Boolean, default: false },
    batteryVoltage: { type: Number },
    solarVoltage: { type: Number },
    source: { type: String, enum: ["device", "manual"], default: "device" },
  },
  { timestamps: true }
);

export const SensorReading = mongoose.model("SensorReading", sensorReadingSchema);
