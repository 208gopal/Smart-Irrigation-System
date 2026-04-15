import { useEffect, useState } from "react";
import api from "../api";

const WEATHER_SOURCE_KEY = "smart-irrigation-weather-source";
const WEATHER_PLACE_KEY = "smart-irrigation-weather-place";

function readStoredWeatherSource() {
  if (typeof window === "undefined") return "browser";
  return localStorage.getItem(WEATHER_SOURCE_KEY) === "custom" ? "custom" : "browser";
}

function readStoredPlace() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WEATHER_PLACE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (
      p &&
      typeof p.label === "string" &&
      typeof p.lat === "number" &&
      typeof p.lon === "number" &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon)
    ) {
      return { label: p.label, lat: p.lat, lon: p.lon };
    }
    return null;
  } catch {
    return null;
  }
}

function persistPlace(place) {
  if (place) {
    localStorage.setItem(WEATHER_PLACE_KEY, JSON.stringify(place));
  } else {
    localStorage.removeItem(WEATHER_PLACE_KEY);
  }
}

function weatherCodeLabel(code) {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code === 51 || code === 53 || code === 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code === 61 || code === 63 || code === 65) return "Rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code === 71 || code === 73 || code === 75) return "Snow";
  if (code === 77) return "Snow grains";
  if (code === 80 || code === 81 || code === 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm with hail";
  return "Unknown";
}

