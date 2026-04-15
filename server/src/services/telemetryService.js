import { Device } from "../models/Device.js";
import { SensorReading } from "../models/SensorReading.js";

const ADC_MAX = 4095;
const MAX_PUMP_RUNTIME_MS = 3 * 60 * 1000;

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const soilRawToPercent = (rawValue) => {
  const raw = toNumber(rawValue);
  if (raw === null) return null;
  // ESP32 ADC: higher raw usually means drier soil, so invert to moisture%.
  const percent = ((ADC_MAX - clamp(raw, 0, ADC_MAX)) / ADC_MAX) * 100;
  return Number(percent.toFixed(2));
};

export const saveTelemetry = async ({ deviceId, payload, source = "device" }) => {
  const linkedDevice = await Device.findOne({ deviceId });
  if (!linkedDevice) {
    throw new Error("Device not linked yet");
  }

  // Accept both backend-style keys and ESP32 firmware keys.
  const temperature = payload.temperature ?? payload.temp;
  const humidity = payload.humidity ?? payload.hum;
  const directSoilPercent = toNumber(payload.soilMoisture);
  const soilMoisture =
    directSoilPercent !== null && directSoilPercent >= 0 && directSoilPercent <= 100
      ? directSoilPercent
      : soilRawToPercent(payload.soil);
  const waterLevel = payload.waterLevel ?? payload.water;
  const rainDetected = Boolean(payload.rainDetected ?? payload.rain ?? payload.isRaining);
  let pumpState = payload.pumpState ?? payload.pump ?? linkedDevice.desiredPumpState;
  let pumpRuntimeGuardTriggered = false;
  let pumpRuntimeGuardMessage = "";
  let rainLockTriggered = false;
  let rainLockMessage = "";
  const rainWasActive = Boolean(linkedDevice.rainLockActive);
  let pumpStateChanged = false;

  linkedDevice.rainLockActive = rainDetected;
  if (rainDetected) {
    linkedDevice.desiredPumpState = false;
    linkedDevice.pumpOnSince = null;
    pumpState = false;
    if (!rainWasActive) {
      rainLockTriggered = true;
      rainLockMessage = "Rain detected: pump locked OFF until rain stops.";
    }
  }

  if (pumpState && !rainDetected) {
    const now = new Date();
    const startedAt = linkedDevice.pumpOnSince ? new Date(linkedDevice.pumpOnSince) : now;
    if (!linkedDevice.pumpOnSince) {
      linkedDevice.pumpOnSince = startedAt;
    }
    if (now.getTime() - startedAt.getTime() > MAX_PUMP_RUNTIME_MS) {
      linkedDevice.desiredPumpState = false;
      linkedDevice.killSwitchActive = true;
      linkedDevice.pumpOnSince = null;
      pumpRuntimeGuardTriggered = true;
      pumpRuntimeGuardMessage =
        "Pump safety stop triggered: runtime exceeded 3 minutes. Kill switch enabled.";
    }
  } else {
    linkedDevice.pumpOnSince = null;
  }

  const reading = await SensorReading.create({
    deviceId,
    temperature,
    humidity,
    soilMoisture,
    waterLevel,
    rainDetected,
    pumpState,
    batteryVoltage: payload.batteryVoltage,
    solarVoltage: payload.solarVoltage,
    source,
  });

  const previousPumpState =
    typeof linkedDevice.lastPumpState === "boolean" ? linkedDevice.lastPumpState : null;
  if (previousPumpState === null || previousPumpState !== Boolean(pumpState)) {
    pumpStateChanged = true;
    linkedDevice.lastPumpState = Boolean(pumpState);
  }

  linkedDevice.lastSeenAt = new Date();
  await linkedDevice.save();

  return {
    reading,
    desiredPumpState: linkedDevice.desiredPumpState,
    killSwitchActive: linkedDevice.killSwitchActive,
    rainLockActive: linkedDevice.rainLockActive,
    rainLockTriggered,
    rainLockMessage,
    pumpStateChanged,
    pumpState: Boolean(pumpState),
    pumpRuntimeGuardTriggered,
    pumpRuntimeGuardMessage,
  };
};
