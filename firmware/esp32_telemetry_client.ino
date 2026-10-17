#include <Arduino.h>
#include <ArduinoJson.h>
#include <DallasTemperature.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <math.h>

#include "certificates.h"

// ==============================================================================
// 1. NETWORK & API CONFIGURATION
// ==============================================================================
// Check if user-provided secrets.h exists locally; otherwise use safe template placeholders.
#if __has_include("secrets.h")
#include "secrets.h"
#else
// Safe template fallback for public source control
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char *DEVICE_INGEST_TOKEN = "YOUR_DEVICE_INGEST_TOKEN";
#endif

#ifndef SERVER_TELEMETRY_URL
// Live Ingestion Endpoint (HTTPS)
#define SERVER_TELEMETRY_URL \
    "https://industrial-motor-health-monitor.vercel.app/api/telemetry"
#endif

// Device Identification
const char *DEVICE_ID = "motor-monitor-001";
const char *FIRMWARE_VERSION = "1.1.0";

// Reporting intervals
const uint32_t SAMPLE_INTERVAL_US = 5000; // 5000us = 5ms -> 200 Hz sampling rate
const uint32_t REPORT_INTERVAL_MS = 1000; // 1-second telemetry upload interval
const uint32_t TEMP_CONV_MS = 750;        // 12-bit DS18B20 conversion time
const uint32_t REDISCOVERY_INTERVAL_MS = 15000; // 15-second re-scan interval for missing sensors

// ==============================================================================
// 2. HARDWARE PIN DEFINITIONS
// ==============================================================================
// ADXL345 I2C Pins (ESP32-S3 default hardware I2C or custom wiring)
constexpr int SDA_PIN = 8;
constexpr int SCL_PIN = 9;
constexpr uint8_t ADXL_ADDRESS = 0x53;

// DS18B20 1-Wire Shared Bus Pin
constexpr int ONEWIRE_PIN = 11;

// ADXL345 Registers & Constants
constexpr uint8_t REG_DEVID = 0x00;
constexpr uint8_t REG_BW_RATE = 0x2C;
constexpr uint8_t REG_POWER_CTL = 0x2D;
constexpr uint8_t REG_DATA_FORMAT = 0x31;
constexpr uint8_t REG_DATAX0 = 0x32;
constexpr float G_PER_LSB = 0.0039f; // Full-resolution scale: ~3.9 mg/LSB

// ==============================================================================
// 3. INDEPENDENT SENSOR STATE & STATS STRUCTURES
// ==============================================================================
OneWire oneWire(ONEWIRE_PIN);
DallasTemperature temperatures(&oneWire);

DeviceAddress motorProbeAddress;
DeviceAddress ambientProbeAddress;

// Independent Sensor Statuses
bool adxlReady = false;
bool adxlError = false;

bool motorProbeFound = false;
bool ambientProbeFound = false;
float currentMotorTemp = 0.0f;
float currentAmbientTemp = 0.0f;
bool motorTempValid = false;
bool ambientTempValid = false;

// Scheduling timers
bool tempConversionPending = false;
uint32_t lastTempRequestMs = 0;
uint32_t lastReportMs = 0;
uint32_t lastWiFiAttemptMs = 0;
uint32_t lastRediscoveryMs = 0;

// Accumulator for 200 Hz vibration samples
struct VibrationAccumulator {
  double sumX = 0;
  double sumY = 0;
  double sumZ = 0;
  double sumSqX = 0;
  double sumSqY = 0;
  double sumSqZ = 0;
  uint32_t sampleCount = 0;
  uint32_t i2cErrors = 0;
};

VibrationAccumulator liveVibration;
SemaphoreHandle_t vibrationMutex = nullptr;

// ==============================================================================
// 4. ADXL345 LOW-LEVEL I2C HELPERS
// ==============================================================================
bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(ADXL_ADDRESS);
  Wire.write(reg);
  Wire.write(value);
  return (Wire.endTransmission() == 0);
}

bool readRegisters(uint8_t reg, uint8_t *buffer, size_t length) {
  Wire.beginTransmission(ADXL_ADDRESS);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  size_t received =
      Wire.requestFrom((uint8_t)ADXL_ADDRESS, (uint8_t)length, (bool)true);
  if (received != length) {
    while (Wire.available())
      Wire.read();
    return false;
  }

  for (size_t i = 0; i < length; i++) {
    buffer[i] = Wire.read();
  }
  return true;
}

