#include <Arduino.h>
#include <ArduinoJson.h>
#include <DallasTemperature.h>
#include <FS.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <OneWire.h>
#include <SD.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <math.h>
#include <time.h>

#include "certificates.h"
#include "pin_config.h"

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

#ifndef SERVER_COMMANDS_POLL_URL
#define SERVER_COMMANDS_POLL_URL \
    "https://industrial-motor-health-monitor.vercel.app/api/device/commands/poll"
#endif

#ifndef SERVER_COMMANDS_ACK_URL
#define SERVER_COMMANDS_ACK_URL \
    "https://industrial-motor-health-monitor.vercel.app/api/device/commands/ack"
#endif

const char *DEVICE_ID = "motor-monitor-001";
const char *FIRMWARE_VERSION = "1.4.0";

const uint32_t SAMPLE_INTERVAL_US = 5000;       // 5000us = 5ms -> 200 Hz
const uint32_t REPORT_INTERVAL_MS = 5000;       // 5-second reporting cadence
const uint32_t TEMP_CONV_MS = 750;              // DS18B20 12-bit conversion time
const uint32_t REDISCOVERY_INTERVAL_MS = 15000; // 15-second probe re-scan
const float STORAGE_CEILING_LIMIT_PCT = 90.0f;  // Strict 90% storage capacity ceiling

// ADXL345 Registers & Constants
constexpr uint8_t REG_DEVID = 0x00;
constexpr uint8_t REG_BW_RATE = 0x2C;
constexpr uint8_t REG_POWER_CTL = 0x2D;
constexpr uint8_t REG_DATA_FORMAT = 0x31;
constexpr uint8_t REG_DATAX0 = 0x32;
constexpr float G_PER_LSB = 0.0039f;

OneWire oneWireMotor(PIN_ONEWIRE_MOTOR);
DallasTemperature sensorMotor(&oneWireMotor);

OneWire oneWireAmbient(PIN_ONEWIRE_AMBIENT);
DallasTemperature sensorAmbient(&oneWireAmbient);

DeviceAddress motorProbeAddress;
DeviceAddress ambientProbeAddress;

SPIClass spiSD(FSPI);

// Sensor & Peripheral Health
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

// Storage Hierarchy States
bool sdCardReady = false;
bool littleFsReady = false;
String storageMedium = "none";
String sdCardStatus = "not_initialized";
float storageUsedPct = 0.0f;
uint32_t unsyncedRecordsCount = 0;
uint32_t droppedRecordsCount = 0;
String oldestUnsyncedTimestamp = "";
uint32_t recordSequenceNumber = 0;

// Configurable Software Alert Thresholds
struct AlertThresholds {
  float motor_temp_caution_c = 55.0f;
  float motor_temp_warning_c = 70.0f;
  float motor_temp_critical_c = 85.0f;
  float rms_caution_g = 0.12f;
  float rms_warning_g = 0.25f;
  float rms_critical_g = 0.45f;
} alertThresholds;

// Local Condition Classification (debounced)
String currentCondition = "UNKNOWN";
String currentConditionReason = "Initial startup observation";
String pendingCondition = "UNKNOWN";
uint8_t conditionPersistenceCount = 0;
const uint8_t CONDITION_PERSISTENCE_THRESHOLD = 2; // 2 windows hysteresis

// Telemetry & Upload Scheduling
uint32_t consecutiveUploadFailures = 0;
uint32_t lastSuccessfulUploadMs = 0;
uint32_t nextBacklogUploadAttemptMs = 0;
bool tempConversionPending = false;
uint32_t lastTempRequestMs = 0;
uint32_t lastReportMs = 0;
uint32_t lastWiFiAttemptMs = 0;
uint32_t lastRediscoveryMs = 0;
uint32_t lastNtpAttemptMs = 0;
uint32_t lastCommandPollMs = 0;

// Vibration Accumulator for 200 Hz Sampling
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

// Non-Blocking LED Test State Machine
enum LedTestMode {
  LED_TEST_IDLE,
  LED_TEST_RUNNING_ALL,
  LED_TEST_RUNNING_SINGLE
};

LedTestMode activeLedTest = LED_TEST_IDLE;
uint8_t testCurrentLedStep = 0;
uint32_t testStepEndMs = 0;
uint32_t testStepDurationMs = 500;
int activeSingleLedPin = -1;
String activeCommandId = "";

// Forward Declarations
void sendDeviceCommandAck(const char *commandId, const char *status, const char *resultJson, const char *errorMessage);
void pollDeviceCommands();
void updateLedIndicators();

uint8_t bcd2dec(uint8_t val) { return (val / 16 * 10) + (val % 16); }
uint8_t dec2bcd(uint8_t val) { return ((val / 10) << 4) | (val % 10); }

bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(ADXL345_I2C_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return (Wire.endTransmission() == 0);
}

