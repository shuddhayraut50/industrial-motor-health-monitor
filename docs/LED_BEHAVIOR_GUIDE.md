# Industrial Motor Health Monitor — LED Indication & Diagnostic Guide

**Authoritative Hardware LED Reference**  
**Target Hardware:** ESP32-S3 N16R8  
**Firmware Version:** `1.5.0-fast-rt` (Hardened)

---

## 1. Physical Hardware Layout

The physical bench prototype utilizes **6 physical LEDs**:
- **1x Green Status LED** (GPIO 18)
- **1x Red Fault / Alarm LED** (GPIO 17)
- **4x Test / Vibration Level LEDs** (GPIO 4, 5, 6, 7)
- *(Note: Test LED 5 on GPIO 16 is physically unpopulated on the bench setup and is driven strictly LOW by firmware).*

| LED Identifier | Physical GPIO | Color | Default Function | Active Level |
|---|---|---|---|---|
| **Status Green** | GPIO 18 | Green | Normal Operation & Wi-Fi Link State | Active HIGH |
| **Status Red** | GPIO 17 | Red | System Fault, Warning & Alarm Indication | Active HIGH |
| **Test LED 1** | GPIO 4 | Yellow / Blue | Level 1 Vibration / ADXL345 Error Code | Active HIGH |
| **Test LED 2** | GPIO 5 | Yellow / Blue | Level 2 Vibration / Motor DS18B20 Error Code | Active HIGH |
| **Test LED 3** | GPIO 6 | Yellow / Blue | Level 3 Vibration / Ambient DS18B20 Error Code | Active HIGH |
| **Test LED 4** | GPIO 7 | Yellow / Blue | Level 4 Vibration / DS3231 RTC Error Code | Active HIGH |
| *Test LED 5* | GPIO 16 | N/A | *(Unpopulated / driven LOW)* | Active HIGH |

---

## 2. Status LEDs: Red (GPIO 17) & Green (GPIO 18)

The Red and Green LEDs provide instantaneous, machine-side operational status to plant operators without requiring web dashboard access.

### A. Green Status LED (GPIO 18)

| Green LED Pattern | System Meaning | Operational State |
|---|---|---|
| **Solid Continuous ON** | **Everything Normal & Cloud Connected** | Motor operating normally within nominal thresholds. Wi-Fi connected and HTTPS telemetry uploading successfully to the cloud every 5 seconds. |
| **Slow Blink (1 Hz: 500ms ON / 500ms OFF)** | **Everything Normal locally, but Wi-Fi Disconnected** | Machine health calculations, local condition evaluation, and offline storage (LittleFS / MicroSD) are functioning perfectly at full 200 Hz, but Wi-Fi link is down or cloud upload is stale. |
| **OFF** | **Alarm Condition or Device Power Off** | Device is powered down or operating in a severe warning / critical alarm condition. |

### B. Red Status LED (GPIO 17)

| Red LED Pattern | System Meaning | Action Required |
|---|---|---|
| **OFF** | **Normal Operation** | No alarms, no warnings, all sensor probes detected and operational. |
| **Slow Blink (1 Hz: 500ms ON / 500ms OFF)** | **Sensor Probe Disconnected / Fault** | One or more physical sensor probes have lost connection or failed self-test. Inspect Test LEDs 1–4 to identify the exact failed sensor. |
| **Fast Blink (2 Hz: 250ms ON / 250ms OFF)** | **Vibration Warning Threshold Exceeded** | Motor vibration RMS has crossed the configured warning limit ($\ge 0.25g$). Inspect motor bearings, alignment, or mounting. |
| **Solid Continuous ON** | **Critical Alarm / Out-of-Control Vibration** | Motor vibration RMS has crossed critical threshold ($\ge 0.45g$) or dangerous thermal rise. Immediate supervisory inspection required. |

---

## 3. Sensor Fault Diagnosis Mode (Test LEDs 1 to 4)

When any sensor probe is disconnected or fails I²C/OneWire communication (`adxlError`, missing DS18B20 probe, or missing RTC):
1. **Red Status LED** blinks slowly at **1 Hz**.
2. **Test LEDs 1 to 4** enter **Diagnostic Mode**, displaying a distinctive **Double-Pulse Blink** pattern (Blink-Blink-Pause every 1000 ms) on the LED assigned to the failed sensor.

### Double-Pulse Timing
- `Cycle Duration:` 1000 ms
- `Pulse 1:` 120 ms ON $\rightarrow$ 120 ms OFF
- `Pulse 2:` 120 ms ON $\rightarrow$ 640 ms OFF

### Sensor Fault Identification Table