bool initialiseADXL345(bool verbose = true) {
  uint8_t deviceId = 0;
  bool detected = false;

  for (int attempt = 1; attempt <= 3; attempt++) {
    if (readRegisters(REG_DEVID, &deviceId, 1) && deviceId == 0xE5) {
      detected = true;
      break;
    }
    delay(50);
  }

  if (!detected) {
    if (verbose) {
      Serial.printf("[ADXL345] WARNING: Sensor not detected on I2C address 0x%02X (ID=0x%02X, expected 0xE5). "
                    "Vibration telemetry will be reported as null.\n",
                    ADXL_ADDRESS, deviceId);
    }
    adxlReady = false;
    adxlError = (deviceId != 0x00 && deviceId != 0xFF);
    return false;
  }

  if (verbose) {
    Serial.printf("[ADXL345] OK: Sensor detected (Device ID: 0x%02X).\n", deviceId);
  }

  // Standby mode to configure
  writeRegister(REG_POWER_CTL, 0x00);
  // Set data rate to 200 Hz (0x0B = 200 Hz)
  writeRegister(REG_BW_RATE, 0x0B);
  // Full-resolution mode, +/- 16g range
  writeRegister(REG_DATA_FORMAT, 0x08 | 0x03);
  // Measurement mode
  writeRegister(REG_POWER_CTL, 0x08);

  adxlReady = true;
  adxlError = false;
  if (verbose) {
    Serial.println("[ADXL345] Operational: 200 Hz sampling initialized.");
  }
  return true;
}

bool readAcceleration(float &xG, float &yG, float &zG) {
  uint8_t raw[6];
  if (!readRegisters(REG_DATAX0, raw, sizeof(raw))) {
    return false;
  }

  int16_t rawX = (int16_t)(((uint16_t)raw[1] << 8) | raw[0]);
  int16_t rawY = (int16_t)(((uint16_t)raw[3] << 8) | raw[2]);
  int16_t rawZ = (int16_t)(((uint16_t)raw[5] << 8) | raw[4]);

  xG = rawX * G_PER_LSB;
  yG = rawY * G_PER_LSB;
  zG = rawZ * G_PER_LSB;
  return true;
}

// ==============================================================================
// 5. 200 HZ VIBRATION SAMPLING TASK (RUNS ON CORE 0)
// ==============================================================================
void vibrationSamplingTask(void *parameter) {
  TickType_t lastWakeTime = xTaskGetTickCount();
  const TickType_t periodTicks = pdMS_TO_TICKS(5) > 0 ? pdMS_TO_TICKS(5) : 1; // 5ms = 200 Hz

  for (;;) {
    if (adxlReady) {
      float ax, ay, az;
      if (readAcceleration(ax, ay, az)) {
        if (xSemaphoreTake(vibrationMutex, pdMS_TO_TICKS(2)) == pdTRUE) {
          liveVibration.sumX += ax;
          liveVibration.sumY += ay;
          liveVibration.sumZ += az;
          liveVibration.sumSqX += ((double)ax * ax);
          liveVibration.sumSqY += ((double)ay * ay);
          liveVibration.sumSqZ += ((double)az * az);
          liveVibration.sampleCount++;
          xSemaphoreGive(vibrationMutex);
        }
      } else {
        if (xSemaphoreTake(vibrationMutex, pdMS_TO_TICKS(2)) == pdTRUE) {
          liveVibration.i2cErrors++;
          xSemaphoreGive(vibrationMutex);
        }
      }
    }
    vTaskDelayUntil(&lastWakeTime, periodTicks);
  }
}

