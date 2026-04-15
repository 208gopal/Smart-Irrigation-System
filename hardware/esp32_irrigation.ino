#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <esp_sleep.h>

// -------- PIN SETUP --------
#define DHTPIN 14
#define DHTTYPE DHT11
#define SOIL_PIN 34
#define WATER_LEVEL_PIN 35
#define RELAY_PIN 26

// -------- WIFI --------
const char *WIFI_SSID = "OnePlus Nord 3 5G";
const char *WIFI_PASSWORD = "q68whjpf";

// -------- API --------
const char *API_BASE_URL = "http://10.252.86.74:5001/api";
const char *DEVICE_ID = "DEVICE-esp";
const char *DEVICE_SECRET = "123";

// -------- SETTINGS --------
const int SOIL_DRY_THRESHOLD_RAW = 2000;
const int WATER_MIN_THRESHOLD_RAW = 1000;
const unsigned long LOOP_MS = 5000;

DHT dht(DHTPIN, DHTTYPE);

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi failed. Will retry.");
  }
}

void enterKillSwitchSleep() {
  // software-off mode: requires reset/power cycle to wake
  digitalWrite(RELAY_PIN, LOW); // keep pump OFF before sleep
  Serial.println("KILL SWITCH ACTIVE: entering deep sleep now.");
  delay(200);
  esp_deep_sleep_start();
}

// -------- LOCAL AUTO LOGIC --------
void applyLocalPumpSafety(int soilRaw, int waterRaw) {
  // ACTIVE HIGH -> HIGH = ON
  if (soilRaw < SOIL_DRY_THRESHOLD_RAW && waterRaw > WATER_MIN_THRESHOLD_RAW) {
    digitalWrite(RELAY_PIN, HIGH);   // ON
    Serial.println("LOCAL MODE: Pump ON");
  } else {
    digitalWrite(RELAY_PIN, LOW);    // OFF
    Serial.println("LOCAL MODE: Pump OFF");
  }
}

// -------- TELEMETRY + CONTROL --------
void pushTelemetry(float temperature, float humidity, int soilRaw, int waterRaw) {

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi DOWN -> AUTO MODE");
    applyLocalPumpSafety(soilRaw, waterRaw);
    return;
  }

  HTTPClient http;
  String url = String(API_BASE_URL) + "/devices/" + DEVICE_ID + "/telemetry";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-secret", DEVICE_SECRET);

  StaticJsonDocument<256> doc;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["soilMoisture"] = soilRaw;
  doc["waterLevel"] = waterRaw;
  doc["pumpState"] = (digitalRead(RELAY_PIN) == HIGH);

  String payload;
  serializeJson(doc, payload);

  int status = http.POST(payload);
  Serial.print("HTTP status: ");
  Serial.println(status);

  if (status > 0) {
    String body = http.getString();
    Serial.print("Response: ");
    Serial.println(body);

    StaticJsonDocument<512> response;
    DeserializationError err = deserializeJson(response, body);

    if (!err && response["killSwitchActive"] == true) {
      enterKillSwitchSleep();
    }

    if (!err && response.containsKey("desiredPumpState")) {
      bool desired = response["desiredPumpState"];

      if (desired == true) {
        // FORCE ON
        digitalWrite(RELAY_PIN, HIGH);
        Serial.println("SERVER MODE: FORCE PUMP ON");
      } else {
        // AUTO MODE
        Serial.println("SERVER MODE: AUTO");
        applyLocalPumpSafety(soilRaw, waterRaw);
      }
    } else {
      Serial.println("NO SERVER CMD -> AUTO MODE");
      applyLocalPumpSafety(soilRaw, waterRaw);
    }
  } else {
    Serial.println("HTTP FAILED -> AUTO MODE");
    applyLocalPumpSafety(soilRaw, waterRaw);
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(SOIL_PIN, INPUT);
  pinMode(WATER_LEVEL_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Pump OFF initially (ACTIVE HIGH)
  dht.begin();
  connectWiFi();
  Serial.println("Smart Irrigation System Started");
}

void loop() {
  connectWiFi();

  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  int soilRaw = analogRead(SOIL_PIN);
  int waterRaw = analogRead(WATER_LEVEL_PIN);

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT FAILED");
    temperature = -127;
    humidity = -1;
  }

  Serial.println("------ DATA ------");
  Serial.print("Temp: "); Serial.println(temperature);
  Serial.print("Humidity: "); Serial.println(humidity);
  Serial.print("Soil: "); Serial.println(soilRaw);
  Serial.print("Water: "); Serial.println(waterRaw);

  pushTelemetry(temperature, humidity, soilRaw, waterRaw);

  Serial.print("FINAL RELAY STATE: ");
  Serial.println(digitalRead(RELAY_PIN) == HIGH ? "ON" : "OFF");

  delay(LOOP_MS);
}
