# Industrial Motor Health Monitor — Troubleshooting & Diagnostic Guide

This document provides a systematic diagnostic workflow for resolving field issues with the ESP32-S3 firmware, network connectivity, API communication, sensor buses, local storage, and LED indicators.

---

## 1. Quick Diagnostic Flowchart

```
[System Issue Observed]
       |
       +---> [Dashboard shows "Offline" or "Stale"?] 
       |       `--> See Section 2: Connection Status Diagnostics
       |
       +---> [HTTP 401, 400, 429, or 500 error on ESP32 Serial?]
       |       `--> See Section 3: API & Authentication Diagnostics
       |
       +---> [SD Card fails to mount or LittleFS full?]
       |       `--> See Section 4: Offline Storage & Storage Ceiling Diagnostics
       |
       +---> [Temperature reading is missing, null, or fluctuating?]
       |       `--> See Section 5: DS18B20 OneWire Sensor Diagnostics
       |
       +---> [Vibration readings are 0.0 or ADXL345 offline?]
       |       `--> See Section 6: ADXL345 & I2C Bus Diagnostics
       |
       +---> [Test LEDs or Red/Green status LEDs do not illuminate?]
               `--> See Section 7: LED Circuit & Command Diagnostics
```

---

## 2. Device Online / Offline Status Diagnostics

### 2.1 Understanding the 5 Connection States
The web dashboard and API calculate connection status **server-side** based strictly on the timestamp of the last authenticated telemetry or heartbeat received:

| Status Displayed | Server-Side Condition | Root Cause & Diagnostic Step |
|---|---|---|
| **`ONLINE`** (Green) | `last_seen_at` within last **25 seconds** | Nominal operation. ESP32 is actively communicating on its 5s cadence. |
| **`STALE`** (Amber) | `last_seen_at` between **25s and 120s** ago | Telemetry delayed or intermittent Wi-Fi packet drops. Check Wi-Fi RSSI. |
| **`OFFLINE`** (Grey) | `last_seen_at` exceeds **120 seconds** (2 minutes) | ESP32 has lost power, Wi-Fi disconnected, or cannot resolve DNS. |
| **`NEVER_CONNECTED`** | `last_seen_at` is `null` (no records exist) | Device token mismatch, invalid device ID, or device never booted with Wi-Fi. |
| **`API_ERROR`** (Red) | Dashboard cannot query `/api/telemetry/live` | Backend server outage, Supabase rate limit, or network disconnection on client. |

> [!IMPORTANT]
> **False Online Prevention:** The web dashboard does **not** consider browser polling, cached records, or webpage refreshes as evidence that the device is online. Only genuine records with verified server timestamps update `last_seen_at`.

### 2.2 Diagnosing Wi-Fi Disconnections
If the ESP32 Serial Monitor shows repeated `[WIFI] Reconnecting Wi-Fi in background...`:
1. **Check Wi-Fi Signal Strength (RSSI):**
   - Telemetry reports `wifi_rssi`. An RSSI weaker than **-80 dBm** indicates unacceptable signal attenuation.
   - Position the ESP32-S3 external antenna or orient the PCB antenna away from large motor casings.
2. **2.4 GHz vs 5.0 GHz Band:**
   - The ESP32-S3 radio **only supports 2.4 GHz Wi-Fi (802.11 b/g/n)**. If your router uses combined 2.4/5GHz SSIDs with band steering, create a dedicated 2.4 GHz SSID.
3. **Power Rail Sag During Transmission:**
   - Wi-Fi radio transmission draws up to 350 mA in microsecond bursts. If the 3.3V rail drops below 2.9V, the ESP32 Brownout Detector (BOD) will trigger a software reset.
   - Add a $100\,\mu\text{F}$ to $470\,\mu\text{F}$ electrolytic capacitor across the 5V and GND rail on your breadboard.

---

## 3. HTTP Status Codes & API Errors

