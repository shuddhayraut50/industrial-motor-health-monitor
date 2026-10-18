#ifndef PIN_CONFIG_H
#define PIN_CONFIG_H

#include <Arduino.h>

/**
 * ==============================================================================
 * INDUSTRIAL MOTOR HEALTH MONITOR — AUTHORITATIVE HARDWARE PIN CONFIGURATION
 * Target Hardware: ESP32-S3 N16R8 (16MB Flash, 8MB Octal PSRAM)
 * ==============================================================================
 * This header is the single source of truth for all GPIO assignments.
 * Never hardcode pin numbers outside of this file.
 */

// ==============================================================================
// 1. I2C BUS CONFIGURATION (SHARED BUS)
// ==============================================================================
// Devices on this bus:
// - ADXL345 3-Axis Digital Accelerometer (Address: 0x53, CS to 3.3V, SDO to GND)
// - DS3231SN Real-Time Clock (Address: 0x68, VCC to 3.3V)
constexpr int PIN_I2C_SDA = 8;
constexpr int PIN_I2C_SCL = 9;
constexpr uint32_t I2C_FREQUENCY_HZ = 400000; // 400 kHz Fast I2C

constexpr uint8_t ADXL345_I2C_ADDR = 0x53;
constexpr uint8_t DS3231_I2C_ADDR = 0x68;

// ==============================================================================
// 2. INDEPENDENT DUAL DS18B20 ONE-WIRE BUSES
// ==============================================================================
// Each probe has a dedicated OneWire bus to prevent device enumeration swapping.
// Both data pins require a 4.7 kΩ pull-up resistor to 3.3V.
constexpr int PIN_ONEWIRE_MOTOR = 10;   // Motor-bearing temperature probe
constexpr int PIN_ONEWIRE_AMBIENT = 11; // Ambient air reference probe

// ==============================================================================
// 3. MICROSD CARD SPI CONFIGURATION (FSPI / SPI2)
// ==============================================================================
// Standard ESP32-S3 SPI peripheral pins for external MicroSD card adapter.
// Logic level is strictly 3.3V. Do NOT connect 5V logic.
constexpr int PIN_SD_SCK = 12;
constexpr int PIN_SD_MISO = 13;
constexpr int PIN_SD_MOSI = 14;
constexpr int PIN_SD_CS = 15;
constexpr uint32_t SD_SPI_SPEED_HZ = 20000000; // 20 MHz SPI speed

// ==============================================================================
// 4. TEST LED CONFIGURATION (5-LED ARRAY)
// ==============================================================================
// Five test LEDs used for website-command diagnostics and local vibration meters.
// All LEDs are Active HIGH. Each requires a 220 Ω to 330 Ω current-limiting resistor.
constexpr int PIN_TEST_LED_1 = 4;  // Test LED 1 / Vibration Level 1 (Normal)
constexpr int PIN_TEST_LED_2 = 5;  // Test LED 2 / Vibration Level 2 (Caution)
constexpr int PIN_TEST_LED_3 = 6;  // Test LED 3 / Vibration Level 3 (Warning)
constexpr int PIN_TEST_LED_4 = 7;  // Test LED 4 / Vibration Level 4 (High)
constexpr int PIN_TEST_LED_5 = 16; // Test LED 5 (Unpopulated/reserved on bench; forced LOW by firmware)

constexpr int TEST_LEDS[5] = {
    PIN_TEST_LED_1,
    PIN_TEST_LED_2,
    PIN_TEST_LED_3,
    PIN_TEST_LED_4,
    PIN_TEST_LED_5
};

constexpr size_t TEST_LED_COUNT = 5;

// ==============================================================================
// 5. SYSTEM STATUS INDICATION LEDS
// ==============================================================================
// Red and Green status indicators for immediate machine-side operator diagnostics.
// Active HIGH, 220 Ω to 330 Ω series resistor to ground.
constexpr int PIN_LED_RED_FAULT = 17;    // Red: Critical Alarm / Fault / Network Drop
constexpr int PIN_LED_GREEN_HEALTHY = 18; // Green: Normal Operating / Heartbeat

// Helper function to initialize all configured GPIO pins
inline void configureHardwarePins() {
  // Configure Test LEDs as Outputs (initial state LOW)
  for (size_t i = 0; i < TEST_LED_COUNT; i++) {
    pinMode(TEST_LEDS[i], OUTPUT);
    digitalWrite(TEST_LEDS[i], LOW);
  }

  // Configure Status LEDs as Outputs (initial state LOW)
  pinMode(PIN_LED_RED_FAULT, OUTPUT);
  digitalWrite(PIN_LED_RED_FAULT, LOW);

  pinMode(PIN_LED_GREEN_HEALTHY, OUTPUT);
  digitalWrite(PIN_LED_GREEN_HEALTHY, LOW);

  // Configure SD Chip Select (active LOW, default HIGH)
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);
}

#endif // PIN_CONFIG_H
