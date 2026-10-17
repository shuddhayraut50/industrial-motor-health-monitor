# Industrial Motor Health Monitor — System Guide

## 1. System Architecture & High-Level Data Flow

The Industrial Motor Health Monitor is a two-tier edge-to-cloud telemetry and diagnostics platform engineered for continuous monitoring of industrial rotating machinery.

```
+-----------------------------------------------------------------------------------+
|                                PHYSICAL MOTOR EDGE                                |
|                                                                                   |
|  [ADXL345]  ---+                                                                  |
|   (I2C: 0x53)  |                                                                  |
|  [DS3231 RTC] -+--> ESP32-S3 Core 0 (Continuous 200 Hz Sampling)                  |
|   (I2C: 0x68)  |          |                                                       |
|  [DS18B20 #1] -+          v                                                       |
|   (Motor Temp) |    Ring Buffer & Sliding Window (5 Seconds)                      |
|  [DS18B20 #2] -+          |                                                       |
|   (Ambient)    |          v                                                       |
|                +--> ESP32-S3 Core 1 (Statistical & RMS Engine)                    |
|                           |                                                       |
|                           +--> Local Condition Classification Engine             |
|                           |    (ISO 10816-1 Debounce State Machine)               |
|                           |    GOOD / CHECK / WARNING / CRITICAL / UNKNOWN        |
|                           |                                                       |
|                           +--> Local 5-LED Vibration Indicator Bar                |
|                           |    + Separate Red/Green Status LEDs                   |
|                           |                                                       |
|                           +--> Durable Offline Storage Engine                     |
|                           |    Primary: MicroSD SPI (FAT32)                       |
|                           |    Fallback: LittleFS Flash (90% Storage Ceiling)     |
|                           |                                                       |
|                           +--> HTTPS Client (TLS GTS Root R1 Verification)        |
+---------------------------|-------------------------------------------------------+
                            | Wi-Fi (WPA2/WPA3)
                            v
+-----------------------------------------------------------------------------------+
|                             CLOUD API & EDGE SERVICES                             |
|                                                                                   |
|  Vercel Edge Functions (Next.js 16)                                               |
|    - POST /api/telemetry (Authenticated Telemetry Ingestion)                      |
|    - GET  /api/telemetry/live (Connection & Condition Status Resolver)            |
|    - GET  /api/telemetry/history (Indexed 12h/24h Time Windows & CSV)             |
|    - POST /api/device/commands (Queue Device Diagnostic Commands)                 |
|    - POST /api/device/commands/poll (ESP32 Pending Command Retriever)             |
|    - POST /api/device/commands/ack (ESP32 Execution Acknowledgment)               |
+---------------------------|-------------------------------------------------------+
                            | Secure TLS Connection
                            v
+-----------------------------------------------------------------------------------+
|                            DATABASE & HISTORICAL STORE                            |
|                                                                                   |
|  Supabase (PostgreSQL 15)                                                         |
|    - public.motor_telemetry (Timescale-style partitioning, B-tree indexed)        |
|    - public.device_commands (Two-way command audit lifecycle & results)           |
|    - public.device_config (Threshold limits, calibration offsets)                 |
+---------------------------|-------------------------------------------------------+
                            | Real-time Subscriptions / Polling
                            v
+-----------------------------------------------------------------------------------+
|                                WEB USER INTERFACE                                 |
|                                                                                   |
|  Dual-Mode Dashboard                                                              |
|    - Simple View: Non-technical plant operators (traffic-light banners, advice)   |
|    - Technical View: Reliability engineers (FFT/RMS, thermals, I2C stats, queue)  |
|    - LED Diagnostic Command Center: Sequential chaser & individual pulse triggers |
|    - Time-Window Selectors: 12h / 24h zoom with gap-preserving timeseries         |
+-----------------------------------------------------------------------------------+
```

---

## 2. Power Supply Safety & Electrical Guidelines

### 2.1 Powering Options for the ESP32-S3 DevKit

The system operates using an **ESP32-S3-WROOM-1 / DevKitC-1 N16R8** development board.

1. **Development & Bench Testing Mode (USB Powered):**
   - The ESP32-S3 is powered directly via the onboard USB Type-C port connected to a laptop or PC.
   - The onboard 5V-to-3.3V Low-Dropout Regulator (LDO) provides regulated 3.3V DC to the ESP32-S3 SoC and the 3.3V rail pin.
2. **Industrial Deployment Mode (External 5V Power Supply):**
   - A dedicated 5V DC regulated power supply (rated for **5V @ 2A minimum**) is connected directly to the **5V / VIN pin** and the **GND pin**.

### 2.2 Critical Electrical Safety Rules

> [!CAUTION]
> **NEVER connect 5V to the ESP32 3.3V pin.** The 3.3V pin is an output from the onboard LDO regulator when powered from 5V/USB, or a direct supply pin to the ESP32-S3 silicon. Supplying 5V to the 3.3V pin will immediately destroy the ESP32-S3 microcontroller.