When the ESP32 attempts an HTTPS upload to `/api/telemetry`, check the HTTP return code on the Serial Monitor (`115200 baud`):

### 3.1 `HTTP 401 Unauthorized`
- **Symptom:** Serial logs `[TELEMETRY] HTTP code: 401` or `[COMMAND-POLL] Failed: 401`.
- **Cause:** The `DEVICE_INGEST_TOKEN` in `firmware/secrets.h` does not match the `DEVICE_INGEST_TOKEN` environment variable configured in the Vercel project settings.
- **Remedy:**
  1. Go to Vercel Dashboard $\rightarrow$ Project Settings $\rightarrow$ Environment Variables.
  2. Verify that `DEVICE_INGEST_TOKEN` matches the secret string compiled into the ESP32 firmware.
  3. Re-flash the ESP32 after updating `firmware/secrets.h`.

### 3.2 `HTTP 400 Bad Request`
- **Symptom:** Serial logs `[TELEMETRY] HTTP code: 400` with response body `{"error":"Validation failed"}`.
- **Cause:** Telemetry payload violates the Zod validation schema (e.g., negative sample count, invalid timestamp format, or non-numeric RMS values).
- **Remedy:** Inspect the JSON payload emitted on Serial. Check for `NaN` or `null` values where numeric fields are expected.

### 3.3 `HTTP 429 Too Many Requests`
- **Symptom:** Serial logs `HTTP 429`.
- **Cause:** The ESP32 is uploading faster than the allowed rate limit (nominal interval is 5.0 seconds).
- **Remedy:** Verify that `REPORT_INTERVAL_MS` in firmware is set to `5000` (not a tight loop).

### 3.4 `HTTP 5xx Server / Database Error`
- **Symptom:** Serial logs `HTTP 500`, `HTTP 502`, or `HTTP 504`.
- **Cause:** The Vercel Serverless Function timed out, or Supabase database has paused or exceeded connection limits.
- **Remedy:**
  1. Open the Supabase dashboard and confirm the database is Active (not paused).
  2. Check Vercel Function logs at `/api/telemetry` for Postgres error stack traces.

---

## 4. Offline Storage & Storage Ceiling Diagnostics

### 4.1 MicroSD Card Mounting Failures
If Serial reports `[SD] MicroSD initialization failed!`:
1. **SPI Pin Mapping:** Verify wiring matches `pin_config.h`:
   - MOSI: GPIO 14
   - MISO: GPIO 13
   - SCK:  GPIO 12
   - CS:   GPIO 15
2. **Card Format:** The SD card **must be formatted as FAT32** (MBR partition). Cards formatted as exFAT, NTFS, or ext4 will fail to mount.
3. **Card Capacity:** Use standard MicroSD/SDHC cards ($\le 32\text{ GB}$). High-capacity SDXC cards ($>32\text{ GB}$) default to exFAT and are incompatible with standard Arduino `SD.h` without repartitioning.
4. **Voltage Level:** Ensure your SD card breakout board has a built-in 3.3V LDO or is powered strictly from the ESP32 3.3V rail. Connecting 5V directly to SD card SPI pins will destroy the card.

### 4.2 LittleFS Flash Storage 90% Ceiling
- **Symptom:** Telemetry reports `storage_used_pct >= 90.0` and `dropped_records_count > 0`.
- **Explanation:** To protect the ESP32 SPI flash from catastrophic exhaustion and wear-leveling failure, the firmware enforces a strict 90% capacity ceiling. When flash exceeds 90%, the oldest records are dropped to maintain operational headroom.
- **Remedy:**
  1. Restore Wi-Fi connectivity so the ESP32 can flush its pending sync queue to the cloud.
  2. Install a physical MicroSD card so the firmware automatically routes offline records to the high-capacity SD card instead of internal flash.

---

## 5. DS18B20 OneWire Sensor Diagnostics