// ==============================================================================
// 6. INDEPENDENT DS18B20 1-WIRE BUS HANDLING
// ==============================================================================
void discoverTemperatureProbes(bool verbose = true) {
  temperatures.begin();
  temperatures.setResolution(12);
  temperatures.setWaitForConversion(false); // Enable non-blocking conversions

  int deviceCount = temperatures.getDeviceCount();
  if (verbose) {
    Serial.printf("[DS18B20] Bus Scan on GPIO %d: Detected %d probe(s)\n",
                  ONEWIRE_PIN, deviceCount);
  }

  motorProbeFound = false;
  ambientProbeFound = false;

  if (deviceCount == 0) {
    if (verbose) {
      Serial.println("[DS18B20] WARNING: No temperature probes detected. Telemetry will report temperatures as null.");
    }
    motorTempValid = false;
    ambientTempValid = false;
    return;
  }

  for (int i = 0; i < deviceCount; i++) {
    DeviceAddress addr;
    if (temperatures.getAddress(addr, i)) {
      if (verbose) {
        Serial.printf("  Probe %d ROM: ", i + 1);
        for (uint8_t b = 0; b < 8; b++) {
          if (addr[b] < 0x10) Serial.print("0");
          Serial.print(addr[b], HEX);
        }
        Serial.println();
      }

      if (!motorProbeFound) {
        memcpy(motorProbeAddress, addr, sizeof(DeviceAddress));
        motorProbeFound = true;
      } else if (!ambientProbeFound) {
        memcpy(ambientProbeAddress, addr, sizeof(DeviceAddress));
        ambientProbeFound = true;
      }
    }
  }

  if (deviceCount == 1) {
    if (verbose) {
      Serial.println("[DS18B20] SINGLE PROBE MODE: Assigned to Motor Stator. Ambient probe is NOT connected (will be sent as null).");
    }
    ambientProbeFound = false;
    ambientTempValid = false;
  } else if (deviceCount >= 2) {
    if (verbose) {
      Serial.println("[DS18B20] DUAL PROBE MODE: Probe 1 = Motor Stator, Probe 2 = Ambient Reference.");
    }
  }

  // Trigger first conversion
  temperatures.requestTemperatures();
  tempConversionPending = true;
  lastTempRequestMs = millis();
}

void updateTemperatures() {
  uint32_t now = millis();
  if (tempConversionPending && (now - lastTempRequestMs >= TEMP_CONV_MS)) {
    tempConversionPending = false;

    if (motorProbeFound) {
      float t = temperatures.getTempC(motorProbeAddress);
      if (isfinite(t) && t != DEVICE_DISCONNECTED_C && t >= -40.0f && t <= 180.0f) {
        currentMotorTemp = t;
        motorTempValid = true;
      } else {
        motorTempValid = false;
        Serial.printf("[DS18B20] ERROR: Motor probe read failed (val: %.1f C). Marking unavailable.\n", t);
      }
    } else {
      motorTempValid = false;
    }

    if (ambientProbeFound) {
      float t = temperatures.getTempC(ambientProbeAddress);
      if (isfinite(t) && t != DEVICE_DISCONNECTED_C && t >= -40.0f && t <= 85.0f) {
        currentAmbientTemp = t;
        ambientTempValid = true;
      } else {
        ambientTempValid = false;
        Serial.printf("[DS18B20] ERROR: Ambient probe read failed (val: %.1f C). Marking unavailable.\n", t);
      }
    } else {
      ambientTempValid = false;
    }

    // Trigger next conversion cycle if at least one probe exists
    if (motorProbeFound || ambientProbeFound) {
      temperatures.requestTemperatures();
      tempConversionPending = true;
      lastTempRequestMs = millis();
    }
  }
}

// Periodic auto-recovery for hot-plugged sensors
void checkSensorRecovery() {
  uint32_t now = millis();
  if (now - lastRediscoveryMs >= REDISCOVERY_INTERVAL_MS) {
    lastRediscoveryMs = now;

    // Retry ADXL345 if not ready
    if (!adxlReady) {
      initialiseADXL345(false);
    }

    // Retry 1-Wire temperature discovery if either probe is missing
    if (!motorProbeFound || !ambientProbeFound) {
      discoverTemperatureProbes(false);
    }
  }
}