bool readRegisters(uint8_t reg, uint8_t *buffer, size_t length) {
  Wire.beginTransmission(ADXL345_I2C_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  size_t received = Wire.requestFrom((uint8_t)ADXL345_I2C_ADDR, (size_t)length, true);
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
                    ADXL345_I2C_ADDR, deviceId);
    }
    adxlReady = false;
    adxlError = (deviceId != 0x00 && deviceId != 0xFF);
    return false;
  }

  if (verbose) {
    Serial.printf("[ADXL345] OK: Sensor detected (Device ID: 0x%02X).\n", deviceId);
  }

  writeRegister(REG_POWER_CTL, 0x00);
  writeRegister(REG_BW_RATE, 0x0B);        // 200 Hz output data rate
  writeRegister(REG_DATA_FORMAT, 0x08 | 0x03); // Full-res, +/-16g scale
  writeRegister(REG_POWER_CTL, 0x08);        // Begin measurement mode

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
  Wire.beginTransmission(DS3231_I2C_ADDR);
  if (Wire.endTransmission() != 0) {
    if (verbose) Serial.println("[DS3231] WARNING: RTC module not detected on I2C address 0x68.");
    rtcReady = false;
    rtcStatus = "not_detected";
    return false;
  }

  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x0F);
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom((uint8_t)DS3231_I2C_ADDR, (size_t)1, true) == 1) {
    uint8_t statusReg = Wire.read();
    if (statusReg & 0x80) {
      if (verbose) Serial.println("[DS3231] WARNING: Oscillator Stop Flag (OSF) set. RTC time may be invalid.");
      rtcStatus = "time_lost";
    } else {
      rtcStatus = "ready";
    }
  }

  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom((uint8_t)DS3231_I2C_ADDR, (size_t)7, true) == 7) {
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
  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom((uint8_t)DS3231_I2C_ADDR, (size_t)7, true) == 7) {
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

  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x00);
  Wire.write(dec2bcd(s));
  Wire.write(dec2bcd(m));
  Wire.write(dec2bcd(h));
  Wire.write(dec2bcd(w));
  Wire.write(dec2bcd(d));
  Wire.write(dec2bcd(mo));
  Wire.write(dec2bcd((uint8_t)(y - 2000)));
  Wire.endTransmission();

  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x0F);
  Wire.write(0x00);
  Wire.endTransmission();

  rtcReady = true;
  rtcSynced = true;
  rtcStatus = "ready";
  Serial.printf("[DS3231] Successfully synchronized hardware RTC from NTP: %04d-%02d-%02dT%02d:%02d:%02dZ\n",
                y, mo, d, h, m, s);
}

// Storage Hierarchy: MicroSD Primary + LittleFS Flash Fallback
void scanOfflineQueue();

float calculateStorageUsage(uint64_t totalBytes, uint64_t usedBytes) {
  if (totalBytes == 0) return 0.0f;
  return ((float)usedBytes * 100.0f) / (float)totalBytes;
}

bool initialiseLittleFSFallback() {
  if (LittleFS.begin(true)) {
    littleFsReady = true;
    uint64_t total = LittleFS.totalBytes();
    uint64_t used = LittleFS.usedBytes();
    storageUsedPct = calculateStorageUsage(total, used);
    storageMedium = "flash_littlefs";

    if (!LittleFS.exists("/lfs_queue")) {
      LittleFS.mkdir("/lfs_queue");
    }
    Serial.printf("[LittleFS] OK: Bounded internal flash fallback mounted (Total: %llu KB, Used: %.1f%%)\n",
                  total / 1024, storageUsedPct);
    return true;
  }
  Serial.println("[LittleFS] ERROR: Flash fallback mount failed.");
  littleFsReady = false;
  return false;
}

bool initialiseSDCard(bool verbose = true) {
  spiSD.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);

  if (!SD.begin(PIN_SD_CS, spiSD, SD_SPI_SPEED_HZ)) {
    if (verbose) {
      Serial.printf("[SD] WARNING: MicroSD mount failed on CS GPIO %d. Activating LittleFS flash fallback.\n", PIN_SD_CS);
    }
    sdCardReady = false;
    sdCardStatus = "missing";
    initialiseLittleFSFallback();
    scanOfflineQueue();
    return false;
  }

  uint8_t cardType = SD.cardType();
  if (cardType == CARD_NONE) {
    if (verbose) Serial.println("[SD] WARNING: No SD card attached. Activating LittleFS flash fallback.");
    sdCardReady = false;
    sdCardStatus = "missing";
    initialiseLittleFSFallback();
    scanOfflineQueue();
    return false;
  }

  sdCardReady = true;
  sdCardStatus = "ready";
  storageMedium = "sd_card";

  uint64_t totalBytes = SD.totalBytes();
  uint64_t usedBytes = SD.usedBytes();
  storageUsedPct = calculateStorageUsage(totalBytes, usedBytes);

  if (verbose) {
    Serial.printf("[SD] OK: MicroSD mounted (Capacity: %llu MB | Used: %.2f%%)\n",
                  totalBytes / (1024 * 1024), storageUsedPct);
  }

  if (!SD.exists("/queue")) {
    SD.mkdir("/queue");
  }

  if (!SD.exists("/telemetry.csv")) {
    File logFile = SD.open("/telemetry.csv", FILE_WRITE);
    if (logFile) {
      logFile.println("record_id,measured_at,motor_temp_c,ambient_temp_c,rms_x_g,rms_y_g,rms_z_g,sample_count,quality,wifi_rssi,condition_status,storage_medium,storage_used_pct,synced");
      logFile.close();
    }
  }

  scanOfflineQueue();
  return true;
}

