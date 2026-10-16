# Troubleshooting & Diagnostics Guide

## Project: `industrial-motor-health-monitor`

This guide helps diagnose common connectivity, sensor, ingestion, and database issues.

---

### 1. Dashboard Shows "Disconnected" or "Feed Stale"

- **Check ESP32 Serial Monitor (115200 baud)**:
  - If it prints `Wi-Fi not connected`, verify `WIFI_SSID` and `WIFI_PASSWORD`. Note: ESP32-S3 DevKit connects to 2.4 GHz Wi-Fi networks (not 5 GHz).
  - If it prints `Upload Failed! Code: 401`, your `DEVICE_INGEST_TOKEN` in firmware does not match `DEVICE_INGEST_TOKEN` on the server.
  - If it prints `Upload Failed! Code: 400`, inspect the serial output for non-finite values (such as `nan` from disconnected probes).
- **Check Device Reporting Interval**:
  - The dashboard marks a device "Stale" if no packet arrives within 3x the configured reporting interval (minimum 10 seconds).

---

### 2. Temperature Probe Reads `-127.0 °C` or `85.0 °C`

- `-127.0 °C` indicates a disconnected DS18B20 1-Wire probe or missing 4.7 kΩ pull-up resistor between 3.3V and the DQ data pin.
- `85.0 °C` is the power-on reset state of the DS18B20 sensor. Add a delay (750 ms) after `sensors.requestTemperatures()` to allow the 12-bit conversion to complete before reading.

---

### 3. Accelerometer Readings Read Constant `0.00` or `nan`

- Verify ADXL345 I2C wiring (SDA = GPIO 8, SCL = GPIO 9 on default ESP32-S3, or your specific configured pins).
- Verify I2C address (default is `0x53`; if SDO is tied to VCC, address is `0x5D`).

---

### 4. Supabase Ingestion Errors

- If server logs show `Supabase telemetry insert failed: relation "public.telemetry" does not exist`:
  - Execute the database migrations in `supabase/migrations/00001_initial_schema.sql` inside the Supabase SQL Editor.
- If server logs show `JWSError: invalid signature`:
  - Ensure `SUPABASE_SECRET_KEY` in your environment matches the `service_role` secret from your new Supabase project (not the publishable anon key).

---

### 5. Playwright or Local Build Issues

- Ensure `npm run build` passes before running `npm run test:e2e`.
- If Playwright complains about missing browsers, run:
  ```bash
  npx playwright install chromium
  ```