// ==============================================================================
// 7. WI-FI CONNECTION & RECONNECT HANDLER
// ==============================================================================
void startWiFiConnection() {
  Serial.printf("[WIFI] Connecting to '%s'...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptMs = millis();
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  uint32_t now = millis();
  if (now - lastWiFiAttemptMs > 10000) {
    lastWiFiAttemptMs = now;
    Serial.println("[WIFI] Re-attempting Wi-Fi connection...");
    WiFi.disconnect();
    WiFi.reconnect();
  }
}

// ==============================================================================
// 8. TELEMETRY SERIALIZATION & HTTPS POST
// ==============================================================================
bool uploadTelemetry(
    bool hasMotorTemp, float motorTemp,
    bool hasAmbientTemp, float ambientTemp,
    bool hasVibration, float ax, float ay, float az,
    float rmsX, float rmsY, float rmsZ,
    uint32_t sampleCount
) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[HTTP] Upload skipped: Wi-Fi not connected (Status: %d)\n", WiFi.status());
    return false;
  }

  int wifiRssi = WiFi.RSSI();

  WiFiClientSecure client;
  // Cryptographically verify Vercel server certificate using GTS Root R1 CA
  client.setCACert(VERCEL_ROOT_CA_CERT);

  HTTPClient https;
  if (!https.begin(client, SERVER_TELEMETRY_URL)) {
    Serial.println("[HTTP] ERROR: Unable to establish HTTPS connection to ingestion server!");
    return false;
  }

  https.addHeader("Content-Type", "application/json");
  https.addHeader("x-device-token", DEVICE_INGEST_TOKEN);
  https.setTimeout(3000); // 3-second timeout

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  DynamicJsonDocument doc(1024);
#endif

  doc["device_id"] = DEVICE_ID;
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["wifi_rssi_dbm"] = wifiRssi;

  // 1. Motor Temperature (Null if not detected/valid)
  if (hasMotorTemp) {
    doc["motor_temp_c"] = motorTemp;
  } else {
    doc["motor_temp_c"] = nullptr;
  }

  // 2. Ambient Temperature (Null if not detected/valid - NEVER fabricated)
  if (hasAmbientTemp) {
    doc["ambient_temp_c"] = ambientTemp;
  } else {
    doc["ambient_temp_c"] = nullptr;
  }

  // 3. ADXL345 Vibration (Null if sensor unavailable)
  if (hasVibration) {
    doc["ax_g"] = ax;
    doc["ay_g"] = ay;
    doc["az_g"] = az;
    doc["rms_x_g"] = rmsX;
    doc["rms_y_g"] = rmsY;
    doc["rms_z_g"] = rmsZ;
    doc["sample_count"] = sampleCount;
  } else {
    doc["ax_g"] = nullptr;
    doc["ay_g"] = nullptr;
    doc["az_g"] = nullptr;
    doc["rms_x_g"] = nullptr;
    doc["rms_y_g"] = nullptr;
    doc["rms_z_g"] = nullptr;
    doc["sample_count"] = 0;
  }

  // 4. Structured Independent Sensor Status
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonObject sensorStatus = doc["sensor_status"].to<JsonObject>();
#else
  JsonObject sensorStatus = doc.createNestedObject("sensor_status");
#endif
  sensorStatus["adxl345"] = hasVibration ? "ready" : (adxlError ? "error" : "not_detected");
  sensorStatus["motor_temp"] = hasMotorTemp ? "ready" : (motorProbeFound ? "error" : "not_detected");
  sensorStatus["ambient_temp"] = hasAmbientTemp ? "ready" : (ambientProbeFound ? "error" : "not_detected");

  String payload;
  serializeJson(doc, payload);

  int httpCode = https.POST(payload);

  if (httpCode >= 200 && httpCode < 300) {
    char motorStr[16];
    char ambStr[16];
    char rmsStr[32];

    if (hasMotorTemp) snprintf(motorStr, sizeof(motorStr), "%.1f C", motorTemp);
    else snprintf(motorStr, sizeof(motorStr), "null");

    if (hasAmbientTemp) snprintf(ambStr, sizeof(ambStr), "%.1f C", ambientTemp);
    else snprintf(ambStr, sizeof(ambStr), "null");

    if (hasVibration) snprintf(rmsStr, sizeof(rmsStr), "(%.3f, %.3f, %.3f)g", rmsX, rmsY, rmsZ);
    else snprintf(rmsStr, sizeof(rmsStr), "null");

    Serial.printf("[HTTP] Ingest OK (%d) | RSSI: %d dBm | Motor: %s | Amb: %s | RMS: %s\n",
                  httpCode, wifiRssi, motorStr, ambStr, rmsStr);
    https.end();
    return true;
  } else {
    Serial.printf("[HTTP] Ingest FAILED (HTTP %d): %s\n",
                  httpCode, https.getString().c_str());
    https.end();
    return false;
  }
}

