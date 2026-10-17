#include <Arduino.h>
#include <ArduinoJson.h>
#include <DallasTemperature.h>
#include <FS.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <SD.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <math.h>
#include <time.h>

#include "certificates.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char *DEVICE_INGEST_TOKEN = "YOUR_DEVICE_INGEST_TOKEN";
#endif

#ifndef SERVER_TELEMETRY_URL
#define SERVER_TELEMETRY_URL \
    "https://industrial-motor-health-monitor.vercel.app/api/telemetry"
#endif

const char *DEVICE_ID = "motor-monitor-001";
const char *FIRMWARE_VERSION = "1.3.0";

const uint32_t SAMPLE_INTERVAL_US = 5000;   // 5000us = 5ms -> 200 Hz
const uint32_t REPORT_INTERVAL_MS = 5000;   // 5-second reporting
const uint32_t TEMP_CONV_MS = 750;          // DS18B20 12-bit
const uint32_t REDISCOVERY_INTERVAL_MS = 15000; // 15-second re-scan

// Hardware Pins
constexpr int SDA_PIN = 8;
constexpr int SCL_PIN = 9;
constexpr uint8_t ADXL_ADDRESS = 0x53;
constexpr uint8_t DS3231_ADDRESS = 0x68;

constexpr int MOTOR_TEMP_PIN = 10;
constexpr int AMBIENT_TEMP_PIN = 11;

constexpr int SD_SCK_PIN = 12;
constexpr int SD_MISO_PIN = 13;
constexpr int SD_MOSI_PIN = 14;
constexpr int SD_CS_PIN = 15;

constexpr uint8_t REG_DEVID = 0x00;
constexpr uint8_t REG_BW_RATE = 0x2C;
constexpr uint8_t REG_POWER_CTL = 0x2D;
constexpr uint8_t REG_DATA_FORMAT = 0x31;
constexpr uint8_t REG_DATAX0 = 0x32;
constexpr float G_PER_LSB = 0.0039f;

OneWire oneWireMotor(MOTOR_TEMP_PIN);
DallasTemperature sensorMotor(&oneWireMotor);

OneWire oneWireAmbient(AMBIENT_TEMP_PIN);
DallasTemperature sensorAmbient(&oneWireAmbient);

DeviceAddress motorProbeAddress;
DeviceAddress ambientProbeAddress;

SPIClass spiSD(FSPI);

bool adxlReady = false;
bool adxlError = false;
bool motorProbeFound = false;
bool ambientProbeFound = false;
float currentMotorTemp = 0.0f;
float currentAmbientTemp = 0.0f;
bool motorTempValid = false;
bool ambientTempValid = false;

bool rtcReady = false;
bool rtcSynced = false;
String rtcStatus = "not_detected";

bool sdCardReady = false;
String sdCardStatus = "not_initialized";
uint32_t unsyncedRecordsCount = 0;
String oldestUnsyncedTimestamp = "";
uint32_t recordSequenceNumber = 0;

uint32_t consecutiveUploadFailures = 0;
uint32_t lastSuccessfulUploadMs = 0;
uint32_t nextBacklogUploadAttemptMs = 0;

bool tempConversionPending = false;
uint32_t lastTempRequestMs = 0;
uint32_t lastReportMs = 0;
uint32_t lastWiFiAttemptMs = 0;
uint32_t lastRediscoveryMs = 0;
uint32_t lastNtpAttemptMs = 0;

struct VibrationAccumulator {
  double sumX = 0;
  double sumY = 0;
  double sumZ = 0;
  double sumSqX = 0;
  double sumSqY = 0;
  double sumSqZ = 0;
  uint32_t sampleCount = 0;
  uint32_t i2cErrors = 0;
  uint32_t missedSlots = 0;
};

VibrationAccumulator liveVibration;
SemaphoreHandle_t vibrationMutex = nullptr;

uint8_t bcd2dec(uint8_t val) { return (val / 16 * 10) + (val % 16); }
uint8_t dec2bcd(uint8_t val) { return ((val / 10) << 4) | (val % 10); }

bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(ADXL_ADDRESS);
  Wire.write(reg);
  Wire.write(value);
  return (Wire.endTransmission() == 0);
}