void scanOfflineQueue() {
  uint32_t count = 0;
  String oldest = "";

  if (sdCardReady) {
    File dir = SD.open("/queue");
    if (dir && dir.isDirectory()) {
      File entry = dir.openNextFile();
      while (entry) {
        if (!entry.isDirectory() && String(entry.name()).endsWith(".json")) {
          count++;
          if (oldest == "") oldest = String(entry.name());
        }
        entry.close();
        entry = dir.openNextFile();
      }
      dir.close();
    }
    uint64_t total = SD.totalBytes();
    uint64_t used = SD.usedBytes();
    storageUsedPct = calculateStorageUsage(total, used);
    storageMedium = "sd_card";
  } else if (littleFsReady) {
    File dir = LittleFS.open("/lfs_queue");
    if (dir && dir.isDirectory()) {
      File entry = dir.openNextFile();
      while (entry) {
        if (!entry.isDirectory() && String(entry.name()).endsWith(".json")) {
          count++;
          if (oldest == "") oldest = String(entry.name());
        }
        entry.close();
        entry = dir.openNextFile();
      }
      dir.close();
    }
    uint64_t total = LittleFS.totalBytes();
    uint64_t used = LittleFS.usedBytes();
    storageUsedPct = calculateStorageUsage(total, used);
    storageMedium = "flash_littlefs";
  } else {
    storageMedium = "none";
    storageUsedPct = 0.0f;
  }

  unsyncedRecordsCount = count;
  oldestUnsyncedTimestamp = oldest;
}

// Storage Headroom Protection (90% limit ceiling rule)
bool enforceStorageCeilingPolicy() {
  if (storageUsedPct < STORAGE_CEILING_LIMIT_PCT) {
    return true; // Headroom sufficient
  }

  Serial.printf("[STORAGE-ALERT] Storage usage reached %.2f%% (>= 90%% ceiling). Applying retention pruning.\n", storageUsedPct);

  // Attempt pruning oldest queue files first
  if (sdCardReady) {
    File dir = SD.open("/queue");
    if (dir && dir.isDirectory()) {
      File entry = dir.openNextFile();
      if (entry) {
        String path = String("/queue/") + entry.name();
        entry.close();
        dir.close();
        SD.remove(path.c_str());
        Serial.printf("[RETENTION] Pruned oldest queue record %s to protect filesystem headroom.\n", path.c_str());
        scanOfflineQueue();
        return (storageUsedPct < STORAGE_CEILING_LIMIT_PCT);
      }
      dir.close();
    }
  } else if (littleFsReady) {
    File dir = LittleFS.open("/lfs_queue");
    if (dir && dir.isDirectory()) {
      File entry = dir.openNextFile();
      if (entry) {
        String path = String("/lfs_queue/") + entry.name();
        entry.close();
        dir.close();
        LittleFS.remove(path.c_str());
        Serial.printf("[RETENTION] Pruned oldest flash record %s to protect headroom.\n", path.c_str());
        scanOfflineQueue();
        return (storageUsedPct < STORAGE_CEILING_LIMIT_PCT);
      }
      dir.close();
    }
  }

  // If storage is still >= 90%, increment dropped records counter
  droppedRecordsCount++;
  Serial.printf("[STORAGE-ERROR] Bounded storage exhausted (%.2f%%). Record discarded to preserve device stability. Total dropped: %u\n",
                storageUsedPct, droppedRecordsCount);
  return false;
}

bool saveRecordToQueue(const String &recordId, const String &jsonPayload) {
  // Check 90% storage limit ceiling
  if (!enforceStorageCeilingPolicy()) {
    return false; // Record dropped per non-negotiable requirement
  }

  if (sdCardReady) {
    String filename = String("/queue/rec_") + recordId + ".json";
    File f = SD.open(filename.c_str(), FILE_WRITE);
    if (f) {
      f.print(jsonPayload);
      f.close();
      unsyncedRecordsCount++;
      return true;
    }
    Serial.println("[SD] Write error on queue write. Attempting LittleFS fallback.");
    sdCardStatus = "write_error";
    if (!littleFsReady) initialiseLittleFSFallback();
  }

  if (littleFsReady) {
    String filename = String("/lfs_queue/rec_") + recordId + ".json";
    File f = LittleFS.open(filename.c_str(), FILE_WRITE);
    if (f) {
      f.print(jsonPayload);
      f.close();
      unsyncedRecordsCount++;
      storageMedium = "flash_littlefs";
      return true;
    }
  }

  droppedRecordsCount++;
  return false;
}

bool appendTelemetryToCsv(
    const String &recordId, const String &measuredAt,
    bool hasMotor, float motorTemp,
    bool hasAmbient, float ambientTemp,
    bool hasVibration, float rmsX, float rmsY, float rmsZ,
    uint32_t sampleCount, float quality,
    int wifiRssi, const String &condStatus, const String &stgMedium, float stgUsed,
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
  f.printf("%u,%.2f,%d,%s,%s,%.1f,%s\n",
           sampleCount, quality, wifiRssi, condStatus.c_str(), stgMedium.c_str(), stgUsed, synced ? "1" : "0");
  f.close();
  return true;
}

