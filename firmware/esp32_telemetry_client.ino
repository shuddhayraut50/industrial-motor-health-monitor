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
#include <esp_timer.h>
#include <math.h>
#include <sys/time.h>
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

#ifndef SERVER_EVENTS_URL
#define SERVER_EVENTS_URL \
    "https://industrial-motor-health-monitor.vercel.app/api/device/events"
#endif

const char *DEVICE_ID = "motor-monitor-001";
const char *FIRMWARE_VERSION = "1.5.0-fast-rt";

// Timing & Cadence Constants
constexpr uint32_t SAMPLE_INTERVAL_US = 5000;       // 5000 us = 5 ms -> 200 Hz
constexpr size_t FAST_WINDOW_SAMPLES = 50;           // 50 samples @ 200 Hz = 250 ms fast evaluation
constexpr uint32_t REPORT_INTERVAL_MS = 5000;        // 5-second telemetry upload cadence
constexpr uint32_t TEMP_CONV_MS = 750;               // DS18B20 12-bit conversion time
constexpr uint32_t REDISCOVERY_INTERVAL_MS = 15000;  // 15-second background probe re-scan
constexpr float STORAGE_CEILING_LIMIT_PCT = 90.0f;   // Strict 90% storage capacity ceiling

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
volatile bool adxlReady = false;
volatile bool adxlError = false;
volatile bool motorProbeFound = false;
volatile bool ambientProbeFound = false;
volatile float currentMotorTemp = 0.0f;
volatile float currentAmbientTemp = 0.0f;
volatile bool motorTempValid = false;
volatile bool ambientTempValid = false;

volatile bool rtcReady = false;
volatile bool rtcSynced = false;
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
volatile float currentFastMaxRms = 0.0f;
uint32_t backlogBackoffMs = 400;
uint32_t recordsAcceptedCount = 0;
uint32_t recordsQuarantinedCount = 0;
uint32_t recordsRetriedCount = 0;
uint32_t recordsPreservedCount = 0;

// Configurable Software Alert Thresholds
struct AlertThresholds {
  float motor_temp_caution_c = 55.0f;
  float motor_temp_warning_c = 70.0f;
  float motor_temp_critical_c = 85.0f;
  float rms_caution_g = 0.12f;
  float rms_warning_g = 0.25f;
  float rms_critical_g = 0.45f;
} alertThresholds;

// Local Condition State (Evaluated every 250 ms on Core 0)
String currentCondition = "UNKNOWN";
String currentConditionReason = "Initial startup observation";
String pendingCondition = "UNKNOWN";
uint8_t conditionPersistenceCount = 0;
constexpr uint8_t CONDITION_PERSISTENCE_THRESHOLD = 2; // 2 fast cycles (500 ms) for warning/check

// Network & Background State
uint32_t consecutiveUploadFailures = 0;
uint32_t lastSuccessfulUploadMs = 0;
uint32_t nextBacklogUploadAttemptMs = 0;
bool tempConversionPending = false;
uint32_t lastTempRequestMs = 0;
uint32_t lastWiFiAttemptMs = 0;
uint32_t wifiBackoffMs = 5000;
uint32_t lastRediscoveryMs = 0;
uint32_t lastSdRetryMs = 0;
uint32_t lastNtpAttemptMs = 0;
uint32_t lastCommandPollMs = 0;
uint32_t lastPerfLogMs = 0;

// Diagnostic Subsystem State Tracking
struct DiagnosticStateTracker {
  String lastWifiState = "disconnected";
  String lastApiState = "healthy";
  String lastAdxlState = "unknown";
  String lastMotorTempState = "unknown";
  String lastAmbientTempState = "unknown";
  String lastSdState = "unknown";
  String lastRtcState = "unknown";
  String lastClassifierState = "UNKNOWN";

  uint8_t wifiFailCount = 0;
  uint8_t adxlGlitchCount = 0;
  uint8_t motorGlitchCount = 0;
  uint8_t ambientGlitchCount = 0;
  uint8_t apiFailCount = 0;
  uint32_t lastEventSyncMs = 0;
  uint32_t eventSequence = 0;
};
DiagnosticStateTracker diagTracker;

void logDiagnosticEvent(
    const char *component,
    const char *eventCode,
    const char *severity,
    const char *prevState,
    const char *newState,
    const char *diagnosticMsg,
    const char *detailsJson = nullptr,
    bool resolved = false
);

// ==============================================================================
// LOW-OVERHEAD PERFORMANCE INSTRUMENTATION (esp_timer_get_time monotonic)
// ==============================================================================
struct PerformanceMetrics {
  uint32_t sampleIntervalUs = 0;
  uint32_t maxSampleIntervalUs = 0;
  uint32_t minSampleIntervalUs = 999999;
  uint32_t sampleExecDurationUs = 0;
  uint32_t maxSampleExecDurationUs = 0;
  uint32_t fastRmsCalcDurationUs = 0;
  uint32_t conditionToLedLatencyUs = 0;
  uint32_t lastSdWriteDurationMs = 0;
  uint32_t lastUploadDurationMs = 0;
  uint32_t missedSampleSlots = 0;
  uint32_t queueOverflowCount = 0;
  UBaseType_t realtimeTaskStackWatermark = 0;
} perfMetrics;

// ==============================================================================
// FAST ROLLING RMS ACCUMULATOR (O(1) Circular Buffer for 250 ms Window)
// ==============================================================================
struct RollingWindowAccumulator {
  float bufX[FAST_WINDOW_SAMPLES] = {0};
  float bufY[FAST_WINDOW_SAMPLES] = {0};
  float bufZ[FAST_WINDOW_SAMPLES] = {0};
  size_t head = 0;
  size_t count = 0;
  double sumX = 0;
  double sumY = 0;
  double sumZ = 0;
  double sumSqX = 0;
  double sumSqY = 0;
  double sumSqZ = 0;

  void addSample(float x, float y, float z) {
    if (count == FAST_WINDOW_SAMPLES) {
      float oldX = bufX[head];
      float oldY = bufY[head];
      float oldZ = bufZ[head];
      sumX -= oldX;
      sumY -= oldY;
      sumZ -= oldZ;
      sumSqX -= ((double)oldX * oldX);
      sumSqY -= ((double)oldY * oldY);
      sumSqZ -= ((double)oldZ * oldZ);
    } else {
      count++;
    }

    bufX[head] = x;
    bufY[head] = y;
    bufZ[head] = z;
    sumX += x;
    sumY += y;
    sumZ += z;
    sumSqX += ((double)x * x);
    sumSqY += ((double)y * y);
    sumSqZ += ((double)z * z);

    head = (head + 1) % FAST_WINDOW_SAMPLES;
  }

  void calculateRms(float &rmsX, float &rmsY, float &rmsZ, float &meanX, float &meanY, float &meanZ) const {
    if (count == 0) {
      rmsX = rmsY = rmsZ = meanX = meanY = meanZ = 0.0f;
      return;
    }
    double n = (double)count;
    meanX = (float)(sumX / n);
    meanY = (float)(sumY / n);
    meanZ = (float)(sumZ / n);

    double varX = (sumSqX / n) - ((double)meanX * meanX);
    double varY = (sumSqY / n) - ((double)meanY * meanY);
    double varZ = (sumSqZ / n) - ((double)meanZ * meanZ);

    rmsX = sqrtf(fmaxf(0.0f, (float)varX));
    rmsY = sqrtf(fmaxf(0.0f, (float)varY));
    rmsZ = sqrtf(fmaxf(0.0f, (float)varZ));
  }
};

// ==============================================================================
// 5-SECOND TELEMETRY ACCUMULATOR & SNAPSHOT DISPATCH
// ==============================================================================
struct FiveSecAccumulator {
  double sumX = 0;
  double sumY = 0;
  double sumZ = 0;
  double sumSqX = 0;
  double sumSqY = 0;
  double sumSqZ = 0;
  uint32_t sampleCount = 0;
  uint32_t i2cErrors = 0;
  uint32_t missedSlots = 0;

  void addSample(float x, float y, float z) {
    sumX += x;
    sumY += y;
    sumZ += z;
    sumSqX += ((double)x * x);
    sumSqY += ((double)y * y);
    sumSqZ += ((double)z * z);
    sampleCount++;
  }

  void reset() {
    sumX = sumY = sumZ = 0;
    sumSqX = sumSqY = sumSqZ = 0;
    sampleCount = 0;
    i2cErrors = 0;
    missedSlots = 0;
  }
};

struct TelemetrySnapshot {
  float meanX;
  float meanY;
  float meanZ;
  float rmsX;
  float rmsY;
  float rmsZ;
  uint32_t sampleCount;
  uint32_t missedSlots;
  uint32_t i2cErrors;
  float acquisitionQuality;
  float motorTemp;
  float ambientTemp;
  bool hasMotorTemp;
  bool hasAmbientTemp;
  bool hasVibration;
  char conditionStatus[16];
  char conditionReason[160];
  uint32_t timestampSec;
};

