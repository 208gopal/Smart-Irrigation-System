import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODEL_DATASET_PATH = path.resolve(
  __dirname,
  "../../../Crop-Recommendation-System-Using-Machine-Learning-main/Crop_recommendation.csv"
);

const FEATURE_KEYS = ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"];
const TOP_NEIGHBORS_PER_LABEL = 7;
const FALLBACK_RECOMMENDATIONS = [
  {
    seed: "Rice",
    score: 78,
    reason: "Dataset unavailable, using fallback profile for warm and humid conditions.",
  },
  {
    seed: "Maize",
    score: 73,
    reason: "Dataset unavailable, using fallback profile for balanced temperature and moisture.",
  },
  {
    seed: "Wheat",
    score: 69,
    reason: "Dataset unavailable, using fallback profile for moderate climate.",
  },
];

const toNum = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const titleCase = (value) =>
  String(value || "")
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");

function loadDataset() {
  try {
    const csv = fs.readFileSync(MODEL_DATASET_PATH, "utf8");
    const lines = csv.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i].split(",");
      if (parts.length < 8) continue;
      const row = {
        N: toNum(parts[0]),
        P: toNum(parts[1]),
        K: toNum(parts[2]),
        temperature: toNum(parts[3]),
        humidity: toNum(parts[4]),
        ph: toNum(parts[5]),
        rainfall: toNum(parts[6]),
        label: String(parts[7] || "").trim(),
      };
      if (!row.label) continue;
      if (FEATURE_KEYS.some((key) => row[key] === null)) continue;
      rows.push(row);
    }
    if (rows.length === 0) return null;

    const stats = FEATURE_KEYS.reduce((acc, key) => {
      const values = rows.map((row) => row[key]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      acc[key] = { min, max, mean };
      return acc;
    }, {});

    return { rows, stats };
  } catch (error) {
    console.warn("Crop dataset could not be loaded:", error.message);
    return null;
  }
}

const dataset = loadDataset();

const normalize = (key, value) => {
  const stat = dataset?.stats?.[key];
  if (!stat) return 0;
  const spread = stat.max - stat.min || 1;
  return (value - stat.min) / spread;
};

const deriveRainfallFromSoilMoisture = (soilMoisture) => {
  if (soilMoisture === null || !dataset?.stats?.rainfall) return null;
  const soil = Math.max(0, Math.min(100, soilMoisture));
  const { min, max } = dataset.stats.rainfall;
  return min + ((max - min) * soil) / 100;
};

const resolveFeatures = (input) => {
  if (!dataset) return null;
  const resolved = {
    N: toNum(input.nitrogen ?? process.env.CROP_INPUT_N ?? dataset.stats.N.mean),
    P: toNum(input.phosphorus ?? process.env.CROP_INPUT_P ?? dataset.stats.P.mean),
    K: toNum(input.potassium ?? process.env.CROP_INPUT_K ?? dataset.stats.K.mean),
    temperature: toNum(input.temperature ?? dataset.stats.temperature.mean),
    humidity: toNum(input.humidity ?? dataset.stats.humidity.mean),
    ph: toNum(input.ph ?? process.env.CROP_INPUT_PH ?? dataset.stats.ph.mean),
    rainfall: toNum(input.rainfall ?? process.env.CROP_INPUT_RAINFALL),
  };

  if (resolved.rainfall === null) {
    resolved.rainfall = deriveRainfallFromSoilMoisture(toNum(input.soilMoisture));
  }
  if (resolved.rainfall === null) {
    resolved.rainfall = dataset.stats.rainfall.mean;
  }

  for (const key of FEATURE_KEYS) {
    if (resolved[key] === null) return null;
  }
  return resolved;
};

export const recommendSeeds = (input) => {
  if (!dataset) return FALLBACK_RECOMMENDATIONS;

  const features = resolveFeatures(input || {});
  if (!features) return FALLBACK_RECOMMENDATIONS;

  const query = FEATURE_KEYS.reduce((acc, key) => {
    acc[key] = normalize(key, features[key]);
    return acc;
  }, {});

  const byLabel = new Map();
  for (const row of dataset.rows) {
    let squaredDistance = 0;
    for (const key of FEATURE_KEYS) {
      const delta = normalize(key, row[key]) - query[key];
      squaredDistance += delta * delta;
    }
    const distance = Math.sqrt(squaredDistance);
    if (!byLabel.has(row.label)) {
      byLabel.set(row.label, []);
    }
    byLabel.get(row.label).push(distance);
  }

  const recommendations = Array.from(byLabel.entries())
    .map(([label, distances]) => {
      const nearest = distances.sort((a, b) => a - b).slice(0, TOP_NEIGHBORS_PER_LABEL);
      const avgDistance = nearest.reduce((sum, value) => sum + value, 0) / nearest.length;
      const score = Math.max(0, 100 - avgDistance * 100);
      return {
        seed: titleCase(label),
        score: Number(score.toFixed(2)),
        reason: `Matched ML dataset for temp ${features.temperature.toFixed(
          1
        )} C, humidity ${features.humidity.toFixed(1)} %, and rainfall ${features.rainfall.toFixed(
          1
        )} mm.`,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return recommendations.length > 0 ? recommendations : FALLBACK_RECOMMENDATIONS;
};
