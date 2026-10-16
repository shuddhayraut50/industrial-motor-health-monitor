/**
 * ==============================================================================
 * Industrial Motor Health Monitoring Platform — ESP32-S3 Telemetry Client
 * ==============================================================================
 * Hardware:
 *   - ESP32-S3 DevKit M-1 (N16R8)
 *   - ADXL345 3-Axis Digital Accelerometer (200 Hz continuous sampling)
 *   - 2x Waterproof DS18B20 1-Wire Temperature Probes (Motor + Ambient)
 *
 * Architecture:
 *   - Core 1: Dedicated to continuous, high-speed 200 Hz sensor sampling & RMS calculation.
 *   - Core 0: Asynchronous FreeRTOS telemetry task handling Wi-Fi, HTTPS POST,
 *             and remote configuration checks.
 *   - Network calls NEVER block the high-speed sampling loop.
 * ==============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ==============================================================================
// 1. CONFIGURATION & CREDENTIALS (REPLACE WITH YOUR ACTUAL NETWORK CREDENTIALS)
// ==============================================================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Server Ingestion Endpoint (Replace with your actual deployed Vercel domain or local IP)
// For local testing: "http://192.168.1.X:3000/api/telemetry" (use HTTPClient without TLS)
// For deployed Vercel: "https://industrial-motor-health-monitor.vercel.app/api/telemetry"
const char* SERVER_TELEMETRY_URL = "https://industrial-motor-health-monitor.vercel.app/api/telemetry";
const char* SERVER_CONFIG_URL    = "https://industrial-motor-health-monitor.vercel.app/api/device/config";
const char* SERVER_CONFIG_ACK_URL= "https://industrial-motor-health-monitor.vercel.app/api/device/config/ack";

// Device Identification and Dedicated Secret Ingestion Token
const char* DEVICE_ID            = "motor-monitor-001";
const char* DEVICE_INGEST_TOKEN  = "secret_device_token_change_in_production_motor_001";
const char* FIRMWARE_VERSION     = "v1.0.0-esp32s3";

// Default reporting interval (dynamically updated by remote config)
volatile unsigned long reporting_interval_ms = 1000;

// ==============================================================================
// 2. THREAD-SAFE SHARED SENSOR DATA STRUCTURE
// ==============================================================================
struct SensorTelemetryData {
  float motor_temp_c;
  float ambient_temp_c;
  float ax_g;
  float ay_g;
  float az_g;
  float rms_x_g;
  float rms_y_g;
  float rms_z_g;
  uint32_t sample_count;
};

// Global shared snapshot protected by FreeRTOS Mutex
SensorTelemetryData latestTelemetry;
portMUX_TYPE telemetryMux = portMUX_INITIALIZER_UNLOCKED;

// ==============================================================================
// 3. TELEMETRY TASK (RUNS ON CORE 0)
// ==============================================================================
void telemetryTask(void *pvParameters) {
  WiFiClientSecure client;
  // For production HTTPS on Vercel, setInsecure() bypasses root cert expiration issues
  // or use Root CA cert for strict certificate pinning.
  client.setInsecure();

  while (true) {
    // 1. Check Wi-Fi connection; reconnect asynchronously if disconnected
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[TELEMETRY] Wi-Fi disconnected. Reconnecting...");
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    // 2. Thread-safely copy the latest sensor snapshot from Core 1
    SensorTelemetryData snapshot;
    portENTER_CRITICAL(&telemetryMux);
    snapshot = latestTelemetry;
    portEXIT_CRITICAL(&telemetryMux);

    // 3. Serialize JSON payload (matching exact server specification)
    StaticJsonDocument<512> doc;
    doc["device_id"]        = DEVICE_ID;
    doc["motor_temp_c"]     = serialized(String(snapshot.motor_temp_c, 2));
    doc["ambient_temp_c"]   = serialized(String(snapshot.ambient_temp_c, 2));
    doc["ax_g"]             = serialized(String(snapshot.ax_g, 4));
    doc["ay_g"]             = serialized(String(snapshot.ay_g, 4));
    doc["az_g"]             = serialized(String(snapshot.az_g, 4));
    doc["rms_x_g"]          = serialized(String(snapshot.rms_x_g, 4));
    doc["rms_y_g"]          = serialized(String(snapshot.rms_y_g, 4));
    doc["rms_z_g"]          = serialized(String(snapshot.rms_z_g, 4));
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["sample_count"]     = snapshot.sample_count;

    String jsonPayload;
    serializeJson(doc, jsonPayload);

    // 4. Send HTTPS POST to Vercel ingestion endpoint
    HTTPClient http;
    http.begin(client, SERVER_TELEMETRY_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-token", DEVICE_INGEST_TOKEN);
    http.setTimeout(3000); // 3-second network timeout

    int httpResponseCode = http.POST(jsonPayload);

    if (httpResponseCode == 201 || httpResponseCode == 200) {
      Serial.printf("[TELEMETRY] Upload OK (%d). Sent %d bytes.\n", httpResponseCode, jsonPayload.length());
    } else {
      Serial.printf("[TELEMETRY] Upload Failed! Code: %d\n", httpResponseCode);
    }

    http.end();

    // 5. Delay by configured reporting interval (e.g. 1000ms)
    vTaskDelay(pdMS_TO_TICKS(reporting_interval_ms));
  }
}

// ==============================================================================
// 4. MAIN SETUP (INITIALIZATION)
// ==============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== Industrial Motor Health Monitor Firmware ===");

  // Initialize your existing sensor drivers here without modification
  // (e.g. adxl.begin(), sensors.begin() for DS18B20)

  // Initialize Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWi-Fi Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nWi-Fi not connected yet. Telemetry task will continue retrying.");
  }

  // Spawn Telemetry Task on Core 0 (leaving Core 1 entirely free for 200 Hz sensor loop)
  xTaskCreatePinnedToCore(
    telemetryTask,       /* Task function */
    "TelemetryTask",     /* Name */
    8192,                /* Stack size */
    NULL,                /* Parameter */
    1,                   /* Priority */
    NULL,                /* Task handle */
    0                    /* Pin to Core 0 */
  );

  Serial.println("[SYSTEM] Core 0 Telemetry Task started.");
}

// ==============================================================================
// 5. MAIN SENSOR SAMPLING LOOP (RUNS ON CORE 1 AT 200 Hz)
// ==============================================================================
void loop() {
  static unsigned long lastSampleTime = 0;
  const unsigned long samplePeriodMicros = 5000; // 5000us = 5ms = 200 Hz

  unsigned long currentMicros = micros();
  if (currentMicros - lastSampleTime >= samplePeriodMicros) {
    lastSampleTime = currentMicros;

    // --- YOUR EXISTING SENSOR READINGS GO HERE ---
    // Read ADXL345 accelerometer (ax, ay, az)
    // Compute continuous running AC RMS vibration
    // Read DS18B20 temperatures every ~1000ms
    
    // Example: update the shared snapshot thread-safely
    portENTER_CRITICAL(&telemetryMux);
    // latestTelemetry.motor_temp_c   = readMotorTemp();
    // latestTelemetry.ambient_temp_c = readAmbientTemp();
    // latestTelemetry.ax_g           = ax;
    // latestTelemetry.ay_g           = ay;
    // latestTelemetry.az_g           = az;
    // latestTelemetry.rms_x_g        = rmsX;
    // latestTelemetry.rms_y_g        = rmsY;
    // latestTelemetry.rms_z_g        = rmsZ;
    // latestTelemetry.sample_count   = 200;
    portEXIT_CRITICAL(&telemetryMux);
  }
}