bool readRegisters(uint8_t reg, uint8_t *buffer, size_t length) {
  Wire.beginTransmission(ADXL_ADDRESS);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  size_t received = Wire.requestFrom((uint8_t)ADXL_ADDRESS, (size_t)length, true);
  if (received != length) {
    while (Wire.available()) Wire.read();
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
      Serial.printf("[ADXL345] WARNING: Sensor not detected on I2C address 0x%02X (ID=0x%02X, expected 0xE5).\n",
                    ADXL_ADDRESS, deviceId);
    }
    adxlReady = false;
    adxlError = (deviceId != 0x00 && deviceId != 0xFF);
    return false;
  }

  if (verbose) {
    Serial.printf("[ADXL345] OK: Sensor detected (Device ID: 0x%02X).\n", deviceId);
  }

  writeRegister(REG_POWER_CTL, 0x00);
  writeRegister(REG_BW_RATE, 0x0B);        // 200 Hz
  writeRegister(REG_DATA_FORMAT, 0x08 | 0x03); // Full-res, +/-16g
  writeRegister(REG_POWER_CTL, 0x08);        // Measurement mode

  adxlReady = true;
  adxlError = false;
  return true;
}

bool readAcceleration(float &xG, float &yG, float &zG) {
  uint8_t raw[6];
  if (!readRegisters(REG_DATAX0, raw, sizeof(raw))) return false;

  int16_t rawX = (int16_t)(((uint16_t)raw[1] << 8) | raw[0]);
  int16_t rawY = (int16_t)(((uint16_t)raw[3] << 8) | raw[2]);
  int16_t rawZ = (int16_t)(((uint16_t)raw[5] << 8) | raw[4]);

  xG = rawX * G_PER_LSB;
  yG = rawY * G_PER_LSB;
  zG = rawZ * G_PER_LSB;
  return true;
}

void vibrationSamplingTask(void *parameter) {
  TickType_t lastWakeTime = xTaskGetTickCount();
  const TickType_t periodTicks = pdMS_TO_TICKS(5) > 0 ? pdMS_TO_TICKS(5) : 1;

  for (;;) {
    TickType_t nowTick = xTaskGetTickCount();
    if (nowTick > lastWakeTime + periodTicks) {
      if (xSemaphoreTake(vibrationMutex, pdMS_TO_TICKS(2)) == pdTRUE) {
        liveVibration.missedSlots++;
        xSemaphoreGive(vibrationMutex);
      }
    }

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

// DS3231 RTC
bool initialiseDS3231(bool verbose = true) {
  Wire.beginTransmission(DS3231_ADDRESS);
  if (Wire.endTransmission() != 0) {
    if (verbose) Serial.println("[DS3231] WARNING: RTC module not detected on I2C address 0x68.");
    rtcReady = false;
    rtcStatus = "not_detected";
    return false;
  }

  Wire.beginTransmission(DS3231_ADDRESS);
  Wire.write(0x0F);
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom((uint8_t)DS3231_ADDRESS, (size_t)1, true) == 1) {
    uint8_t statusReg = Wire.read();
    if (statusReg & 0x80) {
      if (verbose) Serial.println("[DS3231] WARNING: Oscillator Stop Flag (OSF) set. RTC time may be invalid.");
      rtcStatus = "time_lost";
    } else {
      rtcStatus = "ready";
    }
  }

  Wire.beginTransmission(DS3231_ADDRESS);
  Wire.write(0x00);
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom((uint8_t)DS3231_ADDRESS, (size_t)7, true) == 7) {
    uint8_t s = bcd2dec(Wire.read() & 0x7F);
    uint8_t m = bcd2dec(Wire.read() & 0x7F);
    uint8_t h = bcd2dec(Wire.read() & 0x3F);
    Wire.read();
    uint8_t d = bcd2dec(Wire.read() & 0x3F);
    uint8_t mo = bcd2dec(Wire.read() & 0x1F);
    uint16_t y = 2000 + bcd2dec(Wire.read());

    if (y >= 2025 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      rtcReady = true;
      if (rtcStatus != "time_lost") rtcStatus = "ready";
      if (verbose) {
        Serial.printf("[DS3231] OK: Hardware RTC clock valid: %04d-%02d-%02dT%02d:%02d:%02dZ\n",
                      y, mo, d, h, m, s);
      }
    } else {
      if (verbose) {
        Serial.printf("[DS3231] WARNING: RTC time out of range (%04d-%02d-%02d). Waiting for NTP sync.\n", y, mo, d);
      }
      rtcReady = false;
      if (rtcStatus == "ready") rtcStatus = "invalid_time";
    }
  }
  return rtcReady;
}