// Local Condition Classification Engine
void evaluateMotorCondition(
    float maxRms, float motorT, float ambT,
    bool hasVib, bool hasMotor, bool hasAmb
) {
  String evaluated = "GOOD";
  String reason = "Normal baseline: vibration and thermal rise within nominal limits.";

  if (!hasVib && !hasMotor) {
    evaluated = "UNKNOWN";
    reason = "Sensors offline: ADXL345 and Motor Temperature probe unavailable.";
  } else {
    // 1. Evaluate Vibration
    if (hasVib) {
      if (maxRms >= alertThresholds.rms_critical_g) {
        evaluated = "CRITICAL";
        reason = String("CRITICAL: Severe vibration detected (Max RMS: ") + String(maxRms, 3) + "g >= " + String(alertThresholds.rms_critical_g, 2) + "g). Immediate shutdown advised.";
      } else if (maxRms >= alertThresholds.rms_warning_g) {
        evaluated = "WARNING";
        reason = String("WARNING: High vibration detected (Max RMS: ") + String(maxRms, 3) + "g >= " + String(alertThresholds.rms_warning_g, 2) + "g). Inspection required.";
      } else if (maxRms >= alertThresholds.rms_caution_g) {
        evaluated = "CHECK";
        reason = String("CAUTION: Elevated vibration (Max RMS: ") + String(maxRms, 3) + "g). Monitor bearing wear.";
      }
    }

    // 2. Evaluate Motor Temperature & Thermal Rise
    if (hasMotor) {
      if (motorT >= alertThresholds.motor_temp_critical_c) {
        evaluated = "CRITICAL";
        reason = String("CRITICAL: Stator overheating (") + String(motorT, 1) + "C >= " + String(alertThresholds.motor_temp_critical_c, 1) + "C).";
      } else if (motorT >= alertThresholds.motor_temp_warning_c && evaluated != "CRITICAL") {
        evaluated = "WARNING";
        reason = String("WARNING: High stator temperature (") + String(motorT, 1) + "C).";
      } else if (motorT >= alertThresholds.motor_temp_caution_c && evaluated == "GOOD") {
        evaluated = "CHECK";
        reason = String("CAUTION: Motor temperature elevated (") + String(motorT, 1) + "C).";
      }

      if (hasAmb) {
        float deltaT = motorT - ambT;
        if (deltaT >= 35.0f) {
          evaluated = "CRITICAL";
          reason = String("CRITICAL: Extreme thermal rise (+") + String(deltaT, 1) + "C above ambient).";
        } else if (deltaT >= 25.0f && evaluated != "CRITICAL") {
          evaluated = "WARNING";
          reason = String("WARNING: Elevated thermal rise (+") + String(deltaT, 1) + "C above ambient).";
        }
      }
    }
  }

  // Hysteresis / Debounce logic to prevent chatter
  if (evaluated == pendingCondition) {
    conditionPersistenceCount++;
    if (conditionPersistenceCount >= CONDITION_PERSISTENCE_THRESHOLD) {
      currentCondition = evaluated;
      currentConditionReason = reason;
    }
  } else {
    pendingCondition = evaluated;
    conditionPersistenceCount = 1;
    // Immediate escalation on critical condition
    if (evaluated == "CRITICAL") {
      currentCondition = evaluated;
      currentConditionReason = reason;
    }
  }
}

// LED Indicators State Machine
void updateLedIndicators() {
  uint32_t now = millis();

  // 1. If an explicit website command test sequence is running, execute it non-blocking
  if (activeLedTest == LED_TEST_RUNNING_ALL) {
    if (now >= testStepEndMs) {
      testCurrentLedStep++;
      if (testCurrentLedStep >= TEST_LED_COUNT) {
        // Finished chaser
        for (size_t i = 0; i < TEST_LED_COUNT; i++) digitalWrite(TEST_LEDS[i], LOW);
        activeLedTest = LED_TEST_IDLE;
        sendDeviceCommandAck(activeCommandId.c_str(), "SUCCEEDED", "{\"leds_tested\":5}", nullptr);
        activeCommandId = "";
      } else {
        // Light current step LED only
        for (size_t i = 0; i < TEST_LED_COUNT; i++) {
          digitalWrite(TEST_LEDS[i], (i == testCurrentLedStep) ? HIGH : LOW);
        }
        testStepEndMs = now + testStepDurationMs;
      }
    }
    return;
  } else if (activeLedTest == LED_TEST_RUNNING_SINGLE) {
    if (now >= testStepEndMs) {
      if (activeSingleLedPin >= 0) digitalWrite(activeSingleLedPin, LOW);
      activeLedTest = LED_TEST_IDLE;
      sendDeviceCommandAck(activeCommandId.c_str(), "SUCCEEDED", "{\"pulse_completed\":true}", nullptr);
      activeCommandId = "";
      activeSingleLedPin = -1;
    }
    return;
  }

  // 2. Normal Machine-Side Indication: 5 Test LEDs act as Vibration / Condition Bar Meter
  if (currentCondition == "GOOD") {
    digitalWrite(PIN_TEST_LED_1, HIGH);
    digitalWrite(PIN_TEST_LED_2, LOW);
    digitalWrite(PIN_TEST_LED_3, LOW);
    digitalWrite(PIN_TEST_LED_4, LOW);
    digitalWrite(PIN_TEST_LED_5, LOW);
  } else if (currentCondition == "CHECK") {
    digitalWrite(PIN_TEST_LED_1, HIGH);
    digitalWrite(PIN_TEST_LED_2, HIGH);
    digitalWrite(PIN_TEST_LED_3, LOW);
    digitalWrite(PIN_TEST_LED_4, LOW);
    digitalWrite(PIN_TEST_LED_5, LOW);
  } else if (currentCondition == "WARNING") {
    digitalWrite(PIN_TEST_LED_1, HIGH);
    digitalWrite(PIN_TEST_LED_2, HIGH);
    digitalWrite(PIN_TEST_LED_3, HIGH);
    digitalWrite(PIN_TEST_LED_4, LOW);
    digitalWrite(PIN_TEST_LED_5, LOW);
  } else if (currentCondition == "CRITICAL") {
    // 200 ms non-blocking flash on all LEDs
    bool flashState = ((now / 200) % 2 == 0);
    digitalWrite(PIN_TEST_LED_1, flashState ? HIGH : LOW);
    digitalWrite(PIN_TEST_LED_2, flashState ? HIGH : LOW);
    digitalWrite(PIN_TEST_LED_3, flashState ? HIGH : LOW);
    digitalWrite(PIN_TEST_LED_4, flashState ? HIGH : LOW);
    digitalWrite(PIN_TEST_LED_5, flashState ? HIGH : LOW);
  } else {
    // UNKNOWN / Insufficient Data: LED 5 pulses slowly (1 sec period)
    bool faultPulse = ((now / 500) % 2 == 0);
    digitalWrite(PIN_TEST_LED_1, LOW);
    digitalWrite(PIN_TEST_LED_2, LOW);
    digitalWrite(PIN_TEST_LED_3, LOW);
    digitalWrite(PIN_TEST_LED_4, LOW);
    digitalWrite(PIN_TEST_LED_5, faultPulse ? HIGH : LOW);
  }

  // 3. Status LEDs: Red (GPIO 17) & Green (GPIO 18)
  bool networkFresh = (lastSuccessfulUploadMs > 0 && (now - lastSuccessfulUploadMs) <= 25000);
  if (currentCondition == "CRITICAL" || currentCondition == "WARNING" || !networkFresh) {
    digitalWrite(PIN_LED_RED_FAULT, HIGH);
    digitalWrite(PIN_LED_GREEN_HEALTHY, networkFresh && currentCondition != "CRITICAL" ? HIGH : LOW);
  } else {
    digitalWrite(PIN_LED_RED_FAULT, LOW);
    digitalWrite(PIN_LED_GREEN_HEALTHY, HIGH);
  }
}

