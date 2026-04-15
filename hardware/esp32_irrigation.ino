#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// -------- PIN SETUP --------
#define DHTPIN 14
#define DHTTYPE DHT11
#define SOIL_PIN 34
#define WATER_LEVEL_PIN 35
#define RAIN_PIN 4
#define RELAY_PIN 26 // ACTIVE HIGH relay

// -------- WIFI --------
const char *WIFI_SSID = "OnePlus Nord 3 5G";
const char *WIFI_PASSWORD = "q68whjpf";

// -------- MQTT --------
const char *MQTT_HOST = "f233014a4b844ed5aedf774bd93cff9a.s1.eu.hivemq.cloud";
const int MQTT_PORT = 8883;
const char *MQTT_USERNAME = "gopalgupta";
const char *MQTT_PASSWORD = "@208Gopal";
const char *MQTT_TOPIC_PREFIX = "smart-irrigation";
const char *DEVICE_ID = "DEVICE-esp";

// -------- SETTINGS --------
const int SOIL_DRY_THRESHOLD = 2000;
const int WATER_MIN_THRESHOLD = 1000;
const unsigned long TELEMETRY_INTERVAL_MS = 5000;
const unsigned long WIFI_RETRY_MS = 8000;
const unsigned long MQTT_RETRY_MS = 2500;
const int RAIN_ACTIVE_STATE = LOW;

DHT dht(DHTPIN, DHTTYPE);
WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

// -------- MQTT TOPICS --------
String telemetryTopic;
String controlTopic;

// -------- GLOBAL STATE --------
bool killSwitch = false;
bool manualMode = false;
volatile bool publishNowRequested = false;

unsigned long lastTelemetryMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;

// -------- ✅ RAIN DEBOUNCE --------
bool lastRainRead = false;
bool stableRainState = false;
unsigned long lastRainChangeTime = 0;
const unsigned long RAIN_DEBOUNCE_MS = 500;

// -------- ✅ STATE CHANGE TRACK --------
bool lastAppliedRainState = false;

// -------- WIFI --------
void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiAttemptMs < WIFI_RETRY_MS) return;
  lastWifiAttemptMs = now;

  Serial.println("WiFi reconnect attempt...");
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// -------- AUTO LOGIC --------
void autoControl(int soil, int water) {
  if (soil < SOIL_DRY_THRESHOLD && water > WATER_MIN_THRESHOLD) {
    digitalWrite(RELAY_PIN, HIGH);
    Serial.println("AUTO: Pump ON");
  } else {
    digitalWrite(RELAY_PIN, LOW);
    Serial.println("AUTO: Pump OFF");
  }
}

// -------- ✅ FIXED RAIN DETECTION --------
bool isRainDetected() {
  bool current = (digitalRead(RAIN_PIN) == RAIN_ACTIVE_STATE);

  if (current != lastRainRead) {
    lastRainChangeTime = millis();
    lastRainRead = current;
  }

  if ((millis() - lastRainChangeTime) > RAIN_DEBOUNCE_MS) {
    stableRainState = current;
  }

  return stableRainState;
}

// -------- ✅ CONTROL (NO SPAM) --------
void applyControlNow(int soilRaw, int waterRaw, bool rainDetected) {

  // Only react when rain state changes
  if (rainDetected != lastAppliedRainState) {

    if (rainDetected) {
      digitalWrite(RELAY_PIN, LOW);
      Serial.println("RAIN DETECTED: Pump OFF");
    } else {
      Serial.println("RAIN STOPPED");
    }

    lastAppliedRainState = rainDetected;
  }

  // If raining → always OFF
  if (rainDetected) return;

  // Normal logic
  if (killSwitch) {
    digitalWrite(RELAY_PIN, LOW);
    Serial.println("KILL SWITCH ACTIVE");

  } else if (manualMode) {
    digitalWrite(RELAY_PIN, HIGH);
    Serial.println("MANUAL MODE: FORCE ON");

  } else {
    autoControl(soilRaw, waterRaw);
  }
}

// -------- MQTT MESSAGE --------
void onMqttMessage(char *topic, byte *payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  Serial.print("MQTT RX: ");
  Serial.println(msg);

  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, msg)) return;

  if (doc.containsKey("kill")) killSwitch = doc["kill"];
  if (doc.containsKey("pump")) manualMode = doc["pump"];

  int soilRaw = analogRead(SOIL_PIN);
  int waterRaw = analogRead(WATER_LEVEL_PIN);
  bool rainDetected = isRainDetected();

  applyControlNow(soilRaw, waterRaw, rainDetected);

  publishNowRequested = true;
}

// -------- MQTT CONNECT --------
void ensureMqttConnected() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqttClient.connected()) return;

  unsigned long now = millis();
  if (now - lastMqttAttemptMs < MQTT_RETRY_MS) return;
  lastMqttAttemptMs = now;

  if (mqttClient.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
    mqttClient.subscribe(controlTopic.c_str(), 0);
    Serial.println("MQTT connected");
  }
}

// -------- TELEMETRY --------
void publishTelemetry(float temp, float hum, int soil, int water, bool rainDetected) {
  if (!mqttClient.connected()) return;

  StaticJsonDocument<160> doc;
  doc["temp"] = temp;
  doc["hum"] = hum;
  doc["soil"] = soil;
  doc["water"] = water;
  doc["rain"] = rainDetected;
  doc["pump"] = (digitalRead(RELAY_PIN) == HIGH);

  char buffer[160];
  size_t n = serializeJson(doc, buffer);

  mqttClient.publish(telemetryTopic.c_str(), buffer, n);
}

// -------- SETUP --------
void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  pinMode(SOIL_PIN, INPUT);
  pinMode(WATER_LEVEL_PIN, INPUT);
  pinMode(RAIN_PIN, INPUT_PULLUP);

  dht.begin();

  wifiClient.setInsecure();

  telemetryTopic = String(MQTT_TOPIC_PREFIX) + "/" + DEVICE_ID + "/data";
  controlTopic   = String(MQTT_TOPIC_PREFIX) + "/" + DEVICE_ID + "/control";

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println("System Booted");
}

// -------- LOOP --------
void loop() {
  ensureWiFiConnected();
  ensureMqttConnected();
  mqttClient.loop();

  unsigned long now = millis();

  if (publishNowRequested || (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS)) {
    publishNowRequested = false;
    lastTelemetryMs = now;

    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    int soil = analogRead(SOIL_PIN);
    int water = analogRead(WATER_LEVEL_PIN);
    bool rain = isRainDetected();

    if (isnan(temp) || isnan(hum)) {
      temp = -127;
      hum = -1;
    }

    Serial.println("------ DATA ------");
    Serial.print("Temp: "); Serial.println(temp);
    Serial.print("Humidity: "); Serial.println(hum);
    Serial.print("Soil: "); Serial.println(soil);
    Serial.print("Water: "); Serial.println(water);
    Serial.print("Rain: "); Serial.println(rain ? "YES" : "NO");

    applyControlNow(soil, water, rain);
    publishTelemetry(temp, hum, soil, water, rain);

    Serial.print("FINAL RELAY STATE: ");
    Serial.println(digitalRead(RELAY_PIN) == HIGH ? "ON" : "OFF");
  }

  delay(50);
}