| LED Displaying Double-Pulse | Faulty Peripheral | Connection / Bus | Diagnostic Root Cause |
|---|---|---|---|
| **Test LED 1** (GPIO 4) | **ADXL345 Accelerometer** | I²C Address `0x53` (SDA: 8, SCL: 9) | Sensor not detected on I²C bus or invalid Device ID (expected `0xE5`). Check 3.3V wiring, CS pin pulled HIGH, SDO grounded. |
| **Test LED 2** (GPIO 5) | **Motor Temp DS18B20** | GPIO 10 (OneWire Dedicated) | Probe address not found on 1-Wire scan or bus open circuit. Check 4.7 kΩ pull-up resistor between GPIO 10 and 3.3V. |
| **Test LED 3** (GPIO 6) | **Ambient Temp DS18B20** | GPIO 11 (OneWire Dedicated) | Ambient probe address not found. Check 4.7 kΩ pull-up resistor between GPIO 11 and 3.3V. |
| **Test LED 4** (GPIO 7) | **DS3231 Real-Time Clock** | I²C Address `0x68` (SDA: 8, SCL: 9) | RTC module not responding on I²C bus or oscillator stopped. Check backup battery and I²C wiring. |

*Note: Multiple sensors in fault state will simultaneously pulse their respective LEDs.*

---

## 4. Normal Vibration Meter Mode (Test LEDs 1 to 4)

When all sensors are healthy, Test LEDs 1 to 4 operate as a **Real-Time Dynamic Vibration Meter**, driven by the rolling 250 ms fast RMS calculation on Core 0.

| RMS Vibration Level | Test LED 1 (GPIO 4) | Test LED 2 (GPIO 5) | Test LED 3 (GPIO 6) | Test LED 4 (GPIO 7) | Vibration Meaning |
|---|---|---|---|---|---|
| **$\text{RMS} < 0.04g$** | **OFF** | **OFF** | **OFF** | **OFF** | **Quiet / Baseline OK:** Normal quiet motor running state. Baseline vibration is well within normal limits. |
| **$0.04g \le \text{RMS} < 0.08g$** | **Slow Blink (1 Hz)** | **OFF** | **OFF** | **OFF** | **Small Variation:** Minor mechanical variation or low-amplitude running ripple detected. |
| **$0.08g \le \text{RMS} < 0.15g$** | **Solid ON** | **Medium Blink (3 Hz)** | **OFF** | **OFF** | **Moderate Variation:** Increased vibration amplitude. Acceptable under load, but visibly elevated above baseline. |
| **$0.15g \le \text{RMS} < 0.25g$** | **Solid ON** | **Solid ON** | **Fast Blink (6 Hz)** | **OFF** | **High Vibration / Approaching Warning:** Significant vibration detected. Maintenance check advised. |
| **$\text{RMS} \ge 0.25g$ or CRITICAL** | **Solid ON** | **Solid ON** | **Solid ON** | **Solid ON** | **Out-of-Control / Critical Vibration:** Continuous solid illumination across all 4 LEDs indicates severe unbalance, misalignment, or bearing degradation. |

---

## 5. Website Interactive LED Test Mode

When plant engineers trigger an authorized LED Diagnostic Test from the web dashboard:
- **`LED_TEST_ALL`:** Sequentially illuminates LEDs 1, 2, 3, 4 with a 500 ms dwell time per step, verifying driver transistors and LED illumination.
- **`LED_TEST_SINGLE`:** Pulses a selected LED (1–4) for a specified duration (e.g. 1000 ms).
- **Safety Override:** If a **CRITICAL** vibration or thermal condition develops at any time during a web-initiated diagnostic test, the test is immediately aborted within 20 microseconds, and the LEDs instantly switch to the Critical Alarm pattern.

---

## 6. Quick Troubleshooting Matrix

| What You See on the Bench | What It Means | Recommended Action |
|---|---|---|
| Green LED Solid ON, Red LED OFF, LEDs 1–4 OFF | System running perfectly, connected to Wi-Fi, low baseline vibration. | No action required. |
| Green LED Slow Blink (1 Hz), Red LED OFF | System healthy and logging to LittleFS/SD, but Wi-Fi disconnected. | Check Wi-Fi router / access point credentials. |
| Red LED Slow Blink (1 Hz), LED 2 Double-Pulse | Motor DS18B20 temperature probe disconnected. | Inspect OneWire wiring on GPIO 10 and 4.7kΩ pull-up resistor. |
| Red LED Slow Blink (1 Hz), LED 1 Double-Pulse | ADXL345 accelerometer disconnected. | Inspect I2C wiring on GPIO 8 (SDA) and GPIO 9 (SCL). |
| Red LED Fast Blink (2 Hz), LEDs 1–3 Solid ON | Warning vibration level ($\ge 0.15g$). | Inspect motor mounting bolts, shaft coupling, and bearing lubrication. |
| Red LED Solid ON, LEDs 1–4 Continuous Solid ON | Out-of-control / critical vibration ($\ge 0.25g$). | Immediate motor inspection; stop motor if vibration is abnormal. |