String getRtcIsoTimestamp() {
  Wire.beginTransmission(DS3231_ADDRESS);
  Wire.write(0x00);
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom((uint8_t)DS3231_ADDRESS, (size_t)7, true) == 7) {
    uint8_t s = bcd2dec(Wire.read() & 0x7F);
    uint8_t m = bcd2dec(Wire.read() & 0x7F);
    uint8_t h = bcd2dec(Wire.read() & 0x3F);
    Wire.read();
    uint8_t d = bcd2dec(Wire.read() & 0x3F);
    uint8_t mo = bcd2dec(Wire.read() & 0x1F);
    uint16_t y = 2000 + bcd2dec(Wire.read());

    if (y >= 2025 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      char buf[32];
      snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ", y, mo, d, h, m, s);
      return String(buf);
    }
  }

  time_t now = time(nullptr);
  if (now > 1735689600) {
    struct tm *tm_info = gmtime(&now);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", tm_info);
    return String(buf);
  }
  return "";
}

void syncRtcFromNtp() {
  time_t now = time(nullptr);
  if (now < 1735689600) return;

  struct tm *tm_info = gmtime(&now);
  if (!tm_info) return;

  uint16_t y = tm_info->tm_year + 1900;
  uint8_t mo = tm_info->tm_mon + 1;
  uint8_t d = tm_info->tm_mday;
  uint8_t h = tm_info->tm_hour;
  uint8_t m = tm_info->tm_min;
  uint8_t s = tm_info->tm_sec;
  uint8_t w = tm_info->tm_wday + 1;

  Wire.beginTransmission(DS3231_ADDRESS);
  Wire.write(0x00);
  Wire.write(dec2bcd(s));
  Wire.write(dec2bcd(m));
  Wire.write(dec2bcd(h));
  Wire.write(dec2bcd(w));
  Wire.write(dec2bcd(d));
  Wire.write(dec2bcd(mo));
  Wire.write(dec2bcd((uint8_t)(y - 2000)));
  Wire.endTransmission();

  Wire.beginTransmission(DS3231_ADDRESS);
  Wire.write(0x0F);
  Wire.write(0x00);
  Wire.endTransmission();

  rtcReady = true;
  rtcSynced = true;
  rtcStatus = "ready";
  Serial.printf("[DS3231] Successfully synchronized hardware RTC from NTP: %04d-%02d-%02dT%02d:%02d:%02dZ\n",
                y, mo, d, h, m, s);
}

// MicroSD Storage
void scanOfflineQueue();

bool initialiseSDCard(bool verbose = true) {
  spiSD.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);

  if (!SD.begin(SD_CS_PIN, spiSD, 20000000)) {
    if (verbose) {
      Serial.printf("[SD] WARNING: MicroSD card mount failed on CS GPIO %d (SCK:12, MISO:13, MOSI:14, CS:15). "
                    "Offline telemetry buffering unavailable.\n", SD_CS_PIN);
    }
    sdCardReady = false;
    sdCardStatus = "missing";
    return false;
  }

  uint8_t cardType = SD.cardType();
  if (cardType == CARD_NONE) {
    if (verbose) Serial.println("[SD] WARNING: No SD card attached.");
    sdCardReady = false;
    sdCardStatus = "missing";
    return false;
  }

  sdCardReady = true;
  sdCardStatus = "ready";
  uint64_t totalMb = SD.totalBytes() / (1024 * 1024);
  uint64_t usedMb = SD.usedBytes() / (1024 * 1024);

  if (verbose) {
    Serial.printf("[SD] OK: MicroSD card mounted (Type: %d | Capacity: %llu MB | Used: %llu MB)\n",
                  cardType, totalMb, usedMb);
  }

  if (!SD.exists("/queue")) {
    SD.mkdir("/queue");
  }

  if (!SD.exists("/telemetry.csv")) {
    File logFile = SD.open("/telemetry.csv", FILE_WRITE);
    if (logFile) {
      logFile.println("record_id,measured_at,motor_temp_c,ambient_temp_c,rms_x_g,rms_y_g,rms_z_g,sample_count,quality,wifi_rssi,i2c_errors,missed_slots,synced");
      logFile.close();
    }
  }

  scanOfflineQueue();
  return true;
}

