const cropProfiles = [
  { seed: "Tomato", temp: [20, 30], humidity: [55, 75], soilMoisture: [45, 70] },
  { seed: "Wheat", temp: [12, 25], humidity: [45, 60], soilMoisture: [35, 55] },
  { seed: "Rice", temp: [22, 35], humidity: [70, 90], soilMoisture: [65, 90] },
  { seed: "Maize", temp: [18, 32], humidity: [50, 70], soilMoisture: [40, 60] },
  { seed: "Chili", temp: [20, 32], humidity: [45, 65], soilMoisture: [40, 55] },
];

const scoreInRange = (value, [min, max]) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return 0;
  }
  const v = Number(value);
  if (v >= min && v <= max) {
    return 1;
  }
  const spread = max - min || 1;
  const distance = v < min ? min - v : v - max;
  return Math.max(0, 1 - distance / spread);
};

export const recommendSeeds = ({ temperature, humidity, soilMoisture }) => {
  return cropProfiles
    .map((profile) => {
      const t = scoreInRange(temperature, profile.temp);
      const h = scoreInRange(humidity, profile.humidity);
      const s = scoreInRange(soilMoisture, profile.soilMoisture);
      const score = (t * 0.4 + h * 0.3 + s * 0.3) * 100;
      return {
        seed: profile.seed,
        score: Number(score.toFixed(2)),
        reason: `Best at ${profile.temp[0]}-${profile.temp[1]} C and humidity ${profile.humidity[0]}-${profile.humidity[1]}%.`,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};