// FreeRTOS Queues, Mutexes, and Task Handles
QueueHandle_t telemetrySnapshotQueue = nullptr;
SemaphoreHandle_t i2cMutex = nullptr;
TaskHandle_t realtimeVibrationTaskHandle = nullptr;

// Non-Blocking LED Test State Machine
enum LedTestMode {
  LED_TEST_IDLE,
  LED_TEST_RUNNING_ALL,
  LED_TEST_RUNNING_SINGLE
};

volatile LedTestMode activeLedTest = LED_TEST_IDLE;
uint8_t testCurrentLedStep = 0;
uint32_t testStepEndMs = 0;
uint32_t testStepDurationMs = 500;
int activeSingleLedPin = -1;
String activeCommandId = "";

// Forward Declarations
void sendDeviceCommandAck(const char *commandId, const char *status, const char *resultJson, const char *errorMessage);
void pollDeviceCommands();
void updateLedOutputsImmediate();
void processBacklogQueue();
bool enforceStorageCeilingPolicy();

uint8_t bcd2dec(uint8_t val) { return (val / 16 * 10) + (val % 16); }
uint8_t dec2bcd(uint8_t val) { return ((val / 10) << 4) | (val % 10); }

// ==============================================================================
// HARDWARE I2C ACCESS WRAPPERS (MUTEX PROTECTED)
// ==============================================================================
bool writeRegister(uint8_t reg, uint8_t value) {
  if (i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(5)) != pdTRUE) {
    return false;
  }
  Wire.beginTransmission(ADXL345_I2C_ADDR);
  Wire.write(reg);
  Wire.write(value);
  bool ok = (Wire.endTransmission() == 0);
  if (i2cMutex) xSemaphoreGive(i2cMutex);
  return ok;
}

bool readRegisters(uint8_t reg, uint8_t *buffer, size_t length) {
  if (i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(5)) != pdTRUE) {
    return false;
  }
  Wire.beginTransmission(ADXL345_I2C_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    if (i2cMutex) xSemaphoreGive(i2cMutex);
    return false;
  }

  size_t received = Wire.requestFrom((uint8_t)ADXL345_I2C_ADDR, (size_t)length, true);
  if (received != length) {
    while (Wire.available()) Wire.read();
    if (i2cMutex) xSemaphoreGive(i2cMutex);
    return false;
  }

  for (size_t i = 0; i < length; i++) {
    buffer[i] = Wire.read();
  }
  if (i2cMutex) xSemaphoreGive(i2cMutex);
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
    delay(20);
  }

  if (!detected) {
    if (verbose) {
      Serial.printf("[ADXL345] WARNING: Sensor not detected on I2C 0x%02X (ID=0x%02X, expected 0xE5).\n",
                    ADXL345_I2C_ADDR, deviceId);
    }
    adxlReady = false;
    adxlError = (deviceId != 0x00 && deviceId != 0xFF);
    if (diagTracker.lastAdxlState != "fault") {
      String prevState = diagTracker.lastAdxlState;
      diagTracker.lastAdxlState = "fault";
      char detBuf[48];
      snprintf(detBuf, sizeof(detBuf), "{\"i2c_addr\":\"0x53\",\"dev_id\":\"0x%02X\"}", deviceId);
      logDiagnosticEvent("adxl345", "ADXL345_NOT_RESPONDING", "error", prevState.c_str(), "fault", "ADXL345 I2C communication failed or invalid DEVID", detBuf, false);
    }
    return false;
  }

  if (verbose) {
    Serial.printf("[ADXL345] OK: Sensor detected (Device ID: 0x%02X).\n", deviceId);
  }

  writeRegister(REG_POWER_CTL, 0x00);
  writeRegister(REG_BW_RATE, 0x0B);            // 200 Hz output data rate
  writeRegister(REG_DATA_FORMAT, 0x08 | 0x03); // Full-res, +/-16g scale
  writeRegister(REG_POWER_CTL, 0x08);          // Begin measurement mode

  adxlReady = true;
  adxlError = false;
  if (diagTracker.lastAdxlState != "operational") {
    String prevState = diagTracker.lastAdxlState;
    diagTracker.lastAdxlState = "operational";
    logDiagnosticEvent("adxl345", "ADXL345_RECOVERED", "info", prevState.c_str(), "operational", "ADXL345 accelerometer communication verified at 200 Hz", nullptr, true);
  }
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

// ==============================================================================
// DS3231 HARDWARE RTC & TIME SYNCHRONIZATION
// ==============================================================================
bool initialiseDS3231(bool verbose = true) {
  if (i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(10)) != pdTRUE) return false;

  Wire.beginTransmission(DS3231_I2C_ADDR);
  if (Wire.endTransmission() != 0) {
    if (verbose) Serial.println("[DS3231] WARNING: RTC module not detected on I2C address 0x68.");
    rtcReady = false;
    rtcStatus = "not_detected";
    if (diagTracker.lastRtcState != "not_detected") {
      String prevState = diagTracker.lastRtcState;
      diagTracker.lastRtcState = "not_detected";
      logDiagnosticEvent("rtc", "RTC_INVALID", "warning", prevState.c_str(), "not_detected", "DS3231 RTC not detected on I2C address 0x68", nullptr, false);
    }
    if (i2cMutex) xSemaphoreGive(i2cMutex);
    return false;
  }

  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x0F);
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom((uint8_t)DS3231_I2C_ADDR, (size_t)1, true) == 1) {
    uint8_t statusReg = Wire.read();
    rtcStatus = (statusReg & 0x80) ? "time_lost" : "ready";
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
      if (verbose) {
        Serial.printf("[DS3231] OK: Hardware RTC clock valid: %04d-%02d-%02dT%02d:%02d:%02dZ\n",
                      y, mo, d, h, m, s);
      }
      if (diagTracker.lastRtcState != "ready") {
        String prevState = diagTracker.lastRtcState;
        diagTracker.lastRtcState = "ready";
        logDiagnosticEvent("rtc", "RTC_RECOVERED", "info", prevState.c_str(), "ready", "DS3231 hardware clock validated and running", nullptr, true);
      }
      // Seed ESP32 internal system time so getRtcIsoTimestamp() requires NO I2C access
      struct tm t = {};
      t.tm_year = y - 1900;
      t.tm_mon = mo - 1;
      t.tm_mday = d;
      t.tm_hour = h;
      t.tm_min = m;
      t.tm_sec = s;
      time_t epoch = mktime(&t);
      if (epoch > 0) {
        struct timeval tv = { .tv_sec = epoch, .tv_usec = 0 };
        settimeofday(&tv, nullptr);
      }
    } else {
      rtcReady = false;
      rtcStatus = "invalid_time";
      if (diagTracker.lastRtcState != "invalid_time") {
        String prevState = diagTracker.lastRtcState;
        diagTracker.lastRtcState = "invalid_time";
        logDiagnosticEvent("rtc", "RTC_INVALID", "warning", prevState.c_str(), "invalid_time", "DS3231 oscillator stopped or invalid date (<2025)", nullptr, false);
      }
    }
  }

  if (i2cMutex) xSemaphoreGive(i2cMutex);
  return rtcReady;
}

String getRtcIsoTimestamp() {
  // Uses ESP32 monotonic clock synchronized to DS3231/NTP: 0 I2C traffic, 0 latency!
  time_t now = time(nullptr);
  if (now > 1735689600) {
    struct tm *tm_info = gmtime(&now);
    if (tm_info) {
      char buf[32];
      strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", tm_info);
      return String(buf);
    }
  }
  return "";
}

void syncRtcFromNtp() {
  time_t now = time(nullptr);
  if (now < 1735689600) return;

  struct tm *tm_info = gmtime(&now);
  if (!tm_info) return;

  if (i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
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
    xSemaphoreGive(i2cMutex);
    Serial.printf("[DS3231] Successfully updated hardware RTC from NTP: %04d-%02d-%02dT%02d:%02d:%02dZ\n",
                  y, mo, d, h, m, s);
  }
}