void scanOfflineQueue() {
  if (!sdCardReady) {
    unsyncedRecordsCount = 0;
    oldestUnsyncedTimestamp = "";
    return;
  }

  File dir = SD.open("/queue");
  if (!dir || !dir.isDirectory()) {
    unsyncedRecordsCount = 0;
    oldestUnsyncedTimestamp = "";
    return;
  }

  uint32_t count = 0;
  String oldest = "";

  File entry = dir.openNextFile();
  while (entry) {
    if (!entry.isDirectory() && String(entry.name()).endsWith(".json")) {
      count++;
      if (oldest == "") {
        oldest = String(entry.name());
      }
    }
    entry.close();
    entry = dir.openNextFile();
  }
  dir.close();

  unsyncedRecordsCount = count;
  if (count > 0) {
    Serial.printf("[SD-QUEUE] Detected %u pending offline records in /queue/\n", count);
  }
}

bool appendTelemetryToCsv(
    const String &recordId, const String &measuredAt,
    bool hasMotor, float motorTemp,
    bool hasAmbient, float ambientTemp,
    bool hasVibration, float rmsX, float rmsY, float rmsZ,
    uint32_t sampleCount, float quality,
    int wifiRssi, uint32_t i2cErr, uint32_t missedSlots,
    bool synced
) {
  if (!sdCardReady) return false;

  File f = SD.open("/telemetry.csv", FILE_APPEND);
  if (!f) {
    sdCardStatus = "write_error";
    return false;
  }

  f.printf("%s,%s,", recordId.c_str(), measuredAt.c_str());
  if (hasMotor) f.printf("%.2f,", motorTemp); else f.print(",");
  if (hasAmbient) f.printf("%.2f,", ambientTemp); else f.print(",");
  if (hasVibration) f.printf("%.4f,%.4f,%.4f,", rmsX, rmsY, rmsZ); else f.print(",,,");
  f.printf("%u,%.2f,%d,%u,%u,%s\n",
           sampleCount, quality, wifiRssi, i2cErr, missedSlots,
           synced ? "true" : "false");
  f.flush();
  f.close();
  return true;
}

bool saveRecordToQueue(const String &recordId, const String &jsonPayload) {
  if (!sdCardReady) return false;

  String filePath = String("/queue/") + recordId + ".json";
  File f = SD.open(filePath.c_str(), FILE_WRITE);
  if (!f) {
    sdCardStatus = "write_error";
    Serial.printf("[SD-QUEUE] ERROR: Failed to write pending record to %s\n", filePath.c_str());
    return false;
  }

  f.print(jsonPayload);
  f.flush();
  f.close();
  unsyncedRecordsCount++;
  Serial.printf("[SD-QUEUE] Buffered offline record: %s (Total pending: %u)\n",
                filePath.c_str(), unsyncedRecordsCount);
  return true;
}

// Temperature probes
void discoverTemperatureProbes(bool verbose = true) {
  sensorMotor.begin();
  sensorMotor.setResolution(12);
  sensorMotor.setWaitForConversion(false);

  motorProbeFound = false;
  if (sensorMotor.getDeviceCount() > 0 && sensorMotor.getAddress(motorProbeAddress, 0)) {
    motorProbeFound = true;
    if (verbose) {
      Serial.printf("[DS18B20-MOTOR] GPIO %d: Detected probe ROM: ", MOTOR_TEMP_PIN);
      for (uint8_t b = 0; b < 8; b++) {
        if (motorProbeAddress[b] < 0x10) Serial.print("0");
        Serial.print(motorProbeAddress[b], HEX);
      }
      Serial.println(" -> Motor Stator Probe ONLINE");
    }
  } else {
    motorTempValid = false;
    if (verbose) {
      Serial.printf("[DS18B20-MOTOR] GPIO %d: NOT DETECTED (Check wiring & 4.7k pull-up to 3.3V)\n", MOTOR_TEMP_PIN);
    }
  }

  sensorAmbient.begin();
  sensorAmbient.setResolution(12);
  sensorAmbient.setWaitForConversion(false);

  ambientProbeFound = false;
  if (sensorAmbient.getDeviceCount() > 0 && sensorAmbient.getAddress(ambientProbeAddress, 0)) {
    ambientProbeFound = true;
    if (verbose) {
      Serial.printf("[DS18B20-AMBIENT] GPIO %d: Detected probe ROM: ", AMBIENT_TEMP_PIN);
      for (uint8_t b = 0; b < 8; b++) {
        if (ambientProbeAddress[b] < 0x10) Serial.print("0");
        Serial.print(ambientProbeAddress[b], HEX);
      }
      Serial.println(" -> Ambient Air Reference Probe ONLINE");
    }
  } else {
    ambientTempValid = false;
    if (verbose) {
      Serial.printf("[DS18B20-AMBIENT] GPIO %d: NOT DETECTED (Check wiring & 4.7k pull-up to 3.3V)\n", AMBIENT_TEMP_PIN);
    }
  }

  if (motorProbeFound) sensorMotor.requestTemperatures();
  if (ambientProbeFound) sensorAmbient.requestTemperatures();
  tempConversionPending = (motorProbeFound || ambientProbeFound);
  lastTempRequestMs = millis();
}

