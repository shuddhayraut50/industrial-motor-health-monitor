# Industrial Motor Health Monitor — Test & Verification Report

This report documents the automated software test results, firmware compilation checks, and the step-by-step physical bench tests required to verify the hardware implementation.

---

## 1. Automated Software Verification Summary

All automated checks were executed locally in the project environment and passed with zero errors:

| Test Suite / Tool | Scope | Target | Result | Notes |
|---|---|---|:---:|---|
| **PlatformIO GCC 8.4.0** | ESP32-S3 Firmware Compilation | `esp32-s3-devkitc-1` (N16R8) | **PASSED** | RAM: 14.3% (46.7KB / 327.6KB)<br>Flash: 30.4% (1016.4KB / 3.34MB)<br>ELF binary generated cleanly. |
| **Vitest Unit Tests** | Validation & DB Helpers | `npm test` | **PASSED** | **52 / 52 passed** (100%)<br>Covers telemetry schemas, command validation, status calculation, and storage limits. |
| **TypeScript Compiler** | Type Safety & Strict Checking | `npm run typecheck` | **PASSED** | **0 errors**. All new types, command routes, and components strictly typed. |
| **ESLint** | Code Quality & Style | `npm run lint` | **PASSED** | **0 errors, 0 warnings**. |
| **Next.js Turbopack Build** | Production Web Application | `npm run build` | **PASSED** | All 17 static and dynamic API routes compiled cleanly into production bundle. |
| **Playwright E2E Tests** | End-to-End User Journeys | `npx playwright test` | **PASSED** | **34 / 34 passed** (100%)<br>Covers dashboard loading, sensor fault tolerance, history views, and metrics. |

---

## 2. Firmware Compilation Verification Details

- **Target Microcontroller:** ESP32-S3-WROOM-1 / DevKitC-1 (Xtensa dual-core 240MHz, 16MB Flash, 8MB PSRAM)
- **Compiler:** `xtensa-esp32s3-elf-g++` (8.4.0) via PlatformIO Core 6.1.16
- **Build Output:**
  ```text
  Retrieving maximum program size .pio\build\esp32s3\firmware.elf
  Checking size .pio\build\esp32s3\firmware.elf
  RAM:   [=         ]  14.3% (used 46788 bytes from 327680 bytes)
  Flash: [===       ]  30.4% (used 1016469 bytes from 3342336 bytes)
  Building .pio\build\esp32s3\firmware.bin
  Creating esp32s3 image...
  Merged 2 ELF sections
  Successfully created esp32s3 image.
  ========================= [SUCCESS] Took 17.80 seconds =========================
  ```
- **Firmware Features Compiled:**
  - Authoritative pin mapping (`pin_config.h`).
  - Core 0 continuous 200 Hz accelerometer sampling engine.
  - Core 1 statistical calculation and ISO 10816 condition classification engine with debounce.
  - Non-blocking `millis()` state machine for 5-LED diagnostics and Red/Green status indicators.
  - Two-way command polling (`/api/device/commands/poll`) and acknowledgment (`/api/device/commands/ack`).
  - Durable offline storage hierarchy: MicroSD SPI primary + LittleFS internal flash fallback with 90% ceiling enforcement.
  - TLS certificate verification using Google Trust Services (`VERCEL_ROOT_CA_CERT`).

---

## 3. Physical Bench Tests Required (User Hardware Verification)

> [!IMPORTANT]
> In accordance with non-negotiable project guidelines: **Software compilation and simulated API tests do not prove physical operation.** The following physical bench tests must be conducted on the workbench with the hardware connected before declaring physical validation complete.

### Test H-1: Visual Verification of the 5 Test LEDs
- **Objective:** Confirm physical illumination of Test LEDs 1 through 5 and verify no interference with vibration sampling.
- **Procedure:**
  1. Wire Test LEDs 1 to 5 to GPIO 4, 5, 6, 7, and 16 with $330\,\Omega$ series resistors to Common GND.
  2. Open the web dashboard and switch to **Technical View**.
  3. Locate the **LED Diagnostic Command Center**.
  4. Click **Run Sequential LED Chaser**.
  5. Verify that LEDs 1 through 5 illuminate one by one in sequence.
  6. Click each individual test button (LED 1 through LED 5) and verify only the selected LED pulses.
  7. Check the Serial Monitor during the test to verify that the 200 Hz accelerometer task reports zero missed sample slots.
