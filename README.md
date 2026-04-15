<<<<<<< HEAD
# Smart-Irrigation-System
=======
# Smart Irrigation System (Full Stack + IoT)

This project includes:
- React frontend (home, login/signup, dashboard)
- Node.js + Express + MongoDB backend
- Device linking by hardcoded `deviceId`
- Live sensor data polling
- One-click pump ON/OFF control
- Seed recommendation engine based on temperature, humidity, and soil moisture

## Grading-Oriented Workflow

1. **Problem statement:** Explain water wastage and manual irrigation challenges.
2. **System architecture:** Present block diagram (ESP32 + sensors + relay + pump + backend + web app + DB).
3. **Implementation layers:**
   - Hardware sensing and actuator control
   - Secure API backend
   - Web dashboard and auth
   - Recommendation model
4. **Validation:**
   - Show live data update every 5 sec
   - Show pump toggle from dashboard
   - Show recommendation output for changing climate values
5. **Impact and scaling:** Mention water savings, remote monitoring, and multi-device support.

## Project Structure

- `client/` - React application
- `server/` - Express backend and MongoDB models
- `hardware/esp32_irrigation.ino` - ESP32 telemetry + pump sync sample

## Backend Setup (`server`)

1. Copy env file:
   - `cp .env.example .env`
2. Update `.env` values:
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `HARDWARE_DEVICE_IDS` (must include your ESP32 `DEVICE_ID`)
   - `DEVICE_INGEST_SECRET` (same secret in firmware)
3. Install and run:
   - `npm install`
   - `npm run dev`

Backend base URL: `http://localhost:5001/api`

## MQTT Integration

The backend now connects to an MQTT broker and handles:
- Incoming telemetry on `smart-irrigation/<deviceId>/telemetry`
- Outgoing pump commands on `smart-irrigation/<deviceId>/pump/set`

ESP32 should publish telemetry JSON, for example:
- `{ "temperature": 29.4, "humidity": 61, "soilMoisture": 42, "waterLevel": 70, "pumpState": false }`

The backend publishes pump commands as:
- `{ "on": true }` or `{ "on": false }`

## Frontend Setup (`client`)

1. Copy env file:
   - `cp .env.example .env`
2. Install and run:
   - `npm install`
   - `npm run dev`

Frontend URL: `http://localhost:5173`

## Key APIs

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/devices/link` (auth)
- `GET /api/devices/my` (auth)
- `GET /api/devices/:deviceId/latest` (auth)
- `POST /api/control/:deviceId/pump` (auth)
- `POST /api/devices/:deviceId/telemetry` (ESP32 with `x-device-secret`)
- `GET /api/recommendation/:deviceId` (auth)

## ML Recommendation Note

The recommendation module currently uses a weighted profile-based scoring engine (temperature/humidity/soil-moisture ranges) that behaves like a simple explainable ML heuristic.
For advanced grading, you can later replace it with:
- KNN/RandomForest model trained on regional crop dataset
- model serving endpoint (same `/recommendation/:deviceId` API contract)

## Suggested Demo Flow

1. Sign up and log in.
2. Link `DEVICE-001`.
3. Start ESP32; send telemetry.
4. Show live dashboard metrics changing.
5. Click Pump ON/OFF and show relay response.
6. Show top 3 seed recommendations.
7. Explain solar + battery resilience and future auto-irrigation rules.
>>>>>>> e0dd6c8 (Initial commit)