// ==============================================================================
// FAST LOCAL CONDITION EVALUATION (CALLED EVERY 250 MS ON CORE 0)
// ==============================================================================
void fastEvaluateCondition(
    float maxFastRms, float motorT, float ambT,
    bool hasVib, bool hasMotor, bool hasAmb
) {
  uint64_t evalStartUs = esp_timer_get_time();

  String evaluated = "GOOD";
  String reason = "Normal baseline: vibration and thermal rise within nominal limits.";

  if (!hasVib && !hasMotor) {
    evaluated = "UNKNOWN";
    reason = "Sensors offline: ADXL345 and Motor Temperature probe unavailable.";
  } else {
    // 1. Evaluate Vibration Severity
    if (hasVib) {
      if (maxFastRms >= alertThresholds.rms_critical_g) {
        evaluated = "CRITICAL";
        reason = String("CRITICAL: Severe vibration (Max RMS: ") + String(maxFastRms, 3) + "g >= " + String(alertThresholds.rms_critical_g, 2) + "g).";
      } else if (maxFastRms >= alertThresholds.rms_warning_g) {
        evaluated = "WARNING";
        reason = String("WARNING: High vibration (Max RMS: ") + String(maxFastRms, 3) + "g >= " + String(alertThresholds.rms_warning_g, 2) + "g).";
      } else if (maxFastRms >= alertThresholds.rms_caution_g) {
        evaluated = "CHECK";
        reason = String("CAUTION: Elevated vibration (Max RMS: ") + String(maxFastRms, 3) + "g).";
      }
    }

    // 2. Evaluate Motor Temperature & Differential
    if (hasMotor) {
      if (motorT >= alertThresholds.motor_temp_critical_c) {
        evaluated = "CRITICAL";
        reason = String("CRITICAL: Stator overheating (") + String(motorT, 1) + "C).";
      } else if (motorT >= alertThresholds.motor_temp_warning_c && evaluated != "CRITICAL") {
        evaluated = "WARNING";
        reason = String("WARNING: High stator temperature (") + String(motorT, 1) + "C).";
      } else if (motorT >= alertThresholds.motor_temp_caution_c && evaluated == "GOOD") {
        evaluated = "CHECK";
        reason = String("CAUTION: Elevated stator temperature (") + String(motorT, 1) + "C).";
      }

      if (hasAmb) {
        float deltaT = motorT - ambT;
        if (deltaT >= 35.0f) {
          evaluated = "CRITICAL";
          reason = String("CRITICAL: Extreme thermal rise (+") + String(deltaT, 1) + "C).";
        } else if (deltaT >= 25.0f && evaluated != "CRITICAL") {
          evaluated = "WARNING";
          reason = String("WARNING: Elevated thermal rise (+") + String(deltaT, 1) + "C).";
        }
      }
    }
  }

  // Fast Debounce & Escalation State Machine
  if (evaluated == "CRITICAL") {
    // Immediate escalation on safety hazard: 0 confirmation delay
    currentCondition = evaluated;
    currentConditionReason = reason;
    pendingCondition = evaluated;
    conditionPersistenceCount = 0;
  } else if (evaluated == pendingCondition) {
    conditionPersistenceCount++;
    if (conditionPersistenceCount >= CONDITION_PERSISTENCE_THRESHOLD) {
      currentCondition = evaluated;
      currentConditionReason = reason;
    }
  } else {
    pendingCondition = evaluated;
    conditionPersistenceCount = 1;
  }

  // Update physical LEDs immediately after condition decision
  uint64_t ledStartUs = esp_timer_get_time();
  updateLedOutputsImmediate();
  perfMetrics.conditionToLedLatencyUs = (uint32_t)(esp_timer_get_time() - ledStartUs);
  perfMetrics.fastRmsCalcDurationUs = (uint32_t)(esp_timer_get_time() - evalStartUs);
}

