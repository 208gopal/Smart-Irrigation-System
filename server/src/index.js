import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import { router } from "./routes.js";
import { initMqtt } from "./services/mqttService.js";

const app = express();

/* ================= MIDDLEWARE ================= */

// CORS (fix: allow credentials + cleaner config)
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Body parser
app.use(express.json());

/* ================= ROUTES ================= */

app.get("/", (_req, res) => {
  res.send("API is running 🚀");
});

app.use("/api", router);

/* ================= ERROR HANDLING ================= */

// 404 handler (missing in your code)
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("❌ Error:", err.message);

  res.status(err.status || 500).json({
    message: err.message || "Server error",
  });
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 5000;

// Validate env (important)
if (!process.env.MONGODB_URI) {
  console.error("❌ MONGO_URI is missing in .env");
  process.exit(1);
}

connectDB()
  .then(() => {
    initMqtt();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  });