// Temperature Sensors
void discoverTemperatureProbes(bool verbose = true) {
  sensorMotor.begin();
  uint8_t countMotor = sensorMotor.getDeviceCount();
  if (countMotor > 0 && sensorMotor.getAddress(motorProbeAddress, 0)) {
    sensorMotor.setResolution(motorProbeAddress, 12);
    sensorMotor.setWaitForConversion(false);
    motorProbeFound = true;
    if (verbose) Serial.println("[DS18B20-MOTOR] OK: Motor stator temperature probe found on GPIO 10.");
  } else {
    motorProbeFound = false;
    motorTempValid = false;
    if (verbose) Serial.println("[DS18B20-MOTOR] WARNING: No probe found on GPIO 10.");
  }

  sensorAmbient.begin();
  uint8_t countAmb = sensorAmbient.getDeviceCount();
  if (countAmb > 0 && sensorAmbient.getAddress(ambientProbeAddress, 0)) {
    sensorAmbient.setResolution(ambientProbeAddress, 12);
    sensorAmbient.setWaitForConversion(false);
    ambientProbeFound = true;
    if (verbose) Serial.println("[DS18B20-AMBIENT] OK: Ambient room temperature probe found on GPIO 11.");
  } else {
    ambientProbeFound = false;
    ambientTempValid = false;
    if (verbose) Serial.println("[DS18B20-AMBIENT] WARNING: No probe found on GPIO 11.");
  }
}

void updateTemperatures() {
  uint32_t now = millis();

  if (!tempConversionPending) {
    if (motorProbeFound || ambientProbeFound) {
      if (motorProbeFound) sensorMotor.requestTemperatures();
      if (ambientProbeFound) sensorAmbient.requestTemperatures();
      tempConversionPending = true;
      lastTempRequestMs = now;
    }
    return;
  }

  if (now - lastTempRequestMs >= TEMP_CONV_MS) {
    tempConversionPending = false;

    if (motorProbeFound) {
      float t = sensorMotor.getTempC(motorProbeAddress);
      if (t > -55.0f && t < 125.0f && t != 85.0f) {
        currentMotorTemp = t;
        motorTempValid = true;
      } else {
        motorTempValid = false;
      }
    }

    if (ambientProbeFound) {
      float t = sensorAmbient.getTempC(ambientProbeAddress);
      if (t > -55.0f && t < 125.0f && t != 85.0f) {
        currentAmbientTemp = t;
        ambientTempValid = true;
      } else {
        ambientTempValid = false;
      }
    }
  }
}

void checkSensorRecovery() {
  uint32_t now = millis();
  if (now - lastRediscoveryMs < REDISCOVERY_INTERVAL_MS) return;
  lastRediscoveryMs = now;

  if (!adxlReady) initialiseADXL345(false);
  if (!rtcReady) initialiseDS3231(false);
  if (!motorProbeFound || !ambientProbeFound) discoverTemperatureProbes(false);
  if (!sdCardReady) initialiseSDCard(false);
}

// Wi-Fi Management
void startWiFiConnection() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[WIFI] Connecting to SSID: %s ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptMs = millis();
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!rtcSynced && (millis() - lastNtpAttemptMs > 60000)) {
      lastNtpAttemptMs = millis();
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
      syncRtcFromNtp();
    }
    return;
  }

  uint32_t now = millis();
  if (now - lastWiFiAttemptMs >= 10000) {
    lastWiFiAttemptMs = now;
    Serial.println("[WIFI] Reconnecting Wi-Fi in background...");
    WiFi.disconnect();
    WiFi.reconnect();
  }
}

// HTTPS Telemetry Transmission
int sendTelemetryPayload(const String &jsonPayload, String &responseBody) {
  WiFiClientSecure client;
  client.setCACert(VERCEL_ROOT_CA_CERT);

  HTTPClient http;
  http.begin(client, SERVER_TELEMETRY_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_INGEST_TOKEN);
  http.setTimeout(4500);

  int httpCode = http.POST(jsonPayload);
  if (httpCode > 0) {
    responseBody = http.getString();
  } else {
    responseBody = http.errorToString(httpCode);
  }
  http.end();
  return httpCode;
}

