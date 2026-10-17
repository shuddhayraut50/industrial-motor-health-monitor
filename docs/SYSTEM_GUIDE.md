# Industrial Motor Health Monitor — System Guide

## 1. System Architecture & High-Level Data Flow

The Industrial Motor Health Monitor is a two-tier edge-to-cloud telemetry and diagnostics platform engineered for continuous monitoring of industrial rotating machinery.

```
+-----------------------------------------------------------------------------------+
|                                PHYSICAL MOTOR EDGE                                |
|                                                                                   |
|  [ADXL345]  ---+                                                                  |
|   (I2C: 0x53)  |                                                                  |
|  [DS3231 RTC] -+--> ESP32-S3 Core 0: Real-Time Fast Path (Priority 5, Dedicated)  |
|   (I2C: 0x68)  |      - Continuous 200 Hz Sampling (every 5 ms)                   |
|                |      - O(1) Rolling Window Accumulator (50 samples = 250 ms)     |
|                |      - Fast AC RMS Engine & Immediate Condition Evaluator        |
|                |      - Instantaneous LED Driver (< 1 ms latency)                 |
|                |      - Priority Safety Override for Critical Alarms              |
|                |                                                                  |
|                +--> Thread-Safe FreeRTOS Mailbox (xQueueSend / xQueueReceive)     |
|                       |                                                           |
|                       v                                                           |
|                 ESP32-S3 Core 1: Background Services (Priority 1)                 |
|                   - 5-Second Telemetry Packaging (ArduinoJson)                    |
|                   - Bounded Offline Storage (SD / LittleFS 90% Ceiling)           |
|                   - Asynchronous OneWire Temperature Conversion (750 ms)          |
|                   - Non-Blocking Wi-Fi with Bounded Exponential Backoff           |
|                   - HTTPS Telemetry Upload (TLS GTS Root R1 Verification)         |
|                   - Periodic Two-Way Command Polling (every 5 seconds)            |
+-----------------------------------------------------------------------------------+
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

## 2. Dedicated Dual-Core Real-Time Architecture

To eliminate the bottleneck where network timeouts or SD card write flushes delayed local condition calculation or froze LED indicators, the firmware strictly segregates execution across the ESP32-S3's dual Xtensa cores:

### 2.1 Core 0 Real-Time Fast Path (`RT_VibeEngine`)
- **Task Priority:** FreeRTOS Priority 5 (High Priority).
- **Core Affinity:** Core 0 (isolated from Arduino networking, Wi-Fi stack, and lwIP).
- **Execution Cadence:** Fixed 200 Hz ($5000\,\mu\text{s}$ interval) using `vTaskDelayUntil()`.
- **Operations Performed:**
  1. I2C register read from ADXL345 under `i2cMutex`.
  2. Updates circular rolling window accumulator (50 samples = 250 ms) in $O(1)$ constant time ($<0.2\,\mu\text{s}$).
  3. Updates 5-second cumulative summary for the telemetry reporter.
  4. Every 250 ms (50 samples):
     - Computes Fast AC RMS for X, Y, and Z axes ($<5\,\mu\text{s}$).
     - Evaluates local condition classification with hysteresis and debounce.
     - Immediately writes output levels to the 5 Test LEDs and Red/Green status LEDs ($<1\,\mu\text{s}$).
  5. Every 5000 ms (1000 samples):
     - Takes an atomic snapshot of 5-second metrics.
     - Pushes snapshot into `telemetrySnapshotQueue` for Core 1.
- **Guarantee:** Zero Wi-Fi reconnections, zero HTTPS timeouts (up to 4.5s), and zero SD-card latency can ever introduce a single microsecond of delay into sensor acquisition or LED updates.

### 2.2 Core 1 Background Pipeline (`loop()`)
- **Task Priority:** FreeRTOS Priority 1 (Background / Normal).
- **Core Affinity:** Core 1.
- **Operations Performed:**
  1. Reads `telemetrySnapshotQueue` and formats JSON payloads with `ArduinoJson`.
  2. Enforces the strict 90% storage capacity ceiling policy.
  3. Writes telemetry records to MicroSD `/telemetry.csv` and offline queue files.
  4. Manages non-blocking Wi-Fi connection with exponential backoff (5s to 60s).
  5. Dispatches HTTPS uploads to `/api/telemetry` with Google Trust Services root verification.
  6. Drains offline queue backlog incrementally (1 record every 400 ms).
  7. Polls `/api/device/commands/poll` every 5 seconds and dispatches acknowledgments.
  8. Manages non-blocking OneWire temperature conversions (750 ms).

---

## 3. Power Supply Safety & Electrical Guidelines

### 3.1 Powering Options for the ESP32-S3 DevKit

The system operates using an **ESP32-S3-WROOM-1 / DevKitC-1 N16R8** development board.

1. **Development & Bench Testing Mode (USB Powered):**
   - The ESP32-S3 is powered directly via the onboard USB Type-C port connected to a laptop or PC.
   - The onboard 5V-to-3.3V Low-Dropout Regulator (LDO) provides regulated 3.3V DC to the ESP32-S3 SoC and the 3.3V rail pin.
2. **Industrial Deployment Mode (External 5V Power Supply):**
   - A dedicated 5V DC regulated power supply (rated for **5V @ 2A minimum**) is connected directly to the **5V / VIN pin** and the **GND pin**.

### 3.2 Critical Electrical Safety Rules

> [!CAUTION]
> **NEVER connect 5V to the ESP32 3.3V pin.** The 3.3V pin is an output from the onboard LDO regulator when powered from 5V/USB, or a direct supply pin to the ESP32-S3 silicon. Supplying 5V to the 3.3V pin will immediately destroy the ESP32-S3 microcontroller.

> [!WARNING]
> **Simultaneous USB and External 5V Power Warning:**
> Unless your specific ESP32-S3 board variant includes a Schottky diode isolation circuit between VBUS and VIN (many clones omit this protection diode), **NEVER connect the USB cable to a laptop while an external 5V power supply is connected to the VIN pin**. Doing so can backfeed unregulated 5V current into your computer's USB port, potentially damaging your computer's motherboard. Always disconnect external VIN before plugging in the programming USB cable.

### 3.3 Peripheral Power Budget & Onboard LDO Ratings

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

---

## 4. Local Condition Classification & Fast LED Response

### 4.1 Condition Classes & Configurable Boundaries
1. **`GOOD` (Normal):** Vibration RMS $\le 0.12\text{ g}$ (or $\le 2.8\text{ mm/s}$) and Motor Temperature $\le 55.0^\circ\text{C}$.
2. **`CHECK` (Caution):** Vibration RMS $> 0.12\text{ g}$ or Motor Temperature $> 55.0^\circ\text{C}$.
3. **`WARNING` (Elevated Risk):** Vibration RMS $> 0.25\text{ g}$ or Motor Temperature $> 70.0^\circ\text{C}$.
4. **`CRITICAL` (Urgent Action):** Vibration RMS $> 0.45\text{ g}$ or Motor Temperature $> 85.0^\circ\text{C}$.
5. **`UNKNOWN` (Insufficient Data):** ADXL345 disconnected or I2C communication error.

### 4.2 Latency Definitions & Timing Guarantees
It is critical to distinguish among the three tiers of latency in the upgraded system:

```
[Mechanical Vibration Spike Occurs]
       |
       |  (1) Detection Latency (< 250 ms for CRITICAL, < 500 ms for WARNING)
       v
