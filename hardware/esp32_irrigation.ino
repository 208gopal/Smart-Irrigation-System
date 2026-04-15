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
const unsigned long TELEMETRY_INTERVAL_MS = 5000; // set 2000 for faster regular updates
const unsigned long WIFI_RETRY_MS = 8000;
const unsigned long MQTT_RETRY_MS = 2500;

DHT dht(DHTPIN, DHTTYPE);
WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

// -------- MQTT TOPICS --------
String telemetryTopic;
String controlTopic;

// -------- GLOBAL STATE --------
bool killSwitch = false;
bool manualMode = false; // true => force ON, false => auto logic
volatile bool publishNowRequested = false;

unsigned long lastTelemetryMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;

// -------- WIFI (NON-BLOCKING) --------
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

// -------- LOCAL AUTO LOGIC --------
void autoControl(int soil, int water) {
  if (soil < SOIL_DRY_THRESHOLD && water > WATER_MIN_THRESHOLD) {
    digitalWrite(RELAY_PIN, HIGH);
    Serial.println("AUTO: Pump ON");
  } else {
    digitalWrite(RELAY_PIN, LOW);
    Serial.println("AUTO: Pump OFF");
  }
}

// -------- APPLY CONTROL STATE --------
void applyControlNow(int soilRaw, int waterRaw) {
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
  msg.reserve(length);
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  Serial.print("MQTT RX [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(msg);

  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, msg)) {
    Serial.println("MQTT RX JSON parse failed");
    return;
  }

  if (doc.containsKey("kill")) {
    killSwitch = doc["kill"];
  }

  if (doc.containsKey("pump")) {
    manualMode = doc["pump"];
  }

  // Apply immediately so switch response is instant
  int soilRaw = analogRead(SOIL_PIN);
  int waterRaw = analogRead(WATER_LEVEL_PIN);
  applyControlNow(soilRaw, waterRaw);

  Serial.print("IMMEDIATE RELAY STATE: ");
  Serial.println(digitalRead(RELAY_PIN) == HIGH ? "ON" : "OFF");

  // Request an immediate telemetry push so dashboard updates without waiting 5s
  publishNowRequested = true;
}

// -------- MQTT CONNECT (NON-BLOCKING) --------
void ensureMqttConnected() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqttClient.connected()) return;

  unsigned long now = millis();
  if (now - lastMqttAttemptMs < MQTT_RETRY_MS) return;
  lastMqttAttemptMs = now;

  Serial.print("MQTT reconnect attempt...");
  if (mqttClient.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.println("connected");
    bool ok = mqttClient.subscribe(controlTopic.c_str(), 0);
    Serial.print("Subscribed to ");
    Serial.print(controlTopic);
    Serial.print(" => ");
    Serial.println(ok ? "OK" : "FAILED");
  } else {
    Serial.print("failed, state=");
    Serial.println(mqttClient.state());
  }
}

// -------- SEND DATA --------
void publishTelemetry(float temp, float hum, int soil, int water) {
  if (!mqttClient.connected()) {
    Serial.println("Telemetry skipped: MQTT disconnected");
    return;
  }

  StaticJsonDocument<160> doc;
  doc["temp"] = temp;
  doc["hum"] = hum;
  doc["soil"] = soil;
  doc["water"] = water;
  doc["pump"] = (digitalRead(RELAY_PIN) == HIGH);

  char buffer[160];
  size_t n = serializeJson(doc, buffer);

  bool ok = mqttClient.publish(telemetryTopic.c_str(), (uint8_t*)buffer, n, false);
  Serial.print("MQTT TX [");
  Serial.print(telemetryTopic);
  Serial.print("]: ");
  Serial.println(ok ? "OK" : "FAILED");
}

// -------- SETUP --------
void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // pump OFF at boot
  pinMode(SOIL_PIN, INPUT);
  pinMode(WATER_LEVEL_PIN, INPUT);

  dht.begin();

  wifiClient.setInsecure();

  telemetryTopic = String(MQTT_TOPIC_PREFIX) + "/" + DEVICE_ID + "/data";
  controlTopic   = String(MQTT_TOPIC_PREFIX) + "/" + DEVICE_ID + "/control";

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(10);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println("System Booted");
  Serial.print("Telemetry topic: ");
  Serial.println(telemetryTopic);
  Serial.print("Control topic: ");
  Serial.println(controlTopic);
}

// -------- LOOP --------
void loop() {
  ensureWiFiConnected();
  ensureMqttConnected();

  // Run MQTT handler continuously for low-latency controls
  mqttClient.loop();

  unsigned long now = millis();
  if (publishNowRequested || (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS)) {
    publishNowRequested = false;
    lastTelemetryMs = now;

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

    applyControlNow(soilRaw, waterRaw);
    publishTelemetry(temperature, humidity, soilRaw, waterRaw);

    Serial.print("FINAL RELAY STATE: ");
    Serial.println(digitalRead(RELAY_PIN) == HIGH ? "ON" : "OFF");
  }

  delay(5); // tiny yield, avoids long blocking delays
}