// ==============================================================================
// 9. ONE-SECOND TELEMETRY CALCULATION & REPORTING
// ==============================================================================
void reportTelemetry() {
  VibrationAccumulator snapshot;

  if (xSemaphoreTake(vibrationMutex, pdMS_TO_TICKS(10)) != pdTRUE) {
    return;
  }
  snapshot = liveVibration;
  liveVibration = VibrationAccumulator(); // Reset accumulator for the next 1-second window
  xSemaphoreGive(vibrationMutex);

  bool hasVibration = false;
  float meanX = 0.0f, meanY = 0.0f, meanZ = 0.0f;
  float rmsX = 0.0f, rmsY = 0.0f, rmsZ = 0.0f;

  if (adxlReady && snapshot.sampleCount > 0) {
    hasVibration = true;
    double n = snapshot.sampleCount;
    meanX = (float)(snapshot.sumX / n);
    meanY = (float)(snapshot.sumY / n);
    meanZ = (float)(snapshot.sumZ / n);

    // True AC RMS removes the gravitational DC component from each axis
    rmsX = sqrtf(fmaxf(0.0001f, (float)(snapshot.sumSqX / n) - (meanX * meanX)));
    rmsY = sqrtf(fmaxf(0.0001f, (float)(snapshot.sumSqY / n) - (meanY * meanY)));
    rmsZ = sqrtf(fmaxf(0.0001f, (float)(snapshot.sumSqZ / n) - (meanZ * meanZ)));
  }

  bool hasMotor = motorProbeFound && motorTempValid;
  bool hasAmbient = ambientProbeFound && ambientTempValid;

  // Upload every available measurement safely, or heartbeat if all sensors fail
  uploadTelemetry(
      hasMotor, currentMotorTemp,
      hasAmbient, currentAmbientTemp,
      hasVibration, meanX, meanY, meanZ,
      rmsX, rmsY, rmsZ,
      snapshot.sampleCount
  );
}

// ==============================================================================
// 10. SETUP
// ==============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================================");
  Serial.println("  Industrial Motor Health Monitor — ESP32-S3 Firmware   ");
  Serial.println("  Device: " + String(DEVICE_ID) +
                 " | FW: " + String(FIRMWARE_VERSION));
  Serial.println("  Independent Sensor Isolation & Fault-Tolerant Telemetry");
  Serial.println("========================================================");

  // 1. Initialise I2C for ADXL345
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000); // 400 kHz Fast I2C mode
  initialiseADXL345(true);

  // 2. Initialise OneWire for DS18B20 temperature probes
  discoverTemperatureProbes(true);

  // 3. Create FreeRTOS Mutex for vibration data
  vibrationMutex = xSemaphoreCreateMutex();
  if (vibrationMutex == nullptr) {
    Serial.println("[FATAL] Could not create vibration mutex!");
    while (true)
      delay(1000);
  }

  // 4. Start Wi-Fi connection (non-blocking)
  startWiFiConnection();

  // 5. Pin high-speed 200 Hz vibration sampling task to Core 0
  BaseType_t taskResult = xTaskCreatePinnedToCore(
      vibrationSamplingTask, "VibrationTask", 4096, nullptr, 2, nullptr,
      0 // Core 0
  );

  if (taskResult != pdPASS) {
    Serial.println("[FATAL] Could not spawn VibrationTask on Core 0!");
  } else {
    Serial.println("[SYSTEM] VibrationTask running on Core 0 (200 Hz continuous sampling).");
  }

  lastReportMs = millis();
  lastRediscoveryMs = millis();
  Serial.println("[SYSTEM] Setup complete. Entering operational fault-tolerant loop.\n");
}

// ==============================================================================
// 11. MAIN LOOP (CORE 1)
// ==============================================================================
void loop() {
  // Non-blocking temperature state machine
  updateTemperatures();

  // Periodic recovery check for hot-plugged sensors
  checkSensorRecovery();

  // Maintain Wi-Fi connection
  maintainWiFi();

  // 1-second reporting cycle (never blocked by missing sensors)
  uint32_t now = millis();
  if (now - lastReportMs >= REPORT_INTERVAL_MS) {
    lastReportMs = now;
    reportTelemetry();
  }

  delay(2); // Small yield to prevent Core 1 WDT starvation
}