> [!WARNING]
> **Simultaneous USB and External 5V Power Warning:**
> Unless your specific ESP32-S3 board variant includes a Schottky diode isolation circuit between VBUS and VIN (many clones omit this protection diode), **NEVER connect the USB cable to a laptop while an external 5V power supply is connected to the VIN pin**. Doing so can backfeed unregulated 5V current into your computer's USB port, potentially damaging your computer's motherboard. Always disconnect external VIN before plugging in the programming USB cable.

### 2.3 Peripheral Power Budget & Onboard LDO Ratings

The onboard LDO on standard ESP32-S3 DevKit boards (typically an AMS1117-3.3 or ME6211) is rated for **500 mA to 800 mA continuous**.

| Component | Operating Voltage | Current Consumption (Typical) | Current Consumption (Peak) | Power Source |
|---|---|---|---|---|
| **ESP32-S3 SoC** | 3.3V | 100 mA | 350 mA (during Wi-Fi TX) | Onboard 3.3V LDO |
| **ADXL345 Accelerometer** | 3.3V | 0.14 mA | 0.20 mA | 3.3V Rail |
| **DS3231SN Real-Time Clock** | 3.3V | 0.20 mA | 1.50 mA (I2C active) | 3.3V Rail |
| **DS18B20 Probe #1 (Motor)** | 3.3V | 1.00 mA | 1.50 mA (Converting) | 3.3V Rail |
| **DS18B20 Probe #2 (Ambient)**| 3.3V | 1.00 mA | 1.50 mA (Converting) | 3.3V Rail |
| **MicroSD SPI Module** | 3.3V / 5V | 20.0 mA | 100.0 mA (Flash write) | 3.3V (or 5V if module has onboard LDO) |
| **5x Test LEDs (Active-High)**| 3.3V | 8.0 mA each | 40.0 mA (All on) | GPIO with 330Ω resistors |
| **2x Status LEDs (Red/Green)**| 3.3V | 8.0 mA each | 16.0 mA (Both on) | GPIO with 330Ω resistors |
| **TOTAL PEAK CONSUMPTION** | — | — | **~510 mA** | **Within 800 mA LDO capability** |

### 2.4 Common Ground Protocol
All sensors (ADXL345, DS18B20 probes, DS3231), the MicroSD breakout module, and the diagnostic LEDs must share a single, low-impedance **Common Ground (GND)** return path back to the ESP32-S3 GND pin. Never run ground return lines in long daisy-chain loops that could introduce ground-bounce noise into high-speed ADC or I2C clock signals.

---

## 3. Two Dashboard Modes: Simple vs. Technical

The web user interface features a dedicated toggle in the header to switch between two user paradigms:

### 3.1 Simple View (For Machine Operators and Plant Technicians)
- **Design Philosophy:** Minimal jargon, high contrast, traffic-light visual cues, actionable maintenance guidance.
- **Key Indicators:**
  - **Overall Motor Condition Banner:** Large badge displaying `GOOD`, `CHECK`, `WARNING`, `CRITICAL`, or `UNKNOWN`.
  - **Plain-English Condition Explanation:** A clear, human-readable sentence explaining exactly why the condition was triggered (e.g., *"Motor temperature 78.4°C exceeded Warning threshold (75.0°C)"*).
  - **Recommended Action:** Concrete procedural steps (e.g., *"Inspect motor ventilation cowling and verify lubrication"*).
  - **Simplified Metrics:** Dual circular temperature cards (Motor & Ambient) and 3-axis vibration summaries in mm/s or g RMS.
  - **Connection Status:** Simple Green (Online), Amber (Stale), or Grey (Offline) pill.
  - **Delayed Sync Badge:** Displays an amber badge if current readings are delayed records replayed from offline memory.

### 3.2 Technical View (For Reliability Engineers and Firmware Developers)
- **Design Philosophy:** Raw telemetry inspection, signal analytics, communication diagnostics, full control center.
- **Key Indicators:**
  - **Vibration Stat Card:** Mean X/Y/Z acceleration, Peak-to-Peak acceleration, AC RMS vibration for all 3 axes, and dominant frequency.
  - **Sensor Quality & Bus Diagnostics:** 5-second sample count (nominal 1000 at 200 Hz), dropped sample slots, acquisition quality percentage, and I2C error count.
  - **Thermal Rise Computation:** Calculated differential ($\Delta T = T_{\text{motor}} - T_{\text{ambient}}$) with independent validity gating.
  - **Storage & Synchronization Telemetry:** Active medium (`MicroSD` vs `LittleFS Flash`), partition utilization percentage, pending queue records, and dropped record tally.
  - **Network & TLS Diagnostics:** Wi-Fi RSSI in dBm, reconnect attempt counter, HTTP return codes, and latency.
  - **LED Command Center:** Interactive panel to dispatch `LED_TEST_ALL` and `LED_TEST_SINGLE` commands, complete with live execution polling and state tracking.
- **State Persistence:** User preference is saved to browser `localStorage` and optionally driven via URL query parameter (`?mode=simple` or `?mode=technical`).