// ==============================================================================
// IMMEDIATE LED OUTPUT DRIVER (TARGET: < 20 MS LATENCY AFTER CONDITION DECISION)
// ==============================================================================
void updateLedOutputsImmediate() {
  uint32_t now = millis();

  // Safety Override Rule: CRITICAL condition always overrides website test sequences!
  if (currentCondition == "CRITICAL") {
    if (activeLedTest != LED_TEST_IDLE) {
      activeLedTest = LED_TEST_IDLE; // Abort diagnostic test immediately
      if (activeCommandId.length() > 0) {
        sendDeviceCommandAck(activeCommandId.c_str(), "FAILED", nullptr, "Safety override: CRITICAL vibration condition detected");
        activeCommandId = "";
      }
    }
  }

  // Sensor Health Status
  bool adxlOk = adxlReady && !adxlError;
  bool motorTempOk = motorProbeFound && motorTempValid;
  bool ambientTempOk = ambientProbeFound && ambientTempValid;
  bool rtcOk = rtcReady;
  bool anySensorFault = (!adxlOk) || (!motorTempOk) || (!ambientTempOk) || (!rtcOk);

  bool wifiOk = (WiFi.status() == WL_CONNECTED);
  bool networkFresh = (lastSuccessfulUploadMs > 0 && (now - lastSuccessfulUploadMs) <= 25000);

  // 1. STATUS LEDS: Red (GPIO 17) & Green (GPIO 18)
  if (currentCondition == "CRITICAL") {
    // Critical out-of-control vibration: Red SOLID ON, Green OFF
    digitalWrite(PIN_LED_RED_FAULT, HIGH);
    digitalWrite(PIN_LED_GREEN_HEALTHY, LOW);
  } else if (currentCondition == "WARNING") {
    // Vibration warning: Red fast blink (2 Hz: 250ms ON / 250ms OFF)
    bool fastBlink = ((now / 250) % 2 == 0);
    digitalWrite(PIN_LED_RED_FAULT, fastBlink ? HIGH : LOW);
    digitalWrite(PIN_LED_GREEN_HEALTHY, (wifiOk && networkFresh) ? HIGH : (fastBlink ? HIGH : LOW));
  } else if (anySensorFault) {
    // Sensor fault: Red slow blink (1 Hz: 500ms ON / 500ms OFF)
    bool slowBlink = ((now / 500) % 2 == 0);
    digitalWrite(PIN_LED_RED_FAULT, slowBlink ? HIGH : LOW);
    if (wifiOk && networkFresh) {
      digitalWrite(PIN_LED_GREEN_HEALTHY, HIGH);
    } else {
      digitalWrite(PIN_LED_GREEN_HEALTHY, slowBlink ? HIGH : LOW);
    }
  } else {
    // No faults or warnings: Red OFF
    digitalWrite(PIN_LED_RED_FAULT, LOW);
    if (wifiOk && networkFresh) {
      // Everything OK & Wi-Fi connected: Green SOLID ON
      digitalWrite(PIN_LED_GREEN_HEALTHY, HIGH);
    } else {
      // Everything OK locally, but Wi-Fi disconnected / offline: Green SLOW BLINK (1 Hz: 500ms ON / 500ms OFF)
      bool greenBlink = ((now / 500) % 2 == 0);
      digitalWrite(PIN_LED_GREEN_HEALTHY, greenBlink ? HIGH : LOW);
    }
  }

  // Force LED 5 (GPIO 16) LOW as it is physically unpopulated on test bench
  digitalWrite(PIN_TEST_LED_5, LOW);

  // Website Diagnostic Test Routine (If active and not CRITICAL)
  if (activeLedTest == LED_TEST_RUNNING_ALL) {
    if (now >= testStepEndMs) {
      testCurrentLedStep++;
      if (testCurrentLedStep >= 4) { // Cycle through 4 physical LEDs (1 to 4)
        for (size_t i = 0; i < TEST_LED_COUNT; i++) digitalWrite(TEST_LEDS[i], LOW);
        activeLedTest = LED_TEST_IDLE;
        sendDeviceCommandAck(activeCommandId.c_str(), "SUCCEEDED", "{\"leds_tested\":4}", nullptr);
        activeCommandId = "";
      } else {
        for (size_t i = 0; i < 4; i++) {
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

  // 2. DIAGNOSTIC MODE: SENSOR FAULT INDICATION ON TEST LEDS 1-4
  // Distinctive double-pulse blink indicates exactly which sensor has an error
  if (anySensorFault && currentCondition != "CRITICAL") {
    uint32_t cycleMs = now % 1000;
    // Double pulse: 120ms ON, 120ms OFF, 120ms ON, 640ms OFF
    bool doublePulse = (cycleMs < 120) || (cycleMs >= 240 && cycleMs < 360);

    // LED 1 (GPIO 4): ADXL345 Accelerometer error
    digitalWrite(PIN_TEST_LED_1, (!adxlOk && doublePulse) ? HIGH : LOW);

    // LED 2 (GPIO 5): Motor DS18B20 Temp Probe error (GPIO 10)
    digitalWrite(PIN_TEST_LED_2, (!motorTempOk && doublePulse) ? HIGH : LOW);

    // LED 3 (GPIO 6): Ambient DS18B20 Temp Probe error (GPIO 11)
    digitalWrite(PIN_TEST_LED_3, (!ambientTempOk && doublePulse) ? HIGH : LOW);

    // LED 4 (GPIO 7): DS3231 RTC Module error (I2C 0x68)
    digitalWrite(PIN_TEST_LED_4, (!rtcOk && doublePulse) ? HIGH : LOW);

    return;
  }

  // 3. NORMAL VIBRATION METER / VARIATION LEVEL (All sensors healthy)
  // Dynamic scale:
  // - RMS < 0.04g: LED 1 OFF (Quiet / normal baseline)
  // - 0.04g <= RMS < 0.08g: LED 1 Slow Blink (1 Hz, small variation)
  // - 0.08g <= RMS < 0.15g: LED 1 ON, LED 2 Medium Blink (3 Hz, moderate vibration)
  // - 0.15g <= RMS < 0.25g: LED 1 ON, LED 2 ON, LED 3 Fast Blink (6 Hz, warning vibration)
  // - RMS >= 0.25g or CRITICAL: LEDs 1, 2, 3, 4 Continuous Solid ON (Out-of-control vibration)
  float rms = currentFastMaxRms;

  if (currentCondition == "CRITICAL" || rms >= alertThresholds.rms_critical_g || rms >= 0.25f) {
    digitalWrite(PIN_TEST_LED_1, HIGH);
    digitalWrite(PIN_TEST_LED_2, HIGH);
    digitalWrite(PIN_TEST_LED_3, HIGH);
    digitalWrite(PIN_TEST_LED_4, HIGH);
  } else if (rms >= 0.15f) {
    bool fastBlink = ((now / 80) % 2 == 0);
    digitalWrite(PIN_TEST_LED_1, HIGH);
    digitalWrite(PIN_TEST_LED_2, HIGH);
    digitalWrite(PIN_TEST_LED_3, fastBlink ? HIGH : LOW);
    digitalWrite(PIN_TEST_LED_4, LOW);
  } else if (rms >= 0.08f) {
    bool medBlink = ((now / 160) % 2 == 0);
    digitalWrite(PIN_TEST_LED_1, HIGH);
    digitalWrite(PIN_TEST_LED_2, medBlink ? HIGH : LOW);
    digitalWrite(PIN_TEST_LED_3, LOW);
    digitalWrite(PIN_TEST_LED_4, LOW);
  } else if (rms >= 0.04f) {
    bool slowBlink = ((now / 500) % 2 == 0);
    digitalWrite(PIN_TEST_LED_1, slowBlink ? HIGH : LOW);
    digitalWrite(PIN_TEST_LED_2, LOW);
    digitalWrite(PIN_TEST_LED_3, LOW);
    digitalWrite(PIN_TEST_LED_4, LOW);
  } else {
    // Quiet / baseline OK -> LED 1 OFF
    digitalWrite(PIN_TEST_LED_1, LOW);
    digitalWrite(PIN_TEST_LED_2, LOW);
    digitalWrite(PIN_TEST_LED_3, LOW);
    digitalWrite(PIN_TEST_LED_4, LOW);
  }
}

// ==============================================================================
// REAL-TIME HARDWARE SAMPLING TASK (CORE 0 — 200 HZ CONTINUOUS, NEVER BLOCKED)
// ==============================================================================
void realtimeVibrationTask(void *parameter) {
  RollingWindowAccumulator rollingVibe;
  FiveSecAccumulator fiveSecVibe;

  TickType_t lastWakeTime = xTaskGetTickCount();
  const TickType_t periodTicks = pdMS_TO_TICKS(5) > 0 ? pdMS_TO_TICKS(5) : 1;

  uint64_t lastSampleTimeUs = esp_timer_get_time();
  size_t fastEvalCounter = 0;
  size_t fiveSecCounter = 0;

  for (;;) {
    uint64_t nowUs = esp_timer_get_time();
    uint32_t intervalUs = (uint32_t)(nowUs - lastSampleTimeUs);
    lastSampleTimeUs = nowUs;

    // Track sample interval metrics
    perfMetrics.sampleIntervalUs = intervalUs;
    if (intervalUs > perfMetrics.maxSampleIntervalUs) perfMetrics.maxSampleIntervalUs = intervalUs;
    if (intervalUs < perfMetrics.minSampleIntervalUs && intervalUs > 0) perfMetrics.minSampleIntervalUs = intervalUs;

    uint64_t sampleStartUs = esp_timer_get_time();

    if (adxlReady) {
      float ax, ay, az;
      if (readAcceleration(ax, ay, az)) {
        rollingVibe.addSample(ax, ay, az);
        fiveSecVibe.addSample(ax, ay, az);
      } else {
        fiveSecVibe.i2cErrors++;
      }
    } else {
      fiveSecVibe.missedSlots++;
      perfMetrics.missedSampleSlots++;
    }

    uint32_t execUs = (uint32_t)(esp_timer_get_time() - sampleStartUs);
    perfMetrics.sampleExecDurationUs = execUs;
    if (execUs > perfMetrics.maxSampleExecDurationUs) perfMetrics.maxSampleExecDurationUs = execUs;

    fastEvalCounter++;
    fiveSecCounter++;

    // 1. FAST LOCAL CONDITION EVALUATION: Every 50 samples = 250 ms!
    if (fastEvalCounter >= FAST_WINDOW_SAMPLES) {
      fastEvalCounter = 0;

      float fastRmsX, fastRmsY, fastRmsZ, fastMeanX, fastMeanY, fastMeanZ;
      rollingVibe.calculateRms(fastRmsX, fastRmsY, fastRmsZ, fastMeanX, fastMeanY, fastMeanZ);
      float fastMaxRms = fmaxf(fastRmsX, fmaxf(fastRmsY, fastRmsZ));
      currentFastMaxRms = fastMaxRms;
      bool hasVib = (adxlReady && rollingVibe.count >= 10);

      fastEvaluateCondition(
          fastMaxRms, currentMotorTemp, currentAmbientTemp,
          hasVib, motorTempValid, ambientTempValid
      );
    }

    // 2. 5-SECOND TELEMETRY SNAPSHOT DISPATCH: Every 1000 samples = 5.0 seconds!
    if (fiveSecCounter >= 1000) {
      fiveSecCounter = 0;

      TelemetrySnapshot snap;
      snap.sampleCount = fiveSecVibe.sampleCount;
      snap.missedSlots = fiveSecVibe.missedSlots;
      snap.i2cErrors = fiveSecVibe.i2cErrors;
      snap.hasVibration = (adxlReady && snap.sampleCount >= 10);

      if (snap.hasVibration) {
        snap.meanX = (float)(fiveSecVibe.sumX / snap.sampleCount);
        snap.meanY = (float)(fiveSecVibe.sumY / snap.sampleCount);
        snap.meanZ = (float)(fiveSecVibe.sumZ / snap.sampleCount);

        double varX = (fiveSecVibe.sumSqX / snap.sampleCount) - ((double)snap.meanX * snap.meanX);
        double varY = (fiveSecVibe.sumSqY / snap.sampleCount) - ((double)snap.meanY * snap.meanY);
        double varZ = (fiveSecVibe.sumSqZ / snap.sampleCount) - ((double)snap.meanZ * snap.meanZ);

        snap.rmsX = sqrtf(fmaxf(0.0f, (float)varX));
        snap.rmsY = sqrtf(fmaxf(0.0f, (float)varY));
        snap.rmsZ = sqrtf(fmaxf(0.0f, (float)varZ));
      } else {
        snap.meanX = snap.meanY = snap.meanZ = 0.0f;
        snap.rmsX = snap.rmsY = snap.rmsZ = 0.0f;
      }

      snap.acquisitionQuality = snap.hasVibration ? fminf(1.0f, (float)snap.sampleCount / 1000.0f) : 0.0f;
      snap.motorTemp = currentMotorTemp;
      snap.ambientTemp = currentAmbientTemp;
      snap.hasMotorTemp = motorTempValid;
      snap.hasAmbientTemp = ambientTempValid;
      snap.timestampSec = (uint32_t)time(nullptr);
      strncpy(snap.conditionStatus, currentCondition.c_str(), sizeof(snap.conditionStatus) - 1);
      strncpy(snap.conditionReason, currentConditionReason.c_str(), sizeof(snap.conditionReason) - 1);

      // Dispatch to background queue without blocking Core 0
      if (telemetrySnapshotQueue) {
        if (xQueueSend(telemetrySnapshotQueue, &snap, 0) != pdTRUE) {
          perfMetrics.queueOverflowCount++;
        }
      }

      fiveSecVibe.reset();
    }

    // Refresh LED blink/flash states continuously
    updateLedOutputsImmediate();

    perfMetrics.realtimeTaskStackWatermark = uxTaskGetStackHighWaterMark(nullptr);

    vTaskDelayUntil(&lastWakeTime, periodTicks);
  }
}

// ==============================================================================
// STORAGE SUBSYSTEM: MICROSD PRIMARY + LITTLEFS FLASH FALLBACK
// ==============================================================================
float calculateStorageUsage(uint64_t totalBytes, uint64_t usedBytes) {
  if (totalBytes == 0) return 0.0f;
  return ((float)usedBytes * 100.0f) / (float)totalBytes;
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
    storageUsedPct = calculateStorageUsage(SD.totalBytes(), SD.usedBytes());
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
    storageUsedPct = calculateStorageUsage(LittleFS.totalBytes(), LittleFS.usedBytes());
    storageMedium = "flash_littlefs";
  } else {
    storageMedium = "none";
    storageUsedPct = 0.0f;
  }

  unsyncedRecordsCount = count;
  oldestUnsyncedTimestamp = oldest;
}

bool initialiseLittleFSFallback() {
  if (littleFsReady) {
    storageUsedPct = calculateStorageUsage(LittleFS.totalBytes(), LittleFS.usedBytes());
    storageMedium = "flash_littlefs";
    return true;
  }
  if (LittleFS.begin(true)) {
    littleFsReady = true;
    storageUsedPct = calculateStorageUsage(LittleFS.totalBytes(), LittleFS.usedBytes());
    storageMedium = "flash_littlefs";

    if (!LittleFS.exists("/lfs_queue")) {
      LittleFS.mkdir("/lfs_queue");
    }
    Serial.printf("[LittleFS] OK: Bounded internal flash mounted (Used: %.1f%%)\n", storageUsedPct);
    return true;
  }
  littleFsReady = false;
  return false;
}

bool initialiseSDCard(bool verbose = true) {
  spiSD.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);

  if (!SD.begin(PIN_SD_CS, spiSD, SD_SPI_SPEED_HZ)) {
    if (verbose) Serial.printf("[SD] WARNING: MicroSD mount failed on CS %d. Using LittleFS.\n", PIN_SD_CS);
    sdCardReady = false;
    sdCardStatus = "missing";
    if (diagTracker.lastSdState != "missing") {
      String prevState = diagTracker.lastSdState;
      diagTracker.lastSdState = "missing";
      logDiagnosticEvent("sd_card", "SD_CARD_MISSING", "warning", prevState.c_str(), "missing", "MicroSD mount failed on CS; LittleFS flash buffer active", nullptr, false);
    }
    if (!littleFsReady) initialiseLittleFSFallback();
    scanOfflineQueue();
    return false;
  }

  if (SD.cardType() == CARD_NONE) {
    if (verbose) Serial.println("[SD] WARNING: No card attached. Using LittleFS.");
    sdCardReady = false;
    sdCardStatus = "missing";
    if (diagTracker.lastSdState != "missing") {
      String prevState = diagTracker.lastSdState;
      diagTracker.lastSdState = "missing";
      logDiagnosticEvent("sd_card", "SD_CARD_MISSING", "warning", prevState.c_str(), "missing", "MicroSD card not detected in slot; LittleFS flash buffer active", nullptr, false);
    }
    if (!littleFsReady) initialiseLittleFSFallback();
    scanOfflineQueue();
    return false;
  }

  sdCardReady = true;
  sdCardStatus = "ready";
  storageMedium = "sd_card";
  storageUsedPct = calculateStorageUsage(SD.totalBytes(), SD.usedBytes());

  if (diagTracker.lastSdState != "ready") {
    String prevState = diagTracker.lastSdState;
    diagTracker.lastSdState = "ready";
    logDiagnosticEvent("sd_card", "SD_CARD_RECOVERED", "info", prevState.c_str(), "ready", "MicroSD card mounted and verified on SPI bus", nullptr, true);
  }

  if (verbose) {
    Serial.printf("[SD] OK: MicroSD mounted (Used: %.2f%%)\n", storageUsedPct);
  }

  if (!SD.exists("/queue")) SD.mkdir("/queue");
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

bool enforceStorageCeilingPolicy() {
  if (storageUsedPct < STORAGE_CEILING_LIMIT_PCT) return true;

  Serial.printf("[STORAGE-ALERT] Storage reached %.2f%% (>= 90%% ceiling). Pruning oldest records.\n", storageUsedPct);

  if (sdCardReady) {
    File dir = SD.open("/queue");
    if (dir && dir.isDirectory()) {
      File entry = dir.openNextFile();
      if (entry) {
        String path = String("/queue/") + entry.name();
        entry.close();
        dir.close();
        SD.remove(path.c_str());
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
        scanOfflineQueue();
        return (storageUsedPct < STORAGE_CEILING_LIMIT_PCT);
      }
      dir.close();
    }
  }

  droppedRecordsCount++;
  return false;
}

bool saveRecordToQueue(const String &recordId, const String &jsonPayload) {
  if (!enforceStorageCeilingPolicy()) return false;

  uint64_t sdStart = esp_timer_get_time();

  if (sdCardReady) {
    String filename = String("/queue/rec_") + recordId + ".json";
    File f = SD.open(filename.c_str(), FILE_WRITE);
    if (f) {
      f.print(jsonPayload);
      f.close();
      unsyncedRecordsCount++;
      perfMetrics.lastSdWriteDurationMs = (uint32_t)((esp_timer_get_time() - sdStart) / 1000);
      return true;
    }
    sdCardStatus = "write_error";
    if (diagTracker.lastSdState != "write_error") {
      String prevState = diagTracker.lastSdState;
      diagTracker.lastSdState = "write_error";
      logDiagnosticEvent("sd_card", "SD_CARD_WRITE_FAILED", "error", prevState.c_str(), "write_error", "Failed to write telemetry record to SD card", nullptr, false);
    }
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
      perfMetrics.lastSdWriteDurationMs = (uint32_t)((esp_timer_get_time() - sdStart) / 1000);
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
    int wifiRssi, const char *condStatus, const String &stgMedium, float stgUsed,
    bool synced
) {
  if (!sdCardReady) return false;

  uint64_t sdStart = esp_timer_get_time();
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
           sampleCount, quality, wifiRssi, condStatus, stgMedium.c_str(), stgUsed, synced ? "1" : "0");
  f.close();
  perfMetrics.lastSdWriteDurationMs = (uint32_t)((esp_timer_get_time() - sdStart) / 1000);
  return true;
}

// ==============================================================================
// ASYNCHRONOUS TEMPERATURE & BACKGROUND SENSING
// ==============================================================================
void discoverTemperatureProbes(bool verbose = true) {
  sensorMotor.begin();
  if (sensorMotor.getDeviceCount() > 0 && sensorMotor.getAddress(motorProbeAddress, 0)) {
    sensorMotor.setResolution(motorProbeAddress, 12);
    sensorMotor.setWaitForConversion(false);
    motorProbeFound = true;
    if (diagTracker.lastMotorTempState != "operational") {
      String prevState = diagTracker.lastMotorTempState;
      diagTracker.lastMotorTempState = "operational";
      logDiagnosticEvent("motor_temp", "MOTOR_TEMP_SENSOR_RECOVERED", "info", prevState.c_str(), "operational", "Motor DS18B20 probe detected on GPIO 10", nullptr, true);
    }
    if (verbose) Serial.println("[DS18B20-MOTOR] OK: Motor probe detected on GPIO 10.");
  } else {
    motorProbeFound = false;
    motorTempValid = false;
    if (diagTracker.lastMotorTempState != "missing") {
      String prevState = diagTracker.lastMotorTempState;
      diagTracker.lastMotorTempState = "missing";
      logDiagnosticEvent("motor_temp", "MOTOR_TEMP_SENSOR_MISSING", "warning", prevState.c_str(), "missing", "Motor DS18B20 probe not responding on 1-Wire GPIO 10", nullptr, false);
    }
  }

  sensorAmbient.begin();
  if (sensorAmbient.getDeviceCount() > 0 && sensorAmbient.getAddress(ambientProbeAddress, 0)) {
    sensorAmbient.setResolution(ambientProbeAddress, 12);
    sensorAmbient.setWaitForConversion(false);
    ambientProbeFound = true;
    if (diagTracker.lastAmbientTempState != "operational") {
      String prevState = diagTracker.lastAmbientTempState;
      diagTracker.lastAmbientTempState = "operational";
      logDiagnosticEvent("ambient_temp", "AMBIENT_TEMP_SENSOR_RECOVERED", "info", prevState.c_str(), "operational", "Ambient DS18B20 probe detected on GPIO 11", nullptr, true);
    }
    if (verbose) Serial.println("[DS18B20-AMBIENT] OK: Ambient probe detected on GPIO 11.");
  } else {
    ambientProbeFound = false;
    ambientTempValid = false;
    if (diagTracker.lastAmbientTempState != "missing") {
      String prevState = diagTracker.lastAmbientTempState;
      diagTracker.lastAmbientTempState = "missing";
      logDiagnosticEvent("ambient_temp", "AMBIENT_TEMP_SENSOR_MISSING", "warning", prevState.c_str(), "missing", "Ambient DS18B20 probe not responding on 1-Wire GPIO 11", nullptr, false);
    }
  }
}

void updateTemperaturesAsync() {
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
  // Re-probe SD card only every 120s if missing to prevent SPI bus mount timeout freezes
  if (!sdCardReady && (now - lastSdRetryMs >= 120000)) {
    lastSdRetryMs = now;
    initialiseSDCard(false);
  }
}

// ==============================================================================
// NON-BLOCKING WI-FI WITH EXPONENTIAL BACKOFF
// ==============================================================================
void startWiFiConnection() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[WIFI] Connecting to SSID: %s (non-blocking)...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptMs = millis();
}

void maintainWiFiAsync() {
  if (WiFi.status() == WL_CONNECTED) {
    if (diagTracker.lastWifiState != "connected") {
      String prevState = diagTracker.lastWifiState;
      diagTracker.lastWifiState = "connected";
      char ipBuf[64];
      snprintf(ipBuf, sizeof(ipBuf), "{\"ip\":\"%s\",\"rssi_dbm\":%d}",
               WiFi.localIP().toString().c_str(), WiFi.RSSI());
      logDiagnosticEvent("wifi", "WIFI_CONNECTED", "info", prevState.c_str(), "connected", "Wi-Fi associated and IP acquired", ipBuf, true);
    }
    wifiBackoffMs = 5000; // Reset backoff upon successful connection
    if (!rtcSynced && (millis() - lastNtpAttemptMs > 60000)) {
      lastNtpAttemptMs = millis();
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
      syncRtcFromNtp();
    }
    return;
  }

  if (diagTracker.lastWifiState == "connected") {
    diagTracker.lastWifiState = "disconnected";
    logDiagnosticEvent("wifi", "WIFI_DISCONNECTED", "warning", "connected", "disconnected", "Wi-Fi link dropped, entering reconnect backoff", nullptr, false);
  }

  uint32_t now = millis();
  if (now - lastWiFiAttemptMs >= wifiBackoffMs) {
    lastWiFiAttemptMs = now;
    Serial.printf("[WIFI] Reconnecting (backoff: %u ms)...\n", wifiBackoffMs);
    WiFi.disconnect();
    WiFi.reconnect();
    // Bounded exponential backoff up to 60s
    wifiBackoffMs = (wifiBackoffMs * 2 > 60000) ? 60000 : wifiBackoffMs * 2;
  }
}

// ==============================================================================
// HTTPS TELEMETRY & COMMAND PIPELINE (BACKGROUND CORE 1)
// ==============================================================================
int sendTelemetryPayload(const String &jsonPayload, String &responseBody) {
  uint64_t uploadStartUs = esp_timer_get_time();

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
    Serial.printf("[TELEMETRY] HTTP %d (Upload: %lu ms)\n",
                  httpCode, (unsigned long)((esp_timer_get_time() - uploadStartUs) / 1000));
    if (httpCode != 200 && httpCode != 201) {
      Serial.printf("[TELEMETRY-ERROR] %s\n", responseBody.c_str());
    }
  } else {
    responseBody = http.errorToString(httpCode);
    Serial.printf("[TELEMETRY] FAILED: %s\n", responseBody.c_str());
  }
  http.end();
  client.stop();

  perfMetrics.lastUploadDurationMs = (uint32_t)((esp_timer_get_time() - uploadStartUs) / 1000);
  return httpCode;
}

int sendDiagnosticEventPayload(const String &jsonPayload) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  WiFiClientSecure client;
  client.setCACert(VERCEL_ROOT_CA_CERT);

  HTTPClient http;
  http.begin(client, SERVER_EVENTS_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_INGEST_TOKEN);
  http.setTimeout(3500);

  int httpCode = http.POST(jsonPayload);
  if (httpCode > 0) {
    Serial.printf("[EVENT-UPLOAD] HTTP %d\n", httpCode);
  } else {
    Serial.printf("[EVENT-UPLOAD] FAILED: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
  client.stop();
  return httpCode;
}

bool saveDiagnosticEventToQueue(const String &eventId, const String &jsonPayload) {
  if (sdCardReady) {
    if (!SD.exists("/events")) SD.mkdir("/events");
    String filename = String("/events/ev_") + eventId + ".json";
    File f = SD.open(filename.c_str(), FILE_WRITE);
    if (f) {
      f.print(jsonPayload);
      f.close();
      return true;
    }
  }

  if (littleFsReady) {
    if (!LittleFS.exists("/lfs_events")) LittleFS.mkdir("/lfs_events");
    String filename = String("/lfs_events/ev_") + eventId + ".json";
    File f = LittleFS.open(filename.c_str(), FILE_WRITE);
    if (f) {
      f.print(jsonPayload);
      f.close();
      return true;
    }
  }
  return false;
}

void logDiagnosticEvent(
    const char *component,
    const char *eventCode,
    const char *severity,
    const char *prevState,
    const char *newState,
    const char *diagnosticMsg,
    const char *detailsJson,
    bool resolved
) {
  diagTracker.eventSequence++;
  char eventId[64];
  snprintf(eventId, sizeof(eventId), "evt-%s-%lu-%u",
           DEVICE_ID, (unsigned long)time(nullptr), diagTracker.eventSequence);

  String timestamp = getRtcIsoTimestamp();
  const char *tsSource = "rtc";
  if (timestamp.length() == 0) {
    time_t now = time(nullptr);
    if (now > 1735689600) {
      struct tm *tm_info = gmtime(&now);
      if (tm_info) {
        char buf[32];
        strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", tm_info);
        timestamp = String(buf);
        tsSource = "system";
      }
    }
  }
  if (timestamp.length() == 0) {
    uint32_t s = millis() / 1000;
    uint32_t mins = (s / 60) % 60;
    uint32_t secs = s % 60;
    uint32_t hrs = (s / 3600) % 24;
    char buf[32];
    snprintf(buf, sizeof(buf), "2026-01-01T%02u:%02u:%02uZ", hrs, mins, secs);
    timestamp = String(buf);
    tsSource = "system";
  } else if (rtcSynced) {
    tsSource = "ntp";
  }

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  DynamicJsonDocument doc(1024);
#endif

  doc["id"] = eventId;
  doc["device_id"] = DEVICE_ID;
  doc["component"] = component;
  doc["event_code"] = eventCode;
  doc["severity"] = severity;
  if (prevState) doc["previous_state"] = prevState;
  else doc["previous_state"] = nullptr;
  doc["new_state"] = newState;
  doc["event_timestamp"] = timestamp;
  doc["timestamp_source"] = tsSource;
  doc["diagnostic_message"] = diagnosticMsg;
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["resolved"] = resolved;

  if (detailsJson) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument detDoc;
#else
    StaticJsonDocument<256> detDoc;
#endif
    deserializeJson(detDoc, detailsJson);
    doc["details"] = detDoc.as<JsonObject>();
  } else {
    doc["details"] = nullptr;
  }

  String payload;
  serializeJson(doc, payload);

  Serial.printf("[DIAG-EVENT] [%s] %s (%s -> %s): %s\n",
                component, eventCode, prevState ? prevState : "none", newState, diagnosticMsg);

  // If connected, attempt direct upload
  if (WiFi.status() == WL_CONNECTED) {
    int httpCode = sendDiagnosticEventPayload(payload);
    if (httpCode >= 200 && httpCode < 300) {
      return;
    }
  }

  // Otherwise queue locally for resilient sync
  saveDiagnosticEventToQueue(String(eventId), payload);
}

void processEventsQueue() {
  if (WiFi.status() != WL_CONNECTED) return;
  uint32_t now = millis();
  if (now - diagTracker.lastEventSyncMs < 4000) return;
  if (now - lastSuccessfulUploadMs < 1500) return;
  diagTracker.lastEventSyncMs = now;

  // Process SD card events first
  if (sdCardReady) {
    File dir = SD.open("/events");
    if (dir && dir.isDirectory()) {
      File entry = dir.openNextFile();
      uint8_t count = 0;
      while (entry && count < 5) {
        if (!entry.isDirectory() && String(entry.name()).endsWith(".json")) {
          String filepath = String("/events/") + entry.name();
          String content = entry.readString();
          entry.close();

          int code = sendDiagnosticEventPayload(content);
          if ((code >= 200 && code < 300) || (code >= 400 && code < 500)) {
            SD.remove(filepath.c_str());
            count++;
          } else {
            break; // Stop batch if network failed
          }
        } else {
          entry.close();
        }
        entry = dir.openNextFile();
      }
      dir.close();
      if (count > 0) return;
    }
  }

  // Process LittleFS events
  if (littleFsReady) {
    File dir = LittleFS.open("/lfs_events");
    if (dir && dir.isDirectory()) {
      File entry = dir.openNextFile();
      uint8_t count = 0;
      while (entry && count < 5) {
        if (!entry.isDirectory() && String(entry.name()).endsWith(".json")) {
          String filepath = String("/lfs_events/") + entry.name();
          String content = entry.readString();
          entry.close();

          int code = sendDiagnosticEventPayload(content);
          if ((code >= 200 && code < 300) || (code >= 400 && code < 500)) {
            LittleFS.remove(filepath.c_str());
            count++;
          } else {
            break;
          }
        } else {
          entry.close();
        }
        entry = dir.openNextFile();
      }
      dir.close();
    }
  }
}

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
  http.POST(ackPayload);
  http.end();
  client.stop();
}