// Two-Way Command Acknowledgment Transmission
void sendDeviceCommandAck(const char *commandId, const char *status, const char *resultJson, const char *errorMessage) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setCACert(VERCEL_ROOT_CA_CERT);

  HTTPClient http;
  http.begin(client, SERVER_COMMANDS_ACK_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_INGEST_TOKEN);
  http.setTimeout(3500);

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument ackDoc;
#else
  StaticJsonDocument<512> ackDoc;
#endif
  ackDoc["command_id"] = commandId;
  ackDoc["status"] = status;
  if (resultJson) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument resDoc;
#else
    StaticJsonDocument<256> resDoc;
#endif
    deserializeJson(resDoc, resultJson);
    ackDoc["result"] = resDoc.as<JsonObject>();
  }
  if (errorMessage) {
    ackDoc["error_message"] = errorMessage;
  }

  String ackPayload;
  serializeJson(ackDoc, ackPayload);

  int httpCode = http.POST(ackPayload);
  Serial.printf("[COMMAND-ACK] Dispatched ACK for %s (Status: %s, HTTP: %d)\n", commandId, status, httpCode);
  http.end();
}

// Two-Way Command Polling
void pollDeviceCommands() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (activeLedTest != LED_TEST_IDLE) return; // Do not interrupt running test

  WiFiClientSecure client;
  client.setCACert(VERCEL_ROOT_CA_CERT);

  HTTPClient http;
  http.begin(client, SERVER_COMMANDS_POLL_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_INGEST_TOKEN);
  http.setTimeout(3500);

  String pollBody = String("{\"device_id\":\"") + DEVICE_ID + "\"}";
  int httpCode = http.POST(pollBody);

  if (httpCode == 200) {
    String resStr = http.getString();
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument pollDoc;
#else
    DynamicJsonDocument pollDoc(2048);
#endif
    DeserializationError err = deserializeJson(pollDoc, resStr);
    if (!err && pollDoc.containsKey("commands")) {
      JsonArray cmds = pollDoc["commands"].as<JsonArray>();
      for (JsonObject cmd : cmds) {
        const char *cmdId = cmd["id"];
        const char *cmdType = cmd["command_type"];
        JsonObject params = cmd["parameters"];

        Serial.printf("[COMMAND-RECEIVED] Executing Command: %s (Type: %s)\n", cmdId, cmdType);

        if (strcmp(cmdType, "LED_TEST_ALL") == 0) {
          activeCommandId = String(cmdId);
          activeLedTest = LED_TEST_RUNNING_ALL;
          testCurrentLedStep = 0;
          testStepDurationMs = params["step_duration_ms"] | 500;
          testStepEndMs = millis() + testStepDurationMs;
          // Set first LED immediately
          for (size_t i = 0; i < TEST_LED_COUNT; i++) {
            digitalWrite(TEST_LEDS[i], (i == 0) ? HIGH : LOW);
          }
          sendDeviceCommandAck(cmdId, "EXECUTING", "{\"state\":\"running_all\"}", nullptr);
          break; // Process one active LED sequence at a time
        } else if (strcmp(cmdType, "LED_TEST_SINGLE") == 0) {
          int ledIdx = params["led_index"] | 1;
          uint32_t dur = params["duration_ms"] | 2000;
          if (ledIdx >= 1 && ledIdx <= 5) {
            activeCommandId = String(cmdId);
            activeLedTest = LED_TEST_RUNNING_SINGLE;
            activeSingleLedPin = TEST_LEDS[ledIdx - 1];
            testStepDurationMs = dur;
            testStepEndMs = millis() + dur;
            for (size_t i = 0; i < TEST_LED_COUNT; i++) digitalWrite(TEST_LEDS[i], LOW);
            digitalWrite(activeSingleLedPin, HIGH);
            sendDeviceCommandAck(cmdId, "EXECUTING", "{\"state\":\"pulsing_single\"}", nullptr);
            break;
          } else {
            sendDeviceCommandAck(cmdId, "FAILED", nullptr, "Invalid led_index. Permitted: 1..5");
          }
        } else if (strcmp(cmdType, "SET_ALERT_THRESHOLDS") == 0) {
          if (params.containsKey("motor_temp_caution_c")) alertThresholds.motor_temp_caution_c = params["motor_temp_caution_c"];
          if (params.containsKey("motor_temp_warning_c")) alertThresholds.motor_temp_warning_c = params["motor_temp_warning_c"];
          if (params.containsKey("motor_temp_critical_c")) alertThresholds.motor_temp_critical_c = params["motor_temp_critical_c"];
          if (params.containsKey("rms_caution_g")) alertThresholds.rms_caution_g = params["rms_caution_g"];
          if (params.containsKey("rms_warning_g")) alertThresholds.rms_warning_g = params["rms_warning_g"];
          if (params.containsKey("rms_critical_g")) alertThresholds.rms_critical_g = params["rms_critical_g"];
          Serial.println("[COMMAND] Updated alert thresholds successfully.");
          sendDeviceCommandAck(cmdId, "SUCCEEDED", "{\"thresholds_updated\":true}", nullptr);
        } else if (strcmp(cmdType, "SENSOR_DIAGNOSTIC") == 0 || strcmp(cmdType, "STATUS_REQUEST") == 0) {
          String resJson = String("{\"adxl345\":\"") + (adxlReady ? "ready" : "offline") +
                           "\",\"motor_temp\":\"" + (motorTempValid ? "ready" : "offline") +
                           "\",\"ambient_temp\":\"" + (ambientTempValid ? "ready" : "offline") +
                           "\",\"rtc\":\"" + rtcStatus +
                           "\",\"storage\":\"" + storageMedium +
                           "\",\"condition\":\"" + currentCondition + "\"}";
          sendDeviceCommandAck(cmdId, "SUCCEEDED", resJson.c_str(), nullptr);
        } else {
          sendDeviceCommandAck(cmdId, "FAILED", nullptr, "Unsupported or unpermitted command type");
        }
      }
    }
  }
  http.end();
}