[Fast Condition Evaluated]
       |
       |  (2) LED Update Latency (< 1 ms; physical GPIO pin output driven)
       v
[LEDs Change State Immediately on Machine]
       |
       |  (3) Cloud Telemetry Latency (nominal 5.0 seconds reporting window)
       v
[Dashboard Banner Updates in Web Browser]
```

- **(1) Fast Detection Latency:**
  - Evaluated on a sliding **250 ms rolling window** (50 samples at 200 Hz).
  - For `CRITICAL` safety hazards: **0 confirmation delay** (detection latency $< 250\text{ ms}$).
  - For `WARNING` and `CHECK`: **2-cycle debounce (500 ms persistence)** to prevent chatter from random transients.
- **(2) LED Update Latency:**
  - The local condition decision immediately drives the GPIO registers via `digitalWrite()`.
  - Measured latency: **$< 1\text{ ms}$** (target was $<20\text{ ms}$).
- **(3) Cloud Telemetry Latency:**
  - Aggregated 5-second window summary dispatched to Vercel/Supabase.
  - Maintains long-term statistical validity without flooding cloud bandwidth.

### 4.3 Safety Priority Rule for LED Test Modes
If an operator triggers an LED test sequence (`LED_TEST_ALL` or `LED_TEST_SINGLE`) from the web dashboard while a motor is running:
- If a `CRITICAL` vibration condition occurs during the test, the firmware **immediately aborts the diagnostic sequence**.
- All 5 test LEDs switch instantly to the urgent 200 ms non-blocking flash pattern.
- The command acknowledgment reports status `FAILED` with error: `"Safety override: CRITICAL vibration condition detected"`.
- This guarantees operator safety testing can never suppress an active machinery hazard alert!

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
       |                              [Append to LittleFS /lfs_queue/rec_*.json]
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

1. **`CREATED` / `QUEUED`:** Operator submits command on web dashboard. Record is stored in `public.device_commands`.
2. **`DELIVERED`:** ESP32-S3 polls `/api/device/commands/poll` using its pre-shared device token (`x-device-token`) and receives the command.
3. **`EXECUTING`:** ESP32 immediately issues an initial acknowledgment (`/api/device/commands/ack`) indicating execution has started.
4. **`SUCCEEDED` / `FAILED`:** When the routine finishes (e.g., LED test complete), ESP32 dispatches the final acknowledgment payload with execution output.
5. **`EXPIRED`:** If a command is queued but the device remains offline beyond the command's `timeout_seconds`, the cloud marks the command as `EXPIRED`.

---

## 7. Monotonic Performance Instrumentation

The firmware includes low-overhead timing measurements using `esp_timer_get_time()`:

```text
[PERF-STATS] Sample Interval: 5002 us (Min: 4988 | Max: 5040) | Exec: 340 us
[PERF-STATS] Fast RMS Eval: 6 us | Decision->LED Latency: 2 us
[PERF-STATS] SD Write: 24 ms | HTTPS Upload: 312 ms | Overflow: 0 | Core0 Stack Free: 2840 B
[PERF-STATS] Condition: GOOD (Normal baseline: vibration and thermal rise within nominal limits.)
```

These metrics are transmitted during every 5-second serial diagnostic report and exposed via the `STATUS_REQUEST` two-way command for remote engineering inspection.