void pollDeviceCommands() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (activeLedTest != LED_TEST_IDLE) return;

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

        Serial.printf("[COMMAND] Processing: %s (%s)\n", cmdId, cmdType);

        if (strcmp(cmdType, "LED_TEST_ALL") == 0) {
          activeCommandId = String(cmdId);
          activeLedTest = LED_TEST_RUNNING_ALL;
          testCurrentLedStep = 0;
          testStepDurationMs = params["step_duration_ms"] | 500;
          testStepEndMs = millis() + testStepDurationMs;
          for (size_t i = 0; i < TEST_LED_COUNT; i++) {
            digitalWrite(TEST_LEDS[i], (i == 0) ? HIGH : LOW);
          }
          sendDeviceCommandAck(cmdId, "EXECUTING", "{\"state\":\"running_all\"}", nullptr);
          break;
        } else if (strcmp(cmdType, "LED_TEST_SINGLE") == 0) {
          int ledIndex = params["led_index"] | 1;
          if (ledIndex >= 1 && ledIndex <= 5) {
            activeCommandId = String(cmdId);
            activeLedTest = LED_TEST_RUNNING_SINGLE;
            activeSingleLedPin = TEST_LEDS[ledIndex - 1];
            testStepDurationMs = params["duration_ms"] | 1000;
            testStepEndMs = millis() + testStepDurationMs;
            for (size_t i = 0; i < TEST_LED_COUNT; i++) {
              digitalWrite(TEST_LEDS[i], (TEST_LEDS[i] == activeSingleLedPin) ? HIGH : LOW);
            }
            sendDeviceCommandAck(cmdId, "EXECUTING", "{\"state\":\"pulsing_single\"}", nullptr);
            break;
          } else {
            sendDeviceCommandAck(cmdId, "FAILED", nullptr, "Invalid led_index. Must be 1 to 5.");
          }
        } else if (strcmp(cmdType, "STATUS_REQUEST") == 0) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
          JsonDocument statusRes;