---

## 4. Local Condition Classification Engine (ESP32-S3)

The condition classification is calculated **directly on the ESP32-S3** within each 5-second reporting window. The cloud backend visualizes the result but does **not** alter or fabricate condition decisions.

### 4.1 Condition Classes
1. **`GOOD` (Normal):** Vibration RMS $\le 2.8\text{ mm/s}$ (or $\le 0.45\text{ g}$ RMS) and Motor Temperature $\le 70.0^\circ\text{C}$.
2. **`CHECK` (Caution):** Vibration RMS $> 2.8\text{ mm/s}$ or Motor Temperature $> 70.0^\circ\text{C}$.
3. **`WARNING` (Elevated Risk):** Vibration RMS $> 4.5\text{ mm/s}$ or Motor Temperature $> 80.0^\circ\text{C}$.
4. **`CRITICAL` (Urgent Action):** Vibration RMS $> 7.1\text{ mm/s}$ or Motor Temperature $> 90.0^\circ\text{C}$.
5. **`UNKNOWN` (Insufficient Data):** ADXL345 accelerometer disconnected, I2C bus offline, or sample quality $< 60\%$.

### 4.2 Debounce & Hysteresis State Machine
To eliminate false alarms caused by transient mechanical spikes (e.g., an adjacent forklift hitting a dock or momentary motor startup inrush):
- **Escalation Debounce:** The system requires **2 consecutive 5-second evaluation cycles** (10 seconds total) in an elevated condition before promoting the overall condition to `WARNING` or `CRITICAL`.
- **De-escalation Hysteresis:** Once a higher alert condition is entered, vibration must drop at least **10% below the threshold** for **3 consecutive cycles** (15 seconds total) before the condition recovers to a lower state.

---

## 5. Offline Storage & Bounded Queue Hierarchy

To guarantee data integrity during Wi-Fi outages, network congestion, or cloud maintenance, the ESP32 implements a tiered non-volatile storage hierarchy:

```
[Window Calculated] 
       |
       v
[Check MicroSD Available?] --(Yes)--> [Append to SD /telemetry_queue.jsonl]
       |
     (No)
       v
[Check LittleFS Available?] -(Yes)--> [Enforce 90% Storage Ceiling Policy]
       |                                      |
       |                                      v
       |                              [Append to LittleFS /t_queue.jsonl]
       |
     (No)
       v
[Log Storage Failure to Serial & Flag Telemetry Payload]
```

### 5.1 Strict 90% Storage Ceiling Policy
- The firmware queries the active filesystem via `LittleFS.totalBytes()` and `LittleFS.usedBytes()`.
- If utilization reaches **$\ge 90\%$**, the storage engine refuses to write further unconstrained records.
- **Headroom Pruning:** The oldest synchronized queue chunks are pruned first. If all records in the queue are unsynchronized and the ceiling remains violated, the oldest pending record is dropped, and `droppedRecordsCount` is incremented.
- The `dropped_records_count` and `storage_used_pct` are reported in the next telemetry packet so engineers have full visibility into any data loss.

---

## 6. Two-Way Device Command Lifecycle

The web dashboard allows authorized operators to dispatch diagnostic commands to the ESP32-S3 without compromising edge security.

```
+------------+            +----------------+            +----------+
|  Web User  |            |   Vercel API   |            | ESP32-S3 |
+------------+            +----------------+            +----------+
      |                           |                          |
      | 1. POST Command           |                          |
      |-------------------------->|                          |
      |                           | [Status: CREATED]        |
      |                           |                          |
      |                           |   2. Poll Pending Cmds   |
      |                           |<-------------------------|
      |                           |   (every 5 seconds)      |
      |                           |                          |
      |                           |   3. Return Commands     |
      |                           |------------------------->|
      |                           | [Status: DELIVERED]      |
      |                           |                          |
      |                           |   4. ACK: EXECUTING      |
      |                           |<-------------------------|
      |                           |                          |
      |                           |   5. Execute GPIO Routine|
      |                           |      (Non-blocking)      |
      |                           |                          |
      |                           |   6. ACK: SUCCEEDED      |
      |                           |<-------------------------|
      | 7. Query Command Status   |                          |
      |<--------------------------|                          |
      |    [State: SUCCEEDED]     |                          |
```

1. **`CREATED` / `QUEUED`:** Operator submits command on web dashboard. Record is stored in `public.device_commands`.
2. **`DELIVERED`:** ESP32-S3 polls `/api/device/commands/poll` using its pre-shared device token (`x-device-token`) and receives the command.
3. **`EXECUTING`:** ESP32 immediately issues an initial acknowledgment (`/api/device/commands/ack`) indicating execution has started.
4. **`SUCCEEDED` / `FAILED`:** When the routine finishes (e.g., LED test complete), ESP32 dispatches the final acknowledgment payload with execution output.
5. **`EXPIRED`:** If a command is queued but the device remains offline beyond the command's `timeout_seconds`, the cloud marks the command as `EXPIRED`.