### 5.1 Reading Shows `null` or `-127.0°C`
- **Root Cause:** A reading of `-127.0°C` or `null` indicates that the DS18B20 did not respond on the OneWire bus.
- **Remedy Checklist:**
  1. **Pull-Up Resistor:** OneWire is an open-drain bus. **A $4.7\,\text{k}\Omega$ pull-up resistor between the Data pin and 3.3V is mandatory**. Without this resistor, the bus floats high or low unpredictably.
  2. **Pin Assignment Verification:**
     - Motor Probe: GPIO 10 (`PIN_ONEWIRE_MOTOR`)
     - Ambient Probe: GPIO 11 (`PIN_ONEWIRE_AMBIENT`)
  3. **Wiring Integrity:** Ensure DS18B20 VDD is connected to 3.3V, GND to GND, and Data to GPIO 10 or 11.
  4. **Single Probe Mode:** If you only have one probe connected to GPIO 10, the dashboard will gracefully display `motor_temp` while marking `ambient_temp` as `null` with `probe_ambient: false`. This is normal, intended behavior.

### 5.2 Reading Shows `85.0°C`
- **Root Cause:** `85.0°C` is the default power-on reset value stored in the DS18B20 scratchpad. It indicates that the sensor received power, but a temperature conversion was never requested or timed out.
- **Remedy:** Ensure the firmware waits at least `750 ms` between calling `requestTemperatures()` and `getTempCByIndex(0)` when running in 12-bit resolution mode.

---

## 6. ADXL345 Accelerometer & I2C Bus Diagnostics

### 6.1 `[ADXL345] Device ID mismatch` or `I2C Bus Error`
- **Expected Device ID:** The ADXL345 `DEVID` register (0x00) must return `0xE5`.
- **Diagnostic Checklist:**
  1. **I2C Address:** 
     - SDO pin connected to GND $\rightarrow$ Address is `0x53`.
     - SDO pin connected to 3.3V $\rightarrow$ Address is `0x54`.
     - Firmware expects `0x53` (`PIN_I2C_SDA` on GPIO 8, `PIN_I2C_SCL` on GPIO 9).
  2. **CS (Chip Select) Pin:** In I2C mode, the ADXL345 **CS pin must be pulled HIGH to 3.3V**. Leaving CS floating causes the chip to oscillate between SPI and I2C modes.
  3. **I2C Pull-Up Resistors:** Most breakout boards (e.g., GY-291) include $4.7\,\text{k}\Omega$ or $10\,\text{k}\Omega$ pull-up resistors on SDA and SCL. If using bare sensor chips, you must add external pull-up resistors to 3.3V.

---

## 7. Diagnostic LED Circuit & Command Execution Diagnostics

### 7.1 Web Command Dispatched But LED Does Not Illuminate
1. **Confirm Command Status on Dashboard:**
   - Look at the Command History in the Technical View or LED Command Center:
     - `QUEUED`: The ESP32 has not polled the cloud yet (wait up to 5 seconds).
     - `EXECUTING`: The ESP32 received the command and set GPIO output HIGH.
     - `SUCCEEDED`: Command execution finished successfully.
     - `EXPIRED`: The ESP32 did not respond before the 30-second timeout.
2. **Current-Limiting Resistor:**
   - Each LED must have a **$330\,\Omega$ to $470\,\Omega$ resistor** in series between the ESP32 GPIO pin and the LED anode (long leg).
   - Connecting an LED directly to a GPIO without a resistor can exceed the ESP32's 40 mA pin limit and burn out the output driver.
3. **LED Polarity:**
   - Anode (Long leg) $\rightarrow$ Resistor $\rightarrow$ ESP32 GPIO
   - Cathode (Flat edge / short leg) $\rightarrow$ Common GND
4. **Authoritative Pin Map:**
   - Test LED 1: GPIO 4
   - Test LED 2: GPIO 5
   - Test LED 3: GPIO 6
   - Test LED 4: GPIO 7
   - Test LED 5: GPIO 16
   - Status Red:  GPIO 17
   - Status Green: GPIO 18