#else
          StaticJsonDocument<512> statusRes;
#endif
          statusRes["uptime_s"] = millis() / 1000;
          statusRes["condition"] = currentCondition;
          statusRes["sample_interval_us"] = perfMetrics.sampleIntervalUs;
          statusRes["fast_rms_calc_us"] = perfMetrics.fastRmsCalcDurationUs;
          statusRes["condition_to_led_us"] = perfMetrics.conditionToLedLatencyUs;
          statusRes["upload_duration_ms"] = perfMetrics.lastUploadDurationMs;
          statusRes["sd_write_ms"] = perfMetrics.lastSdWriteDurationMs;
          statusRes["missed_slots"] = perfMetrics.missedSampleSlots;
          statusRes["core0_stack_free"] = perfMetrics.realtimeTaskStackWatermark;

          String resJson;
          serializeJson(statusRes, resJson);
          sendDeviceCommandAck(cmdId, "SUCCEEDED", resJson.c_str(), nullptr);
        } else if (strcmp(cmdType, "SENSOR_DIAGNOSTIC") == 0) {
          bool adxl = initialiseADXL345(false);
          sendDeviceCommandAck(cmdId, "SUCCEEDED", adxl ? "{\"adxl345\":\"ready\"}" : "{\"adxl345\":\"error\"}", nullptr);
        } else if (strcmp(cmdType, "SYNC_STATUS_REQUEST") == 0) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
          JsonDocument syncRes;