void updateTemperatures() {
  uint32_t now = millis();
  if (tempConversionPending && (now - lastTempRequestMs >= TEMP_CONV_MS)) {
    tempConversionPending = false;

    if (motorProbeFound) {
      float t = sensorMotor.getTempC(motorProbeAddress);
      if (isfinite(t) && t != DEVICE_DISCONNECTED_C && t >= -40.0f && t <= 180.0f) {
        currentMotorTemp = t;
        motorTempValid = true;
      } else {
        motorTempValid = false;
        Serial.printf("[DS18B20-MOTOR] Read error (%.1f C) on GPIO %d\n", t, MOTOR_TEMP_PIN);
      }
    } else {
      motorTempValid = false;
    }

    if (ambientProbeFound) {
      float t = sensorAmbient.getTempC(ambientProbeAddress);
      if (isfinite(t) && t != DEVICE_DISCONNECTED_C && t >= -40.0f && t <= 85.0f) {
        currentAmbientTemp = t;
        ambientTempValid = true;
      } else {
        ambientTempValid = false;
        Serial.printf("[DS18B20-AMBIENT] Read error (%.1f C) on GPIO %d\n", t, AMBIENT_TEMP_PIN);
      }
    } else {
      ambientTempValid = false;
    }

    if (motorProbeFound) sensorMotor.requestTemperatures();
    if (ambientProbeFound) sensorAmbient.requestTemperatures();
    tempConversionPending = (motorProbeFound || ambientProbeFound);
    lastTempRequestMs = millis();
  }
}

void checkSensorRecovery() {
  uint32_t now = millis();
  if (now - lastRediscoveryMs >= REDISCOVERY_INTERVAL_MS) {
    lastRediscoveryMs = now;

    if (!adxlReady) initialiseADXL345(false);
    if (!rtcReady) initialiseDS3231(false);
    if (!sdCardReady) initialiseSDCard(false);

    if (!motorProbeFound) {
      sensorMotor.begin();
      if (sensorMotor.getDeviceCount() > 0 && sensorMotor.getAddress(motorProbeAddress, 0)) {
        motorProbeFound = true;
        sensorMotor.requestTemperatures();
        tempConversionPending = true;
        Serial.println("[DS18B20-MOTOR] Hot-plug recovery on GPIO 10.");
      }
    }

    if (!ambientProbeFound) {
      sensorAmbient.begin();
      if (sensorAmbient.getDeviceCount() > 0 && sensorAmbient.getAddress(ambientProbeAddress, 0)) {
        ambientProbeFound = true;
        sensorAmbient.requestTemperatures();
        tempConversionPending = true;
        Serial.println("[DS18B20-AMBIENT] Hot-plug recovery on GPIO 11.");
      }
    }
  }
}