// Backlog Offline Queue Processing
void processBacklogQueue() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (unsyncedRecordsCount == 0) return;

  uint32_t now = millis();
  if (now < nextBacklogUploadAttemptMs) return;

  // Process from SD queue if available
  if (sdCardReady) {
    File dir = SD.open("/queue");
    if (!dir || !dir.isDirectory()) return;

    File entry = dir.openNextFile();
    if (!entry) {
      dir.close();
      unsyncedRecordsCount = 0;
      return;
    }

    String path = String("/queue/") + entry.name();
    String content = "";
    while (entry.available()) {
      content += (char)entry.read();
    }
    entry.close();
    dir.close();

    if (content.length() > 0) {
      String responseStr;
      int httpCode = sendTelemetryPayload(content, responseStr);
      if (httpCode >= 200 && httpCode < 300) {
        SD.remove(path.c_str());
        if (unsyncedRecordsCount > 0) unsyncedRecordsCount--;
        Serial.printf("[SD-DRAIN] Successfully synced buffered record %s (Remaining: %u)\n",
                      path.c_str(), unsyncedRecordsCount);
        nextBacklogUploadAttemptMs = now + 400; // Small delay between drain batches
        return;
      } else {
        Serial.printf("[SD-DRAIN] Failed to sync %s (HTTP %d). Retrying later.\n", path.c_str(), httpCode);
        nextBacklogUploadAttemptMs = now + 5000;
        return;
      }
    }
  } else if (littleFsReady) {
    File dir = LittleFS.open("/lfs_queue");
    if (!dir || !dir.isDirectory()) return;

    File entry = dir.openNextFile();
    if (!entry) {
      dir.close();
      unsyncedRecordsCount = 0;
      return;
    }

    String path = String("/lfs_queue/") + entry.name();
    String content = "";
    while (entry.available()) {
      content += (char)entry.read();
    }
    entry.close();
    dir.close();

    if (content.length() > 0) {
      String responseStr;
      int httpCode = sendTelemetryPayload(content, responseStr);
      if (httpCode >= 200 && httpCode < 300) {
        LittleFS.remove(path.c_str());
        if (unsyncedRecordsCount > 0) unsyncedRecordsCount--;
        Serial.printf("[FLASH-DRAIN] Successfully synced flash record %s (Remaining: %u)\n",
                      path.c_str(), unsyncedRecordsCount);
        nextBacklogUploadAttemptMs = now + 400;
        return;
      } else {
        nextBacklogUploadAttemptMs = now + 5000;
        return;
      }
    }
  }
}