#else
          StaticJsonDocument<256> syncRes;
#endif
          syncRes["storage_medium"] = storageMedium;
          syncRes["storage_used_pct"] = storageUsedPct;
          syncRes["unsynced_count"] = unsyncedRecordsCount;
          syncRes["dropped_count"] = droppedRecordsCount;
          String resJson;
          serializeJson(syncRes, resJson);
          sendDeviceCommandAck(cmdId, "SUCCEEDED", resJson.c_str(), nullptr);
        } else if (strcmp(cmdType, "SET_ALERT_THRESHOLDS") == 0) {
          if (params.containsKey("rms_warning_g")) alertThresholds.rms_warning_g = params["rms_warning_g"];
          if (params.containsKey("rms_critical_g")) alertThresholds.rms_critical_g = params["rms_critical_g"];
          if (params.containsKey("motor_temp_warning_c")) alertThresholds.motor_temp_warning_c = params["motor_temp_warning_c"];
          if (params.containsKey("motor_temp_critical_c")) alertThresholds.motor_temp_critical_c = params["motor_temp_critical_c"];
          sendDeviceCommandAck(cmdId, "SUCCEEDED", "{\"thresholds_updated\":true}", nullptr);
        } else {
          sendDeviceCommandAck(cmdId, "FAILED", nullptr, "Unsupported command_type");
        }
      }
    }
  }
  http.end();
  client.stop();
}

void processBacklogQueue() {
  if (WiFi.status() != WL_CONNECTED) return;
  uint32_t now = millis();
  if (now < nextBacklogUploadAttemptMs) return;
  if (now - lastSuccessfulUploadMs < 2000) return;

  auto processEntry = [&](bool isSD, const char *dirPath, const char *quarPath) -> bool {
    File dir = isSD ? SD.open(dirPath) : LittleFS.open(dirPath);
    if (!dir || !dir.isDirectory()) return false;

    File entry = dir.openNextFile();
    if (!entry) {
      dir.close();
      unsyncedRecordsCount = 0;
      return false;
    }

    String path = String(dirPath) + "/" + entry.name();
    String entryName = String(entry.name());
    String content = "";
    while (entry.available()) content += (char)entry.read();
    entry.close();
    dir.close();

    if (content.length() == 0) {
      if (isSD) SD.remove(path.c_str());
      else LittleFS.remove(path.c_str());
      if (unsyncedRecordsCount > 0) unsyncedRecordsCount--;
      return true;
    }

    String resStr;
    int httpCode = sendTelemetryPayload(content, resStr);

    if ((httpCode >= 200 && httpCode < 300) || httpCode == 409) {
      // 2xx or 409: Confirmed accepted / idempotent duplicate already persisted
      if (isSD) SD.remove(path.c_str());
      else LittleFS.remove(path.c_str());
      if (unsyncedRecordsCount > 0) unsyncedRecordsCount--;
      recordsAcceptedCount++;
      backlogBackoffMs = 400;
      nextBacklogUploadAttemptMs = now + 400;
      return true;
    } else if (httpCode == 400 || httpCode == 422) {
      // 400/422: Malformed payload / schema mismatch. Quarantine so queue is not blocked
      Serial.printf("[QUEUE] Quarantining invalid record %s (HTTP %d): %s\n", path.c_str(), httpCode, resStr.c_str());
      if (isSD) {
        if (!SD.exists(quarPath)) SD.mkdir(quarPath);
        String qPath = String(quarPath) + "/" + entryName;
        File qf = SD.open(qPath.c_str(), FILE_WRITE);
        if (qf) {
          qf.print(content);
          qf.close();
        }
        SD.remove(path.c_str());
      } else {
        if (!LittleFS.exists(quarPath)) LittleFS.mkdir(quarPath);
        String qPath = String(quarPath) + "/" + entryName;
        File qf = LittleFS.open(qPath.c_str(), FILE_WRITE);
        if (qf) {
          qf.print(content);
          qf.close();
        }
        LittleFS.remove(path.c_str());
      }
      if (unsyncedRecordsCount > 0) unsyncedRecordsCount--;
      recordsQuarantinedCount++;
      backlogBackoffMs = 400;
      nextBacklogUploadAttemptMs = now + 400;
      return true;
    } else if (httpCode == 401 || httpCode == 403) {
      // 401/403: Auth failure. DO NOT DISCARD. Preserve in queue, alert operator, backoff 30s
      Serial.printf("[QUEUE-AUTH-ALERT] HTTP %d Auth failure! Preserving backlog data. Retrying in 30s.\n", httpCode);
      recordsPreservedCount++;
      nextBacklogUploadAttemptMs = now + 30000;
      return false;
    } else if (httpCode == 429) {
      // 429: Rate limited. Preserve and backoff 15s
      Serial.printf("[QUEUE] Rate limit exceeded (HTTP 429). Retrying in 15s.\n");
      recordsRetriedCount++;
      nextBacklogUploadAttemptMs = now + 15000;
      return false;
    } else {
      // 408, 5xx, or network timeout/socket error: Retry with bounded exponential backoff
      recordsRetriedCount++;
      backlogBackoffMs = (backlogBackoffMs * 2 > 60000) ? 60000 : backlogBackoffMs * 2;
      Serial.printf("[QUEUE] Transient error (HTTP %d). Backing off %u ms.\n", httpCode, backlogBackoffMs);
      nextBacklogUploadAttemptMs = now + backlogBackoffMs;
      return false;
    }
  };

  if (sdCardReady) {
    processEntry(true, "/queue", "/quarantine");
  } else if (littleFsReady) {
    processEntry(false, "/lfs_queue", "/lfs_quar");
  }
}