- **Pass Criteria:** Each LED physically illuminates when commanded, and 5-second sample count remains $\ge 980$ samples.

---

### Test H-2: Red & Green Status Indication Patterns
- **Objective:** Verify distinguishable optical patterns for normal, warning, critical, and fault states.
- **Procedure:**
  1. Wire Green LED to GPIO 18 and Red LED to GPIO 17 with $330\,\Omega$ resistors.
  2. Power on the ESP32 with normal sensor connections.
  3. Confirm the **Green LED pulses steadily** (heartbeat) during normal operation with successful telemetry uploads.
  4. Disconnect the ADXL345 SDA wire (GPIO 8) to induce a sensor fault.
  5. Confirm the **Red LED begins blinking** and Green LED turns off.
  6. Reconnect the SDA wire and confirm automatic recovery to Green heartbeat.
- **Pass Criteria:** Red and Green LEDs unambiguously communicate health states without rapid, confusing flicker.

---

### Test H-3: MicroSD Offline Storage & Reconnection Recovery
- **Objective:** Verify append-only offline queuing, 90% ceiling safety, and cloud synchronization upon Wi-Fi recovery.
- **Procedure:**
  1. Insert a FAT32-formatted 16GB or 32GB MicroSD card into the SPI module.
  2. Power the ESP32 and allow it to establish connection and upload initial telemetry.
  3. Turn off your Wi-Fi router or hotspot for 2 minutes (approx. 24 reporting cycles).
  4. Observe Serial Monitor: verify the ESP32 logs `[QUEUE] Saved offline record` without crashing.
  5. Restore the Wi-Fi network.
  6. Verify the ESP32 automatically flushes queued records to `/api/telemetry`.
  7. Check the web dashboard History view: verify that telemetry timestamps match the outage period without gaps and without overwriting current data.
- **Pass Criteria:** 100% of offline records are recovered and displayed with their original measurement timestamps.

---

### Test H-4: LittleFS Internal Flash Fallback (SD Card Missing)
- **Objective:** Verify bounded fallback logging when the MicroSD card is intentionally removed.
- **Procedure:**
  1. Remove the MicroSD card from the socket.
  2. Power cycle the ESP32.
  3. Disconnect Wi-Fi for 60 seconds.
  4. Verify the ESP32 logs: `[SD] MicroSD unavailable, falling back to LittleFS flash`.
  5. Confirm `storage_medium` reports `LittleFS Flash` and `storage_used_pct` is within the 90% ceiling.
  6. Reconnect Wi-Fi and verify the flash queue flushes successfully.
- **Pass Criteria:** The system never halts or silently drops data when the SD card is absent.

---

### Test H-5: Power Rail Stability Under Wi-Fi Transmission
- **Objective:** Ensure the 3.3V power rail does not brown out during Wi-Fi transmission bursts.
- **Procedure:**
  1. Connect a Digital Multimeter (DMM) or oscilloscope between the ESP32 3.3V pin and GND pin.
  2. Observe the voltage during the 5-second upload window.
  3. Verify that the voltage remains strictly between **$3.15\text{V}$ and $3.35\text{V}$** and never dips below $3.0\text{V}$.
- **Pass Criteria:** No brownout resets (`BOD`) occur on the Serial Monitor.

---

## 4. Known Limitations & Recommended Future Work

1. **Physical LED Feedback:** Firmware acknowledgment confirms that the ESP32 GPIO was commanded HIGH; it does not measure optical photons or current flow. True closed-loop confirmation requires an optical photodiode or current-sensing resistor.
2. **Predictive Maintenance Baseline:** The current vibration classification follows standard ISO 10816-1 general rotating machinery limits. For precision fault diagnosis (e.g., inner/outer bearing race ball-pass frequencies), a baseline calibration run on a healthy motor under steady load should be recorded to establish custom motor-specific RMS thresholds.
3. **Single DS18B20 Ambient Mode:** Until a second physical DS18B20 probe is wired to GPIO 11, the ambient temperature will report `null` and thermal rise ($\Delta T$) is intentionally gated to prevent fabricated differentials.
