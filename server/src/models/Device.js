import mongoose from "mongoose";

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    label: { type: String, default: "My Field Device", trim: true },
    desiredPumpState: { type: Boolean, default: false },
    lastPumpState: { type: Boolean, default: null },
    killSwitchActive: { type: Boolean, default: false },
    rainLockActive: { type: Boolean, default: false },
    soilMoistureThreshold: { type: Number, default: 35, min: 0, max: 100 },
    waterLevelThreshold: { type: Number, default: 20, min: 0, max: 100 },
    pumpOnSince: { type: Date, default: null },
    lastSeenAt: { type: Date },
  },
  { timestamps: true }
);

export const Device = mongoose.model("Device", deviceSchema);
