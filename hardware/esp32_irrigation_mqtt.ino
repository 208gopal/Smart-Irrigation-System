#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

#define DHTPIN 4
#define DHTTYPE DHT22
#define RELAY_PIN 5

const char *WIFI_SSID = "Airtel_KIRAN";
const char *WIFI_PASSWORD = "godbless";
const char *MQTT_HOST = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char *DEVICE_ID = "DEVICE-001";
const char *TOPIC_PREFIX = "smart-irrigation";
const char *MQTT_USERNAME = "gopalgupta";
const char *MQTT_PASSWORD = "@208Gopal";

WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);
DHT dht(DHTPIN, DHTTYPE);

String telemetryTopic;
String pumpSetTopic;

int readSoilMoisture() {
  int raw = analogRead(34);
  return map(raw, 4095, 0, 0, 100);
}

int readWaterLevel() {
  int raw = analogRead(35);
  return map(raw, 0, 4095, 0, 100);
}

void onMqttMessage(char *topic, byte *payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, message) == DeserializationError::Ok) {
    bool on = doc["on"] | false;
    digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  }
}

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void connectMqtt() {
  while (!mqttClient.connected()) {
    String clientId = String("esp32-") + DEVICE_ID;
    if (mqttClient.connect(clientId.c_str())) {
      mqttClient.subscribe(pumpSetTopic.c_str(), 1);
    } else {
      delay(2000);
    }
  }
}

void publishTelemetry() {
  StaticJsonDocument<256> doc;
  doc["temperature"] = dht.readTemperature();
  doc["humidity"] = dht.readHumidity();
  doc["soilMoisture"] = readSoilMoisture();
  doc["waterLevel"] = readWaterLevel();
  doc["pumpState"] = digitalRead(RELAY_PIN) == HIGH;

  char buffer[256];
  size_t n = serializeJson(doc, buffer);
  mqttClient.publish(telemetryTopic.c_str(), buffer, n);
}

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  Serial.begin(115200);
  dht.begin();

  telemetryTopic = String(TOPIC_PREFIX) + "/" + DEVICE_ID + "/telemetry";
  pumpSetTopic = String(TOPIC_PREFIX) + "/" + DEVICE_ID + "/pump/set";

  connectWiFi();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqttClient.connected()) connectMqtt();
  mqttClient.loop();

  static unsigned long lastSent = 0;
  if (millis() - lastSent > 10000) {
    publishTelemetry();
    lastSent = millis();
  }
}