// 5-Second Telemetry Packaging and Reporting
void reportTelemetry() {
  VibrationAccumulator snapshot;
  if (xSemaphoreTake(vibrationMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    snapshot = liveVibration;
    liveVibration.sumX = 0;
    liveVibration.sumY = 0;
    liveVibration.sumZ = 0;
    liveVibration.sumSqX = 0;
    liveVibration.sumSqY = 0;
    liveVibration.sumSqZ = 0;
    liveVibration.sampleCount = 0;
    liveVibration.i2cErrors = 0;
    liveVibration.missedSlots = 0;
    xSemaphoreGive(vibrationMutex);
  }

  float meanX = 0, meanY = 0, meanZ = 0;
  float rmsX = 0, rmsY = 0, rmsZ = 0;
  float maxRms = 0;
  bool hasVibration = (adxlReady && snapshot.sampleCount >= 10);

  if (hasVibration) {
    meanX = snapshot.sumX / snapshot.sampleCount;
    meanY = snapshot.sumY / snapshot.sampleCount;
    meanZ = snapshot.sumZ / snapshot.sampleCount;

    double varX = (snapshot.sumSqX / snapshot.sampleCount) - ((double)meanX * meanX);
    double varY = (snapshot.sumSqY / snapshot.sampleCount) - ((double)meanY * meanY);
    double varZ = (snapshot.sumSqZ / snapshot.sampleCount) - ((double)meanZ * meanZ);

    rmsX = sqrtf(fmaxf(0.0f, (float)varX));
    rmsY = sqrtf(fmaxf(0.0f, (float)varY));
    rmsZ = sqrtf(fmaxf(0.0f, (float)varZ));
    maxRms = fmaxf(rmsX, fmaxf(rmsY, rmsZ));
  }

  uint32_t expectedSamples = (REPORT_INTERVAL_MS * 1000) / SAMPLE_INTERVAL_US; // ~1,000 samples
  uint32_t missedSlots = snapshot.missedSlots;
  if (hasVibration && snapshot.sampleCount < expectedSamples) {
    missedSlots += (expectedSamples - snapshot.sampleCount);
  }
  float acquisitionQuality = hasVibration
      ? fminf(1.0f, (float)snapshot.sampleCount / (float)expectedSamples)
      : 0.0f;

  bool hasMotor = motorTempValid;
  bool hasAmbient = ambientTempValid;
  int wifiRssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -120;

  // Local rule-based condition classification on ESP32
  evaluateMotorCondition(maxRms, currentMotorTemp, currentAmbientTemp, hasVibration, hasMotor, hasAmbient);

  recordSequenceNumber++;
  char recordIdBuf[48];
  snprintf(recordIdBuf, sizeof(recordIdBuf), "%s-%lu-%u",
           DEVICE_ID, (unsigned long)time(nullptr), recordSequenceNumber);
  String recordId = String(recordIdBuf);
  String measuredAt = getRtcIsoTimestamp();

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  DynamicJsonDocument doc(1536);
#endif

  doc["device_id"] = DEVICE_ID;
  doc["record_id"] = recordId;
  doc["firmware_version"] = FIRMWARE_VERSION;
  if (measuredAt.length() > 0) {
    doc["measured_at"] = measuredAt;
  } else {
    doc["measured_at"] = nullptr;
  }

  if (WiFi.status() == WL_CONNECTED) {
    doc["wifi_rssi_dbm"] = wifiRssi;
  } else {
    doc["wifi_rssi_dbm"] = nullptr;
  }

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

  // Condition classification transmitted from local ESP32 calculation
  doc["condition_status"] = currentCondition;
  doc["condition_reason"] = currentConditionReason;

  // Storage Diagnostics
  doc["storage_medium"] = storageMedium;
  doc["storage_used_pct"] = storageUsedPct;
  doc["dropped_records_count"] = droppedRecordsCount;
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

  // Direct upload if online and no backlog
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
      Serial.printf("  Condition: %s (%s)\n", currentCondition.c_str(), currentConditionReason.c_str());
      Serial.printf("  Storage: %s (%.1f%% used | Pending: %u | Dropped: %u)\n",
                    storageMedium.c_str(), storageUsedPct, unsyncedRecordsCount, droppedRecordsCount);
      Serial.printf("  Motor (GPIO 10): %s | Ambient (GPIO 11): %s | Delta-T: %s\n",
                    motorStr, ambStr, diffStr);
      Serial.printf("  RMS Vibration: %s | DC Mean: (%.3f, %.3f, %.3f)g\n",
                    rmsStr, meanX, meanY, meanZ);
      Serial.println("--------------------------------------------------------------------------------");
    } else {
      consecutiveUploadFailures++;
      Serial.printf("[HTTP %d ERROR] Telemetry upload failed: %s\n", httpCode, responseStr.c_str());
      saveRecordToQueue(recordId, payload);
    }
  } else {
    // Offline or backlog present: save record to durable local storage
    saveRecordToQueue(recordId, payload);
  }

  // Always log to persistent CSV on MicroSD card
  appendTelemetryToCsv(
      recordId, measuredAt,
      hasMotor, currentMotorTemp,
      hasAmbient, currentAmbientTemp,
      hasVibration, rmsX, rmsY, rmsZ,
      snapshot.sampleCount, acquisitionQuality,
      wifiRssi, currentCondition, storageMedium, storageUsedPct,
      synced
  );
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n========================================================");
  Serial.println("  Industrial Motor Health Monitor — ESP32-S3 Firmware   ");
  Serial.println("  Device: " + String(DEVICE_ID) + " | FW: " + String(FIRMWARE_VERSION));
  Serial.println("  Hardware: ESP32-S3 N16R8 (16MB Flash, 8MB PSRAM)");
  Serial.println("  Wiring: ADXL345 & DS3231 (SDA:8, SCL:9)");
  Serial.println("          Motor Temp (GPIO 10) | Ambient Temp (GPIO 11)");
  Serial.println("          MicroSD SPI (SCK:12, MISO:13, MOSI:14, CS:15)");
  Serial.println("          Test LEDs (GPIOs: 4, 5, 6, 7, 16)");
  Serial.println("          Status LEDs (Red: 17, Green: 18)");
  Serial.println("========================================================");

  // 1. Authoritative GPIO Pin Configuration (Test LEDs & Status LEDs)
  configureHardwarePins();

  // 2. Initialise I2C bus for ADXL345 and DS3231 RTC
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(I2C_FREQUENCY_HZ);
  initialiseADXL345(true);
  initialiseDS3231(true);

  // 3. Initialise Storage Hierarchy (MicroSD + LittleFS Fallback)
  initialiseSDCard(true);

  // 4. Initialise OneWire for Dual DS18B20 Probes
  discoverTemperatureProbes(true);

  // 5. Create FreeRTOS Mutex for vibration data
  vibrationMutex = xSemaphoreCreateMutex();
  if (vibrationMutex == nullptr) {
    Serial.println("[CRITICAL] Failed to allocate FreeRTOS mutex!");
  }

  // 6. Start Core 0 vibration task (200 Hz continuous acquisition)
  xTaskCreatePinnedToCore(
      vibrationSamplingTask,
      "VibeSampler",
      4096,
      nullptr,
      2,
      nullptr,
      0
  );

  // 7. Connect Wi-Fi
  startWiFiConnection();

  lastReportMs = millis();
  lastRediscoveryMs = millis();
  lastCommandPollMs = millis();
  Serial.println("[SYSTEM] Setup complete. Entering fault-tolerant calculation loop.\n");
}

void loop() {
  maintainWiFi();
  updateTemperatures();
  checkSensorRecovery();
  processBacklogQueue();
  updateLedIndicators();

  uint32_t now = millis();

  // Periodic Two-Way Command Polling from Web Dashboard (every 5 seconds)
  if (now - lastCommandPollMs >= 5000) {
    lastCommandPollMs = now;
    pollDeviceCommands();
  }

  // Periodic Telemetry Window Calculation & Transmission
  if (now - lastReportMs >= REPORT_INTERVAL_MS) {
    lastReportMs = now;
    reportTelemetry();
  }

  delay(10);
}