function dayLabel(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function hourLabel(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MiniLineChart({ points, color = "#10b981", min = 0, max = 100 }) {
  const width = 320;
  const height = 110;
  if (!Array.isArray(points) || points.length === 0) {
    return <div className="text-xs text-slate-500">No data yet.</div>;
  }

  const span = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * (width - 1);
      const normalized = (point.value - min) / span;
      const y = (1 - Math.max(0, Math.min(1, normalized))) * (height - 1);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28 rounded bg-stone-100 border border-stone-200">
      <polyline fill="none" stroke={color} strokeWidth="2.5" points={path} />
    </svg>
  );
}

export default function DashboardPage({ user, onLogout }) {
  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState("");
  const [deviceInput, setDeviceInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [latestByDevice, setLatestByDevice] = useState({});
  const [weather, setWeather] = useState(null);
  const [weatherError, setWeatherError] = useState("");
  const [message, setMessage] = useState("");
  const [locationCoords, setLocationCoords] = useState(null);
  /** Wait for getCurrentPosition before weather fetch so we don't 503 when .env has no location. */
  const [geoReady, setGeoReady] = useState(typeof navigator !== "undefined" && !navigator.geolocation);
  /** "browser" = GPS (default); "custom" = place picked from search */
  const [weatherSource, setWeatherSource] = useState(readStoredWeatherSource);
  const [selectedPlace, setSelectedPlace] = useState(readStoredPlace);
  const [placeSearch, setPlaceSearch] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState([]);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [weatherView, setWeatherView] = useState("current");
  const [forecast, setForecast] = useState(null);
  const [forecastError, setForecastError] = useState("");
  const [selectedForecastDate, setSelectedForecastDate] = useState("");
  const [analyticsByDevice, setAnalyticsByDevice] = useState({});
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const [mlInputs, setMlInputs] = useState({
    nitrogen: "",
    phosphorus: "",
    potassium: "",
    ph: "",
    rainfall: "",
  });

  const fetchDevices = async () => {
    const { data } = await api.get("/devices/my");
    setDevices(data);
    if (data.length && !activeDeviceId) {
      setActiveDeviceId(data[0].deviceId);
    }
  };

  const fetchLatestForDevices = async (targetDevices) => {
    if (!Array.isArray(targetDevices) || targetDevices.length === 0) {
      setLatestByDevice({});
      return;
    }

    const results = await Promise.all(
      targetDevices.map(async (device) => {
        try {
          const { data } = await api.get(`/devices/${device.deviceId}/latest`);
          return [device.deviceId, data.latest ?? null];
        } catch {
          return [device.deviceId, null];
        }
      })
    );

    const nextLatestByDevice = Object.fromEntries(results);
    setLatestByDevice(nextLatestByDevice);

    setAnalyticsByDevice((prev) => {
      const next = { ...prev };
      const now = Date.now();
      targetDevices.forEach((device) => {
        const latest = nextLatestByDevice[device.deviceId];
        if (!latest) return;
        const row = {
          ts: now,
          temperature: typeof latest.temperature === "number" ? latest.temperature : null,
          humidity: typeof latest.humidity === "number" ? latest.humidity : null,
          soilMoisture: typeof latest.soilMoisture === "number" ? latest.soilMoisture : null,
          waterLevel: typeof latest.waterLevel === "number" ? latest.waterLevel : null,
        };
        const existing = Array.isArray(next[device.deviceId]) ? next[device.deviceId] : [];
        const last = existing[existing.length - 1];
        if (
          last &&
          last.temperature === row.temperature &&
          last.humidity === row.humidity &&
          last.soilMoisture === row.soilMoisture &&
          last.waterLevel === row.waterLevel
        ) {
          return;
        }
        next[device.deviceId] = [...existing, row].slice(-30);
      });
      return next;
    });
  };

  const fetchWeather = async () => {
    if (weatherSource === "custom" && !selectedPlace) return;
    if (weatherSource === "browser" && !locationCoords) {
      setWeather(null);
      setWeatherError("Browser location unavailable. Allow location access or switch to Search a place.");
      return;
    }

    let params;
    if (weatherSource === "custom" && selectedPlace) {
      params = { lat: selectedPlace.lat, lon: selectedPlace.lon };
    } else if (locationCoords) {
      params = { lat: locationCoords.lat, lon: locationCoords.lon };
    } else {
      params = undefined;
    }

    try {
      const { data } = await api.get("/weather/me", { params });
      setWeather(data);
      setWeatherError("");
    } catch (err) {
      setWeather(null);
      const body = err.response?.data;
      const detail =
        typeof body?.details === "string" ? ` (${body.details.slice(0, 120)})` : "";
      const msg = body?.message || err.message || "Weather request failed";
      setWeatherError(msg + detail);
    }
  };

  const fetchForecast = async () => {
    if (weatherSource === "custom" && !selectedPlace) return;
    if (weatherSource === "browser" && !locationCoords) {
      setForecast(null);
      setForecastError("Browser location unavailable. Allow location access or switch to Search a place.");
      return;
    }

    let params;
    if (weatherSource === "custom" && selectedPlace) {
      params = { lat: selectedPlace.lat, lon: selectedPlace.lon };
    } else if (locationCoords) {
      params = { lat: locationCoords.lat, lon: locationCoords.lon };
    } else {
      params = undefined;
    }

    try {
      const { data } = await api.get("/weather/forecast/me", { params });
      setForecast(data);
      setForecastError("");
      if (!selectedForecastDate && Array.isArray(data.daily) && data.daily.length > 0) {
        setSelectedForecastDate(data.daily[0].date);
      }
    } catch (err) {
      setForecast(null);
      const body = err.response?.data;
      const detail = typeof body?.details === "string" ? ` (${body.details.slice(0, 120)})` : "";
      const msg = body?.message || err.message || "Forecast request failed";
      setForecastError(msg + detail);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationCoords({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        setGeoReady(true);
      },
      () => {
        setLocationCoords(null);
        setGeoReady(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  useEffect(() => {
    fetchLatestForDevices(devices);
    const timer = setInterval(() => fetchLatestForDevices(devices), 5000);
    return () => clearInterval(timer);
  }, [devices]);

  useEffect(() => {
    const customReady = weatherSource === "custom" && selectedPlace;
    const browserReady = weatherSource === "browser" && locationCoords;
    if (!customReady && !browserReady) return;

    fetchWeather();
    const timer = setInterval(() => fetchWeather(), 5000);
    return () => clearInterval(timer);
  }, [locationCoords, geoReady, weatherSource, selectedPlace]);

  useEffect(() => {
    const customReady = weatherSource === "custom" && selectedPlace;
    const browserReady = weatherSource === "browser" && locationCoords;
    if (!customReady && !browserReady) return;

    fetchForecast();
    const timer = setInterval(() => fetchForecast(), 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, [locationCoords, geoReady, weatherSource, selectedPlace]);

  useEffect(() => {
    if (weatherSource !== "custom" || selectedPlace) return;
    setWeather(null);
    setWeatherError("Search below and pick a place from the list (addresses & landmarks work).");
  }, [weatherSource, selectedPlace]);

  useEffect(() => {
    if (weatherSource !== "browser" || !geoReady || locationCoords) return;
    setWeather(null);
    setForecast(null);
    setWeatherError("Could not access browser location. Allow location permission or switch to Search a place.");
    setForecastError("Could not access browser location. Allow location permission or switch to Search a place.");
  }, [weatherSource, geoReady, locationCoords]);

  useEffect(() => {
    if (weatherSource !== "custom" || selectedPlace) {
      setPlaceSuggestions([]);
      return;
    }
    const q = placeSearch.trim();
    if (q.length < 2) {
      setPlaceSuggestions([]);
      return;
    }

    const handle = setTimeout(async () => {
      setPlaceSearchLoading(true);
      try {
        const { data } = await api.get("/places/search", { params: { q } });
        setPlaceSuggestions(Array.isArray(data.results) ? data.results : []);
      } catch {
        setPlaceSuggestions([]);
      } finally {
        setPlaceSearchLoading(false);
      }
    }, 400);

    return () => clearTimeout(handle);
  }, [placeSearch, weatherSource, selectedPlace]);

  useEffect(() => {
    if (!forecast || !Array.isArray(forecast.daily) || forecast.daily.length === 0) {
      setSelectedForecastDate("");
      return;
    }
    const stillExists = forecast.daily.some((d) => d.date === selectedForecastDate);
    if (!stillExists) {
      setSelectedForecastDate(forecast.daily[0].date);
    }
  }, [forecast, selectedForecastDate]);

  const linkDevice = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await api.post("/devices/link", { deviceId: deviceInput, label: labelInput });
      setDeviceInput("");
      setLabelInput("");
      await fetchDevices();
      setMessage("Device linked successfully");
    } catch (err) {
      setMessage(err.response?.data?.message || "Failed to link device");
    }
  };

  const togglePumpForDevice = async (deviceId, on) => {
    if (!deviceId) return;
    const { data } = await api.post(`/control/${deviceId}/pump`, { on });
    setMessage(data.message);
    fetchLatestForDevices(devices);
  };

  const setKillSwitch = async (deviceId, enabled) => {
    if (!deviceId) return;
    const { data } = await api.post(`/control/${deviceId}/kill`, { enabled });
    setMessage(data.message);
    await fetchDevices();
  };

  const pickPlace = (p) => {
    const place = { label: p.label, lat: p.lat, lon: p.lon };
    setSelectedPlace(place);
    persistPlace(place);
    setPlaceSearch("");
    setPlaceSuggestions([]);
  };

  const clearSelectedPlace = () => {
    setSelectedPlace(null);
    persistPlace(null);
    setPlaceSearch("");
    setPlaceSuggestions([]);
  };

  const fetchRecommendations = async (deviceId) => {
    if (!deviceId) return;
    setRecommendationLoading(true);
    setRecommendationError("");
    try {
      const params = {};
      Object.entries(mlInputs).forEach(([key, value]) => {
        const trimmed = String(value || "").trim();
        if (trimmed) params[key] = trimmed;
      });
      const { data } = await api.get(`/recommendation/${deviceId}`, { params });
      setRecommendations(Array.isArray(data?.recommendations) ? data.recommendations : []);
    } catch (err) {
      setRecommendations([]);
      setRecommendationError(err.response?.data?.message || "Failed to fetch crop recommendations");
    } finally {
      setRecommendationLoading(false);
    }
  };

  const onMlInputChange = (key, value) => {
    setMlInputs((prev) => ({ ...prev, [key]: value }));
  };

  const resetMlInputs = () => {
    setMlInputs({
      nitrogen: "",
      phosphorus: "",
      potassium: "",
      ph: "",
      rainfall: "",
    });
  };

  const selectedForecastDay = forecast?.daily?.find((d) => d.date === selectedForecastDate);
  const selectedForecastSlots =
    forecast?.hourlyByDay?.find((d) => d.date === selectedForecastDate)?.slots || [];
  const activeDeviceLatest = activeDeviceId ? latestByDevice[activeDeviceId] : null;
  const analyticsSeries = activeDeviceId ? analyticsByDevice[activeDeviceId] || [] : [];
  const tempPoints = analyticsSeries
    .filter((p) => typeof p.temperature === "number")
    .map((p) => ({ ts: p.ts, value: p.temperature }));
  const humidityPoints = analyticsSeries
    .filter((p) => typeof p.humidity === "number")
    .map((p) => ({ ts: p.ts, value: p.humidity }));
  const soilPoints = analyticsSeries
    .filter((p) => typeof p.soilMoisture === "number")
    .map((p) => ({ ts: p.ts, value: p.soilMoisture }));
  const waterPoints = analyticsSeries
    .filter((p) => typeof p.waterLevel === "number")
    .map((p) => ({ ts: p.ts, value: p.waterLevel }));

  return (
    <div className="min-h-screen bg-linear-to-br from-[#fdfbf6] via-[#f9f5ef] to-[#f5efe6] text-slate-800 p-6">
      {/* Topbar */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Welcome, {user?.name || "Farmer"}</h1>
        <button
          onClick={onLogout}
          className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition"
        >
          Logout
        </button>
      </div>

      {/* Link Device */}
      <div className="bg-[#fffdf8]/90 backdrop-blur-lg p-6 rounded-2xl mb-6 border border-stone-200 shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Link Device</h2>
        <form onSubmit={linkDevice} className="flex flex-col md:flex-row gap-3">
          <input
            className="flex-1 px-4 py-2 rounded-lg bg-white border border-stone-300 placeholder-stone-400"
            placeholder="Device ID"
            value={deviceInput}
            onChange={(e) => setDeviceInput(e.target.value)}
            required
          />
          <input
            className="flex-1 px-4 py-2 rounded-lg bg-white border border-stone-300 placeholder-stone-400"
            placeholder="Label"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
          />
          <button className="px-6 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800">
            Link
          </button>
        </form>
        {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
      </div>

      {/* Main Grid */}
      <div className="grid md:grid-cols-2 gap-6">

        {/* Devices */}
        <div className="bg-[#fffdf8]/90 p-5 rounded-2xl border border-stone-200 shadow-sm">
          <h3 className="font-semibold mb-3">My Devices</h3>
          {devices.map((d) => (
            <div
              key={d.deviceId}
              onClick={() => setActiveDeviceId(d.deviceId)}
              className={`text-left px-4 py-2 rounded-lg mb-2 transition cursor-pointer ${
                activeDeviceId === d.deviceId
                  ? "bg-emerald-100 border border-emerald-300"
                  : "bg-white border border-stone-200 hover:bg-stone-100"
              }`}
            >
              <div className="font-medium">{d.label}</div>
              <div className="text-xs text-slate-500">{d.deviceId}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                <div>Temp: {latestByDevice[d.deviceId]?.temperature ?? "--"}°C</div>
                <div>Humidity: {latestByDevice[d.deviceId]?.humidity ?? "--"}%</div>
                <div>Soil: {latestByDevice[d.deviceId]?.soilMoisture ?? "--"}%</div>
                <div>Water: {latestByDevice[d.deviceId]?.waterLevel ?? "--"}%</div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePumpForDevice(d.deviceId, true);
                  }}
                  className="flex-1 bg-emerald-700 text-white py-1 rounded text-xs hover:bg-emerald-800"
                >
                  ON
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePumpForDevice(d.deviceId, false);
                  }}
                  className="flex-1 bg-amber-700 text-white py-1 rounded text-xs hover:bg-amber-800"
                >
                  AUTO
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setKillSwitch(d.deviceId, !d.killSwitchActive);
                  }}
                  className={`px-2 py-1 rounded text-xs ${
                    d.killSwitchActive ? "bg-amber-600 text-white" : "bg-rose-700 text-white"
                  }`}
                >
                  {d.killSwitchActive ? "UN-KILL" : "KILL"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Weather Updates */}
        <div className="bg-[#fffdf8]/90 p-5 rounded-2xl border border-stone-200 shadow-sm">
          <h3 className="font-semibold mb-3">Weather Updates</h3>

          <div className="mb-3 flex flex-col gap-2 text-xs">
            <span className="text-slate-500">Location for forecast</span>
            <div className="flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="weatherSource"
                  className="accent-emerald-400"
                  checked={weatherSource === "browser"}
                  onChange={() => {
                    setWeatherSource("browser");
                    localStorage.setItem(WEATHER_SOURCE_KEY, "browser");
                  }}
                />
                <span>My location (browser)</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="weatherSource"
                  className="accent-emerald-400"
                  checked={weatherSource === "custom"}
                  onChange={() => {
                    setWeatherSource("custom");
                    localStorage.setItem(WEATHER_SOURCE_KEY, "custom");
                  }}
                />
                <span>Search a place</span>
              </label>
            </div>
            {weatherSource === "custom" ? (
              <div className="relative mt-1 space-y-2">
                {selectedPlace ? (
                  <div className="rounded-lg bg-white border border-stone-200 p-2 text-sm">
                    <p className="text-emerald-700 leading-snug line-clamp-3">{selectedPlace.label}</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {selectedPlace.lat.toFixed(4)}, {selectedPlace.lon.toFixed(4)}
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-xs text-emerald-700 hover:text-emerald-800 underline"
                      onClick={clearSelectedPlace}
                    >
                      Change place
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="search"
                      autoComplete="off"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-stone-300 placeholder-stone-400 text-sm"
                      placeholder="Street, farm, village, city, landmark…"
                      value={placeSearch}
                      onChange={(e) => setPlaceSearch(e.target.value)}
                      aria-autocomplete="list"
                      aria-expanded={placeSuggestions.length > 0}
                    />
                    {placeSearchLoading && (
                      <p className="text-[11px] text-slate-500">Searching…</p>
                    )}
                    {placeSuggestions.length > 0 && (
                      <ul
                        className="absolute z-20 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-lg border border-stone-300 bg-[#fffdf8] shadow-xl text-sm"
                        role="listbox"
                      >
                        {placeSuggestions.map((s) => (
                          <li key={s.id} role="option">
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-stone-100 border-b border-stone-200 last:border-0 leading-snug"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => pickPlace(s)}
                            >
                              {s.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Places via{" "}
                      <a
                        href="https://www.openstreetmap.org"
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 hover:underline"
                      >
                        OpenStreetMap
                      </a>{" "}
                      (same data many map apps use). Pick one result for a precise point.
                    </p>
                  </>
                )}
              </div>
            ) : !geoReady ? (
              <p className="text-slate-600">Detecting your location…</p>
            ) : locationCoords ? (
              <p className="text-slate-600">
                Using GPS:{" "}
                <span className="text-emerald-700">
                  {locationCoords.lat.toFixed(4)}, {locationCoords.lon.toFixed(4)}
                </span>
              </p>
            ) : (
              <p className="text-amber-700">
                No GPS — add a server fallback in <code className="text-slate-700">server/.env</code> or switch to
                Search a place.
              </p>
            )}
          </div>

          <div className="mb-3 inline-flex rounded-lg bg-stone-100 p-1 text-xs">
            <button
              type="button"
              className={`px-3 py-1 rounded-md ${weatherView === "current" ? "bg-emerald-700 text-white" : "hover:bg-stone-200"}`}
              onClick={() => setWeatherView("current")}
            >
              Current
            </button>
            <button
              type="button"
              className={`px-3 py-1 rounded-md ${weatherView === "weekly" ? "bg-emerald-700 text-white" : "hover:bg-stone-200"}`}
              onClick={() => setWeatherView("weekly")}
            >
              7-day planner
            </button>
          </div>

          {weatherView === "weekly" ? (
            !forecast ? (
              <p className="text-sm text-slate-600">
                {forecastError || "Loading weekly forecast..."}
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-slate-500">
                  Daily outlook with hourly slots ({forecast.timezone || "local time"}).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(forecast.daily || []).map((day) => (
                    <button
                      key={day.date}
                      type="button"
                      className={`text-left rounded-lg border px-2 py-2 ${
                        selectedForecastDate === day.date
                          ? "bg-emerald-100 border-emerald-300"
                          : "bg-white border-stone-200 hover:bg-stone-100"
                      }`}
                      onClick={() => setSelectedForecastDate(day.date)}
                    >
                      <div className="text-xs text-emerald-700">{dayLabel(day.date)}</div>
                      <div className="text-xs text-slate-600">{weatherCodeLabel(day.weatherCode)}</div>
                      <div className="text-xs">
                        {day.tempMax ?? "--"}{forecast.units?.temperature || ""} / {day.tempMin ?? "--"}{forecast.units?.temperature || ""}
                      </div>
                    </button>
                  ))}
                </div>

                {selectedForecastDay ? (
                  <div className="rounded-lg border border-stone-200 bg-white p-3">
                    <div className="text-emerald-700 font-medium">{dayLabel(selectedForecastDay.date)}</div>
                    <div className="text-xs text-slate-600">
                      Rain chance: {selectedForecastDay.precipitationProbabilityMax ?? "--"}{forecast.units?.precipitationProbability || "%"} | Sunrise:{" "}
                      {selectedForecastDay.sunrise ? hourLabel(selectedForecastDay.sunrise) : "--"} | Sunset:{" "}
                      {selectedForecastDay.sunset ? hourLabel(selectedForecastDay.sunset) : "--"}
                    </div>
                    <div className="mt-2 max-h-44 overflow-y-auto space-y-1 text-xs">
                      {selectedForecastSlots.length === 0 ? (
                        <p className="text-slate-500">No hourly slots available.</p>
                      ) : (
                        selectedForecastSlots.map((slot) => (
                          <div
                            key={slot.time}
                            className="flex justify-between rounded bg-stone-100 px-2 py-1"
                          >
                            <span>{hourLabel(slot.time)}</span>
                            <span>{weatherCodeLabel(slot.weatherCode)}</span>
                            <span>
                              {slot.temperature ?? "--"}{forecast.units?.temperature || ""}
                            </span>
                            <span>
                              {slot.precipitationProbability ?? "--"}{forecast.units?.precipitationProbability || "%"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {weatherView === "current" ? (
            !weather ? (
              <p className="text-sm text-slate-600">
                {weatherError ||
                  "Could not load weather yet. Ensure OPENWEATHER_API_KEY is set in server/.env and the API server was restarted."}
              </p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="text-emerald-700 font-medium">{weather.location || "Configured location"}</div>
                <div className="capitalize text-slate-700">{weather.description}</div>
                <div>Temperature: {weather.temperature ?? "--"}{weather.units === "metric" ? "°C" : "°F"}</div>
                <div>Feels Like: {weather.feelsLike ?? "--"}{weather.units === "metric" ? "°C" : "°F"}</div>
                <div>Humidity: {weather.humidity ?? "--"}%</div>
                <div>Wind Speed: {weather.windSpeed ?? "--"} {weather.units === "metric" ? "m/s" : "mph"}</div>
                <div>Pressure: {weather.pressure ?? "--"} hPa</div>
              </div>
            )
          ) : null}
        </div>

      </div>

      <div className="mt-6 bg-[#fffdf8]/90 p-5 rounded-2xl border border-stone-200 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold">Crop Recommendation (ML)</h3>
            <p className="text-xs text-slate-600">
              Device: <span className="text-emerald-700">{activeDeviceId || "No device selected"}</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Live used: Temp {activeDeviceLatest?.temperature ?? "--"} C, Humidity{" "}
              {activeDeviceLatest?.humidity ?? "--"} %, Soil Moisture {activeDeviceLatest?.soilMoisture ?? "--"} %
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fetchRecommendations(activeDeviceId)}
              disabled={!activeDeviceId || recommendationLoading}
              className="px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {recommendationLoading ? "Loading..." : "Get Recommendations"}
            </button>
            <button
              type="button"
              onClick={resetMlInputs}
              className="px-4 py-2 bg-stone-200 rounded-lg hover:bg-stone-300"
            >
              Clear ML Inputs
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-5 gap-2 mb-4">
          <input
            className="px-3 py-2 rounded-lg bg-white border border-stone-300 text-sm placeholder-stone-400"
            placeholder="Nitrogen (N)"
            value={mlInputs.nitrogen}
            onChange={(e) => onMlInputChange("nitrogen", e.target.value)}
          />
          <input
            className="px-3 py-2 rounded-lg bg-white border border-stone-300 text-sm placeholder-stone-400"
            placeholder="Phosphorus (P)"
            value={mlInputs.phosphorus}
            onChange={(e) => onMlInputChange("phosphorus", e.target.value)}
          />
          <input
            className="px-3 py-2 rounded-lg bg-white border border-stone-300 text-sm placeholder-stone-400"
            placeholder="Potassium (K)"
            value={mlInputs.potassium}
            onChange={(e) => onMlInputChange("potassium", e.target.value)}
          />
          <input
            className="px-3 py-2 rounded-lg bg-white border border-stone-300 text-sm placeholder-stone-400"
            placeholder="pH"
            value={mlInputs.ph}
            onChange={(e) => onMlInputChange("ph", e.target.value)}
          />
          <input
            className="px-3 py-2 rounded-lg bg-white border border-stone-300 text-sm placeholder-stone-400"
            placeholder="Rainfall (mm)"
            value={mlInputs.rainfall}
            onChange={(e) => onMlInputChange("rainfall", e.target.value)}
          />
        </div>

        {recommendationError ? (
          <p className="text-sm text-rose-700">{recommendationError}</p>
        ) : recommendations.length === 0 ? (
          <p className="text-sm text-slate-600">
            Click <span className="text-emerald-700">Get Recommendations</span> to run ML crop prediction.
          </p>
        ) : (
          <div className="grid md:grid-cols-3 gap-3">
            {recommendations.map((item, idx) => (
              <div key={`${item.seed}-${idx}`} className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="text-emerald-700 font-semibold">{item.seed}</div>
                <div className="text-xs text-slate-600 mt-1">Confidence: {item.score}%</div>
                <div className="mt-2 h-2 bg-stone-200 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-700" style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }} />
                </div>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">{item.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 bg-[#fffdf8]/90 p-5 rounded-2xl border border-stone-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Real-Time Analytics</h3>
          <p className="text-xs text-slate-600">
            Real-time trends (last {analyticsSeries.length || 0} samples) for{" "}
            <span className="text-emerald-700">{activeDeviceId || "selected device"}</span>
          </p>
        </div>

        {!activeDeviceId ? (
          <p className="text-sm text-slate-600">Select a device to view analytics.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="text-sm font-medium text-emerald-700 mb-2">Temperature (C)</div>
              <MiniLineChart points={tempPoints} color="#f97316" min={0} max={50} />
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="text-sm font-medium text-emerald-700 mb-2">Humidity (%)</div>
              <MiniLineChart points={humidityPoints} color="#22c55e" min={0} max={100} />
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="text-sm font-medium text-emerald-700 mb-2">Soil Moisture (%)</div>
              <MiniLineChart points={soilPoints} color="#0ea5e9" min={0} max={100} />
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="text-sm font-medium text-emerald-700 mb-2">Water Level (%)</div>
              <MiniLineChart points={waterPoints} color="#a855f7" min={0} max={100} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