// ==============================================================================
// BACKGROUND TELEMETRY REPORTING HANDLER (CORE 1)
// ==============================================================================
void handleTelemetrySnapshot(const TelemetrySnapshot &snap) {
  recordSequenceNumber++;
  char recordIdBuf[48];
  snprintf(recordIdBuf, sizeof(recordIdBuf), "%s-%lu-%u",
           DEVICE_ID, (unsigned long)snap.timestampSec, recordSequenceNumber);
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
  if (measuredAt.length() > 0) doc["measured_at"] = measuredAt;
  else doc["measured_at"] = nullptr;

  int wifiRssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -120;
  if (wifiRssi > 0) wifiRssi = -120;
  if (WiFi.status() == WL_CONNECTED) doc["wifi_rssi_dbm"] = wifiRssi;
  else doc["wifi_rssi_dbm"] = nullptr;

  if (snap.hasMotorTemp) doc["motor_temp_c"] = snap.motorTemp;
  else doc["motor_temp_c"] = nullptr;

  if (snap.hasAmbientTemp) doc["ambient_temp_c"] = snap.ambientTemp;
  else doc["ambient_temp_c"] = nullptr;

  if (snap.hasVibration) {
    doc["ax_g"] = snap.meanX;
    doc["ay_g"] = snap.meanY;
    doc["az_g"] = snap.meanZ;
    doc["rms_x_g"] = fmaxf(0.0f, snap.rmsX);
    doc["rms_y_g"] = fmaxf(0.0f, snap.rmsY);
    doc["rms_z_g"] = fmaxf(0.0f, snap.rmsZ);
    doc["sample_count"] = snap.sampleCount;
    doc["acquisition_quality"] = fmaxf(0.0f, fminf(1.0f, snap.acquisitionQuality));
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
  doc["i2c_errors"] = snap.i2cErrors;
  doc["missed_sample_slots"] = snap.missedSlots;

  // Local Condition Classification from ESP32
  doc["condition_status"] = snap.conditionStatus;
  doc["condition_reason"] = snap.conditionReason;

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
  sensorStatus["adxl345"] = snap.hasVibration ? "ready" : (adxlError ? "error" : "not_detected");
  sensorStatus["motor_temp"] = snap.hasMotorTemp ? "ready" : (motorProbeFound ? "error" : "not_detected");
  sensorStatus["ambient_temp"] = snap.hasAmbientTemp ? "ready" : (ambientProbeFound ? "error" : "not_detected");

  String payload;
  serializeJson(doc, payload);

  bool synced = false;

  // Direct upload of live telemetry snapshot whenever Wi-Fi is connected
  if (WiFi.status() == WL_CONNECTED) {
    String responseStr;
    int httpCode = sendTelemetryPayload(payload, responseStr);
    if (httpCode >= 200 && httpCode < 300) {
      synced = true;
      if (diagTracker.lastApiState != "healthy") {
        diagTracker.lastApiState = "healthy";
        logDiagnosticEvent("api", "API_UPLOAD_RECOVERED", "info", "failing", "healthy", "HTTPS telemetry upload successfully restored", nullptr, true);
      }
      consecutiveUploadFailures = 0;
      lastSuccessfulUploadMs = millis();
    } else {
      consecutiveUploadFailures++;
      if (consecutiveUploadFailures == 3 && diagTracker.lastApiState != "failing") {
        diagTracker.lastApiState = "failing";
        char errBuf[64];
        snprintf(errBuf, sizeof(errBuf), "{\"http_code\":%d,\"consecutive_failures\":%u}", httpCode, consecutiveUploadFailures);
        logDiagnosticEvent("api", "API_UPLOAD_FAILED", "error", "healthy", "failing", "HTTPS telemetry upload failed repeatedly", errBuf, false);
      }
      saveRecordToQueue(recordId, payload);
    }
  } else {
    saveRecordToQueue(recordId, payload);
  }

  // Always log to persistent CSV on MicroSD card
  appendTelemetryToCsv(
      recordId, measuredAt,
      snap.hasMotorTemp, snap.motorTemp,
      snap.hasAmbientTemp, snap.ambientTemp,
      snap.hasVibration, snap.rmsX, snap.rmsY, snap.rmsZ,
      snap.sampleCount, snap.acquisitionQuality,
      wifiRssi, snap.conditionStatus, storageMedium, storageUsedPct,
      synced
  );
}

// ==============================================================================
// SETUP (FAST LOCAL INITIALIZATION)
// ==============================================================================
void setup() {
  Serial.begin(115200);
  delay(100);

  Serial.println("\n========================================================");
  Serial.println("  Industrial Motor Health Monitor — Fast ESP32 Firmware ");
  Serial.println("  Device: " + String(DEVICE_ID) + " | FW: " + String(FIRMWARE_VERSION));
  Serial.println("  Hardware: ESP32-S3 N16R8 Dual-Core 240MHz");
  Serial.println("========================================================");

  // 1. Authoritative Hardware Pin Configuration
  configureHardwarePins();

  // 2. Initialise Mutexes and Realtime Telemetry Queue
  i2cMutex = xSemaphoreCreateMutex();
  telemetrySnapshotQueue = xQueueCreate(8, sizeof(TelemetrySnapshot));

  // 3. Initialise I2C Bus for ADXL345 & DS3231 RTC
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(I2C_FREQUENCY_HZ);
  initialiseADXL345(true);
  initialiseDS3231(true);

  // 4. Initialise Storage Hierarchy
  initialiseSDCard(true);

  // 5. Initialise OneWire Temperature Probes
  discoverTemperatureProbes(true);

  // 6. Launch Real-Time Hardware Task on Core 0 (Priority 5)
  // Real-time vibration sampling & condition evaluation starts IMMEDIATELY!
  xTaskCreatePinnedToCore(
      realtimeVibrationTask,
      "RT_VibeEngine",
      4096,
      nullptr,
      5, // High priority
      &realtimeVibrationTaskHandle,
      0  // Dedicated to Core 0 (isolated from Wi-Fi stack)
  );

  // 7. Start Asynchronous Wi-Fi Connection in Background (Non-Blocking)
  startWiFiConnection();

  lastWiFiAttemptMs = millis();
  lastRediscoveryMs = millis();
  lastCommandPollMs = millis();
  lastPerfLogMs = millis();

  logDiagnosticEvent("esp32", "CONTROLLER_BOOTED", "info", "power_on", "running", "ESP32-S3 firmware initialized and runtime active", nullptr, true);

  Serial.println("[SYSTEM] Real-time monitoring active. Entering background loop.\n");
}

// ==============================================================================
// MAIN LOOP (CORE 1 BACKGROUND COMMUNICATIONS & STORAGE)
// ==============================================================================
void loop() {
  maintainWiFiAsync();
  updateTemperaturesAsync();
  checkSensorRecovery();
  processBacklogQueue();
  processEventsQueue();

  // Edge-triggered vibration classifier state change detection (thread-safe, executed on Core 1)
  if (currentCondition != diagTracker.lastClassifierState) {
    String prevCond = diagTracker.lastClassifierState;
    diagTracker.lastClassifierState = currentCondition;
    const char *sev = (currentCondition == "CRITICAL") ? "critical" : (currentCondition == "WARNING") ? "warning" : "info";
    logDiagnosticEvent("classifier", "VIBRATION_STATE_CHANGED", sev, prevCond.c_str(), currentCondition.c_str(), currentConditionReason.c_str(), nullptr, currentCondition == "GOOD");
  }

  uint32_t now = millis();

  // Check for incoming Telemetry Snapshots from Core 0 Realtime Task
  if (telemetrySnapshotQueue) {
    TelemetrySnapshot snap;
    if (xQueueReceive(telemetrySnapshotQueue, &snap, 0) == pdTRUE) {
      handleTelemetrySnapshot(snap);
    }
  }

  // Periodic Two-Way Command Polling from Web Dashboard (every 5 seconds, staggered from telemetry)
  if (now - lastCommandPollMs >= 5000 && (now - lastSuccessfulUploadMs >= 2000)) {
    lastCommandPollMs = now;
    pollDeviceCommands();
  }

  // Periodic Low-Overhead Performance Metrics Log (every 5 seconds)
  if (now - lastPerfLogMs >= 5000) {
    lastPerfLogMs = now;
    Serial.println("--------------------------------------------------------------------------------");
    Serial.printf("[PERF-STATS] Sample Interval: %u us (Min: %u | Max: %u) | Exec: %u us\n",
                  perfMetrics.sampleIntervalUs, perfMetrics.minSampleIntervalUs,
                  perfMetrics.maxSampleIntervalUs, perfMetrics.sampleExecDurationUs);
    Serial.printf("[PERF-STATS] Fast RMS Eval: %u us | Decision->LED Latency: %u us\n",
                  perfMetrics.fastRmsCalcDurationUs, perfMetrics.conditionToLedLatencyUs);
    Serial.printf("[PERF-STATS] SD Write: %u ms | HTTPS Upload: %u ms | Overflow: %u | Core0 Stack Free: %u B\n",
                  perfMetrics.lastSdWriteDurationMs, perfMetrics.lastUploadDurationMs,
                  perfMetrics.queueOverflowCount, perfMetrics.realtimeTaskStackWatermark);
    Serial.printf("[PERF-STATS] Condition: %s (%s)\n",
                  currentCondition.c_str(), currentConditionReason.c_str());
    Serial.println("--------------------------------------------------------------------------------");
  }

  delay(5);
}