// Wi-Fi
void startWiFiConnection() {
  Serial.printf("[WIFI] Connecting to '%s'...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptMs = millis();
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    static bool ipPrinted = false;
    if (!ipPrinted) {
      Serial.printf("[WIFI] Connected! IP: %s | RSSI: %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      ipPrinted = true;

      // Configure SNTP for automatic network time synchronization
      configTime(0, 0, "pool.ntp.org", "time.google.com");
      lastNtpAttemptMs = millis();
    }

    // Periodic check to sync RTC from NTP
    uint32_t now = millis();
    if (!rtcSynced && (now - lastNtpAttemptMs > 5000)) {
      lastNtpAttemptMs = now;
      syncRtcFromNtp();
    }
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

// HTTPS Post
int sendTelemetryPayload(const String &payload, String &responseStr) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  WiFiClientSecure client;
  client.setCACert(VERCEL_ROOT_CA_CERT);

  HTTPClient https;
  if (!https.begin(client, SERVER_TELEMETRY_URL)) return -2;

  https.addHeader("Content-Type", "application/json");
  https.addHeader("x-device-token", DEVICE_INGEST_TOKEN);
  https.setTimeout(4500);

  int httpCode = https.POST(payload);
  if (httpCode > 0) {
    responseStr = https.getString();
  } else {
    responseStr = https.errorToString(httpCode);
  }
  https.end();
  return httpCode;
}

// Upload offline backlog queue
void processBacklogQueue() {
  if (!sdCardReady || unsyncedRecordsCount == 0 || WiFi.status() != WL_CONNECTED) return;

  uint32_t now = millis();
  if (now < nextBacklogUploadAttemptMs) return;

  File dir = SD.open("/queue");
  if (!dir || !dir.isDirectory()) return;

  File entry = dir.openNextFile();
  String candidatePath = "";
  if (entry) {
    if (!entry.isDirectory() && String(entry.name()).endsWith(".json")) {
      candidatePath = String("/queue/") + String(entry.name());
    }
    entry.close();
  }
  dir.close();

  if (candidatePath == "") return;

  File f = SD.open(candidatePath.c_str(), FILE_READ);
  if (!f) return;

  String payload = f.readString();
  f.close();

  if (payload.length() == 0) {
    SD.remove(candidatePath.c_str());
    if (unsyncedRecordsCount > 0) unsyncedRecordsCount--;
    return;
  }

  String responseStr;
  int httpCode = sendTelemetryPayload(payload, responseStr);

  if (httpCode >= 200 && httpCode < 300) {
    SD.remove(candidatePath.c_str());
    if (unsyncedRecordsCount > 0) unsyncedRecordsCount--;
    consecutiveUploadFailures = 0;
    Serial.printf("[SD-QUEUE] Successfully flushed queued record: %s (Remaining: %u)\n",
                  candidatePath.c_str(), unsyncedRecordsCount);
    // 350ms delay between backlog uploads protects against 429 rate limit
    nextBacklogUploadAttemptMs = millis() + 350;
  } else {
    consecutiveUploadFailures++;
    uint32_t shiftCount = (consecutiveUploadFailures < 4U) ? consecutiveUploadFailures : 4U;
    uint32_t rawBackoff = 5000U * (1U << shiftCount);
    uint32_t backoff = (rawBackoff < 60000U) ? rawBackoff : 60000U;
    nextBacklogUploadAttemptMs = millis() + backoff;
    Serial.printf("[SD-QUEUE] Backlog upload failed (HTTP %d). Backing off for %u ms.\n",
                  httpCode, backoff);
  }
}

// 5-second report telemetry
void reportTelemetry() {
  VibrationAccumulator snapshot;
  if (xSemaphoreTake(vibrationMutex, pdMS_TO_TICKS(10)) != pdTRUE) {
    return;
  }
  snapshot = liveVibration;
  liveVibration = VibrationAccumulator();
  xSemaphoreGive(vibrationMutex);

  bool hasVibration = false;
  float meanX = 0, meanY = 0, meanZ = 0;
  float rmsX = 0, rmsY = 0, rmsZ = 0;

  if (adxlReady && snapshot.sampleCount > 0) {
    hasVibration = true;
    double n = (double)snapshot.sampleCount;
    meanX = (float)(snapshot.sumX / n);
    meanY = (float)(snapshot.sumY / n);
    meanZ = (float)(snapshot.sumZ / n);

    float varX = (float)(snapshot.sumSqX / n) - (meanX * meanX);
    float varY = (float)(snapshot.sumSqY / n) - (meanY * meanY);
    float varZ = (float)(snapshot.sumSqZ / n) - (meanZ * meanZ);
    rmsX = sqrtf(fmaxf(0.0f, varX));
    rmsY = sqrtf(fmaxf(0.0f, varY));
    rmsZ = sqrtf(fmaxf(0.0f, varZ));
  }

  uint32_t expectedSamples = (REPORT_INTERVAL_MS * 1000) / SAMPLE_INTERVAL_US;
  uint32_t missedSlots = snapshot.missedSlots;
  if (adxlReady && snapshot.sampleCount < expectedSamples) {
    uint32_t deficit = expectedSamples - snapshot.sampleCount;
    if (deficit > missedSlots) missedSlots = deficit;
  }
  float acquisitionQuality = (adxlReady && expectedSamples > 0)
      ? fminf(1.0f, (float)snapshot.sampleCount / (float)expectedSamples)
      : 0.0f;

  bool hasMotor = motorProbeFound && motorTempValid;
  bool hasAmbient = ambientProbeFound && ambientTempValid;
  int wifiRssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -120;

  // Generate unique record ID
  char recordIdBuf[64];
  uint32_t nowSec = millis() / 1000;
  snprintf(recordIdBuf, sizeof(recordIdBuf), "rec-%s-%u-%u", DEVICE_ID, nowSec, recordSequenceNumber++);
  String recordId = String(recordIdBuf);

  // Get physical measurement timestamp from DS3231 RTC
  String measuredAt = getRtcIsoTimestamp();

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  DynamicJsonDocument doc(1536);
#endif

  doc["device_id"] = DEVICE_ID;
  doc["record_id"] = recordId;
  if (measuredAt.length() > 0) {
    doc["measured_at"] = measuredAt;
  } else {
    doc["measured_at"] = nullptr;
  }
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["wifi_rssi_dbm"] = (WiFi.status() == WL_CONNECTED) ? wifiRssi : -120;

  if (hasMotor) doc["motor_temp_c"] = currentMotorTemp;
  else doc["motor_temp_c"] = nullptr;

  if (hasAmbient) doc["ambient_temp_c"] = currentAmbientTemp;
  else doc["ambient_temp_c"] = nullptr;

  if (hasVibration) {
    doc["ax_g"] = meanX;
    doc["ay_g"] = meanY;
    doc["az_g"] = meanZ;
    doc["rms_x_g"] = rmsX;
    doc["rms_y_g"] = rmsY;
    doc["rms_z_g"] = rmsZ;
    doc["sample_count"] = snapshot.sampleCount;
    doc["acquisition_quality"] = acquisitionQuality;
  } else {
    doc["ax_g"] = nullptr;
    doc["ay_g"] = nullptr;
    doc["az_g"] = nullptr;
    doc["rms_x_g"] = nullptr;
    doc["rms_y_g"] = nullptr;
    doc["rms_z_g"] = nullptr;
    doc["sample_count"] = 0;
    doc["acquisition_quality"] = 0.0f;
  }
  doc["i2c_errors"] = snapshot.i2cErrors;
  doc["missed_sample_slots"] = missedSlots;

  doc["sd_card_status"] = sdCardStatus;
  doc["unsynced_records_count"] = unsyncedRecordsCount;
  doc["rtc_status"] = rtcStatus;
  doc["rtc_synced"] = rtcSynced;

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonObject sensorStatus = doc["sensor_status"].to<JsonObject>();
#else
  JsonObject sensorStatus = doc.createNestedObject("sensor_status");
#endif
  sensorStatus["adxl345"] = hasVibration ? "ready" : (adxlError ? "error" : "not_detected");
  sensorStatus["motor_temp"] = hasMotor ? "ready" : (motorProbeFound ? "error" : "not_detected");
  sensorStatus["ambient_temp"] = hasAmbient ? "ready" : (ambientProbeFound ? "error" : "not_detected");

  String payload;
  serializeJson(doc, payload);

  bool synced = false;

  // If online and no backlog pending, try direct upload
  if (WiFi.status() == WL_CONNECTED && unsyncedRecordsCount == 0) {
    String responseStr;
    int httpCode = sendTelemetryPayload(payload, responseStr);
    if (httpCode >= 200 && httpCode < 300) {
      synced = true;
      consecutiveUploadFailures = 0;
      lastSuccessfulUploadMs = millis();

      char motorStr[16], ambStr[16], diffStr[16], rmsStr[36];
      if (hasMotor) snprintf(motorStr, sizeof(motorStr), "%.1f C", currentMotorTemp);
      else snprintf(motorStr, sizeof(motorStr), "null (Missing)");

      if (hasAmbient) snprintf(ambStr, sizeof(ambStr), "%.1f C", currentAmbientTemp);
      else snprintf(ambStr, sizeof(ambStr), "null (Missing)");

      if (hasMotor && hasAmbient) snprintf(diffStr, sizeof(diffStr), "%+.1f C", currentMotorTemp - currentAmbientTemp);
      else snprintf(diffStr, sizeof(diffStr), "N/A");

      if (hasVibration) snprintf(rmsStr, sizeof(rmsStr), "(%.3f, %.3f, %.3f)g", rmsX, rmsY, rmsZ);
      else snprintf(rmsStr, sizeof(rmsStr), "null (Offline)");

      Serial.println("--------------------------------------------------------------------------------");
      Serial.printf("[HTTP %d] Telemetry Accepted | ID: %s | RTC: %s\n",
                    httpCode, recordId.c_str(), measuredAt.c_str());
      Serial.printf("  Wi-Fi RSSI: %d dBm | Samples: %u | Quality: %.0f%% | Missed Slots: %u | I2C Err: %u\n",
                    wifiRssi, snapshot.sampleCount, acquisitionQuality * 100.0f, missedSlots, snapshot.i2cErrors);
      Serial.printf("  Motor (GPIO 10): %s | Ambient (GPIO 11): %s | Delta-T: %s\n",
                    motorStr, ambStr, diffStr);
      Serial.printf("  RMS Vibration: %s | DC Mean: (%.3f, %.3f, %.3f)g\n",
                    rmsStr, meanX, meanY, meanZ);
      Serial.printf("  Storage: SD %s (Pending: %u) | RTC: %s (%s)\n",
                    sdCardStatus.c_str(), unsyncedRecordsCount, rtcStatus.c_str(), rtcSynced ? "Synced" : "Local");
      Serial.println("--------------------------------------------------------------------------------");
    } else {
      consecutiveUploadFailures++;
      if (responseStr.length() > 100) responseStr = responseStr.substring(0, 100) + "...";
      Serial.printf("[HTTP %d ERROR] Telemetry upload failed: %s\n", httpCode, responseStr.c_str());
      if (httpCode == 401) {
        Serial.println("  -> AUTH FAILED: Check DEVICE_INGEST_TOKEN in firmware/secrets.h matches Vercel.");
      }
      saveRecordToQueue(recordId, payload);
    }
  } else {
    // Offline or queue has backlog: store to SD card queue
    saveRecordToQueue(recordId, payload);
  }

  // Always append to persistent CSV audit log on MicroSD card
  appendTelemetryToCsv(
      recordId, measuredAt,
      hasMotor, currentMotorTemp,
      hasAmbient, currentAmbientTemp,
      hasVibration, rmsX, rmsY, rmsZ,
      snapshot.sampleCount, acquisitionQuality,
      wifiRssi, snapshot.i2cErrors, missedSlots,
      synced
  );
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n========================================================");
  Serial.println("  Industrial Motor Health Monitor — ESP32-S3 Firmware   ");
  Serial.println("  Device: " + String(DEVICE_ID) + " | FW: " + String(FIRMWARE_VERSION));
  Serial.println("  Hardware: ESP32-S3 N16R8");
  Serial.println("  Wiring: ADXL345 & DS3231 (SDA:8, SCL:9)");
  Serial.println("          Motor Temp (GPIO 10) | Ambient Temp (GPIO 11)");
  Serial.println("          MicroSD SPI (SCK:12, MISO:13, MOSI:14, CS:15)");
  Serial.println("========================================================");

  // 1. Initialise I2C bus for ADXL345 and DS3231 RTC
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);
  initialiseADXL345(true);
  initialiseDS3231(true);

  // 2. Initialise MicroSD Card via FSPI
  initialiseSDCard(true);

  // 3. Initialise OneWire for DS18B20 temperature probes
  discoverTemperatureProbes(true);

  // 4. Create Mutex for vibration data
  vibrationMutex = xSemaphoreCreateMutex();
  if (vibrationMutex == nullptr) {
    Serial.println("[CRITICAL] Failed to allocate FreeRTOS mutex!");
  }

  // 5. Start Core 0 vibration task (200 Hz continuous sampling)
  xTaskCreatePinnedToCore(
      vibrationSamplingTask,
      "VibeSampler",
      4096,
      nullptr,
      2,
      nullptr,
      0
  );

  // 6. Connect Wi-Fi
  startWiFiConnection();

  lastReportMs = millis();
  lastRediscoveryMs = millis();
  Serial.println("[SYSTEM] Setup complete. Entering 5-second operational fault-tolerant loop.\n");
}

void loop() {
  maintainWiFi();
  updateTemperatures();
  checkSensorRecovery();
  processBacklogQueue();

  uint32_t now = millis();
  if (now - lastReportMs >= REPORT_INTERVAL_MS) {
    lastReportMs = now;
    reportTelemetry();
  }
  delay(10);
}
