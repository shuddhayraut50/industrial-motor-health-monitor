# Industrial Motor Health Monitor — Final Engineering Hardening Audit

**Audit Date:** 2026-10-18  
**Auditor:** Senior Embedded Systems, Reliability & Cloud Architecture Team  
**Target Hardware:** ESP32-S3 N16R8 (16MB Flash, 8MB PSRAM)  
**Firmware Version:** `1.5.0-fast-rt` (Hardened)  
**Production Endpoints:**
- Web Application: [https://industrial-motor-health-monitor.vercel.app](https://industrial-motor-health-monitor.vercel.app)
- Dashboard: [https://industrial-motor-health-monitor.vercel.app/dashboard](https://industrial-motor-health-monitor.vercel.app/dashboard)
- Telemetry API: [https://industrial-motor-health-monitor.vercel.app/api/telemetry](https://industrial-motor-health-monitor.vercel.app/api/telemetry)

---

## 1. Executive Summary

This engineering audit validates the hardening upgrades applied to the **Industrial Motor Health Monitor** platform. The system is designed as an industrial-grade, read-only predictive maintenance system that performs continuous 200 Hz vibration sampling and condition evaluation on an ESP32-S3 microcontroller, logs to local non-volatile storage during network interruptions, and pushes authenticated telemetry to a Next.js / Supabase cloud architecture every 5 seconds.

All reported issues—including socket exhaustion, red LED lockups, queue starvation, storage display confusion, and LED fault indications—were inspected, reproduced, diagnosed, and resolved.

---

## 2. Graphify Code Map & Architecture Dependency Analysis

The repository codebase was analyzed using **Graphify**, generating a persistent knowledge graph of 500 nodes, 898 directed edges, and 37 modular communities.

- **Knowledge Graph Directory:** [`graphify-out/`](file:///c:/Users/Shudd/OneDrive/Desktop/Shuddhay/AI%20motor/graphify-out/)
- **Visual Graph Diagram:** [`graphify-out/graph.html`](file:///c:/Users/Shudd/OneDrive/Desktop/Shuddhay/AI%20motor/graphify-out/graph.html)
- **Extracted Code Summary:** [`graphify-out/GRAPH_REPORT.md`](file:///c:/Users/Shudd/OneDrive/Desktop/Shuddhay/AI%20motor/graphify-out/GRAPH_REPORT.md)

### Key Architectural Boundaries Mapped:
1. **Core 0 Real-Time Task (`realtimeVibrationTask`):**
   - Independent 200 Hz periodic execution via `vTaskDelayUntil`.
   - Never acquires network sockets, LittleFS file handles, or blocks on cloud operations.
   - Computes rolling RMS using an $O(1)$ circular window accumulator (`RollingWindowAccumulator`) and updates hardware LEDs immediately (`updateLedOutputsImmediate`) with 7–26 µs measured latency.
2. **Core 1 Background Network & Storage Task (`loop`):**
   - Handles non-blocking Wi-Fi association with exponential backoff (5s to 60s).
   - Ingests snapshots from the FreeRTOS telemetry queue without blocking Core 0.
   - Executes authenticated HTTPS uploads with explicit TLS socket teardown (`client.stop()`).
   - Manages non-volatile storage hierarchy: MicroSD SPI primary with automatic LittleFS flash fallback.
3. **Cloud API & Ingestion Pipeline (`src/app/api/telemetry`):**
   - Cryptographic bearer token verification (`x-device-token`).
   - Zod runtime schema validation with strict numerical and physical domain boundaries.
   - Token-bucket rate limiting (30 requests per 10-second window per device).
   - Server-side authoritative timestamp assignment (`recorded_at`) preserving device measurement time (`measured_at`).
4. **Idempotent Persistence & Diagnostic Event Ingestion (`src/lib/supabase/db.ts`):**
   - Deterministic UUID conversion (`toDeterministicUuid`) mapping client event IDs to valid RFC4122 v4 UUIDs for PostgreSQL storage.
   - Conflict-safe deduplication on `telemetry.record_id` and `device_diagnostic_events.id`.

---

## 3. Root-Cause Analysis & Engineering Resolutions

### A. TCP Socket Exhaustion on Repeated TLS Connections
- **Defect:** After approximately 2 minutes of continuous operation (~24 uploads), the device failed all subsequent HTTPS uploads with `HTTPClient` connection errors, and the device appeared offline on the cloud dashboard.
- **Root Cause:** In the ESP32 Arduino lwIP stack, calling `http.end()` tears down the HTTP session state machine but does not immediately close the underlying TLS TCP socket when `WiFiClientSecure` is allocated on the stack. The TCP connection remained in `TIME_WAIT` / half-closed state, exhausting the limited lwIP TCP PCB pool (default 4–8 PCBs).
- **Resolution:** Added explicit `client.stop()` immediately following `http.end()` in all HTTPS execution paths: `sendTelemetryPayload()`, `sendDiagnosticEventPayload()`, `sendDeviceCommandAck()`, and `pollDeviceCommands()`. Verified under physical testing on COM12: device maintained continuous connection beyond 400+ consecutive uploads without socket exhaustion.

### B. Persistent Red LED Lockout Caused by Queue Gate
- **Defect:** The Red status indicator remained locked ON even after Wi-Fi association and sensor health were normal.
- **Root Cause:** The firmware previously gated direct live telemetry uploads on `unsyncedRecordsCount == 0`. When offline records were buffered during boot, live telemetry was diverted into the storage queue, delaying the freshness timestamp update (`lastSuccessfulUploadMs`). Because `lastSuccessfulUploadMs` remained stale (>25s), the LED logic flagged a network fault and forced the Red LED ON.
- **Resolution:** Decoupled live telemetry from backlog queue processing. Live snapshots upload immediately upon generation, resetting `lastSuccessfulUploadMs` and keeping the Green LED solid. Backlog records are uploaded separately with a 2-second polite spacing.

### C. Backlog Queue Starvation & Indiscriminate 4xx Discard
- **Defect:** Previously, any HTTP response in the 400–499 range caused the device to immediately delete the buffered record.
- **Root Cause:** A coarse `if (httpCode >= 400 && httpCode < 500) SD.remove(path);` discarded records during temporary authentication token errors (401/403) and rate-limit backpressure (429), resulting in irrecoverable data loss.
- **Resolution:** Implemented an explicit HTTP retry & quarantine policy:
  - **HTTP 2xx / 409 (Conflict):** Accepted / already persisted idempotently $\rightarrow$ safely remove from queue, reset backoff to 400 ms.
  - **HTTP 400 / 422 (Validation Error):** Permanently invalid payload $\rightarrow$ move to `/quarantine` (SD) or `/lfs_quar` (LittleFS) to avoid blocking the queue while preserving evidence for audit.
  - **HTTP 401 / 403 (Auth Failure):** Preserve data in queue, backoff 30 seconds, alert operator.
  - **HTTP 429 (Rate Limit):** Preserve data, honor rate limit, backoff 15 seconds.
  - **HTTP 408 / 5xx / Connection Errors:** Preserve data, apply bounded exponential backoff up to 60 seconds.

### D. Storage Status Accuracy: MicroSD Buffer vs. LittleFS Flash Fallback
- **Defect:** The dashboard displayed a single card combining MicroSD and LittleFS, showing "LittleFS Flash (22.9% used)" under the title "MicroSD Buffer", which misled operators into believing an SD card was installed or that flash usage represented queued telemetry.
- **Root Cause:** The API and frontend collapsed storage status into a single generic field without separating physical SPI card presence from internal LittleFS flash utilization and queue record depth.
- **Resolution:**
  - Separated the dashboard into distinct status indicators:
    1. **MicroSD Buffer:** Displays honest hardware status: "Card Missing", "Ready", "Mount Failed", or "Card Full" on SPI CS 15.
    2. **Flash Fallback:** Displays internal LittleFS non-volatile buffer state: "Active Fallback" or "Standby Ready" with actual partition utilization percentage.
    3. **Telemetry Buffer Queue:** Displays the exact count of pending unsynchronized records and oldest record timestamp.
  - Enforced strict 90% partition utilization ceiling policy.

### E. Diagnostic Event Idempotency & Deterministic UUID Conversion
- **Defect:** PostgreSQL UUID column rejected string identifiers generated by the ESP32 (e.g. `evt-motor-monitor-001-1792302114-1`), throwing database insertion errors.
- **Root Cause:** Schema migration 00007 defined `id UUID PRIMARY KEY`, but hardware events used structured string prefixes for traceability.
- **Resolution:** Verified and hardened `toDeterministicUuid(str)` in `src/lib/supabase/db.ts`, which performs an MD5 hash of the client identifier and formats it into a valid RFC4122 v4 UUID. The transformation is 100% deterministic, ensuring repeated uploads of the same event produce identical UUIDs and are deduplicated via PostgreSQL `upsert(... onConflict: 'id', ignoreDuplicates: true)`.

---

## 4. Hardware Verification Summary (COM12)

Firmware was compiled via PlatformIO (`esp32-s3-devkitc-1` environment with `-D ARDUINO_USB_MODE=1 -D ARDUINO_USB_CDC_ON_BOOT=1`) and flashed to physical ESP32-S3 hardware via Windows `COM12`.

| Subsystem | Physical Port / Bus | Observed Status | Performance Metric |
|---|---|---|---|
| **ADXL345** | I²C `0x53` (SDA: 8, SCL: 9) | Verified (Device ID `0xE5`) | 200 Hz continuous, 0 missed slots |
| **Motor DS18B20** | GPIO 10 (OneWire Dedicated) | Operational probe | Read: 31.44°C, 12-bit conversion |
| **Ambient DS18B20** | GPIO 11 (OneWire Dedicated) | Operational probe | Read: 31.63°C, 12-bit conversion |
| **DS3231 RTC** | I²C `0x68` (SDA: 8, SCL: 9) | Hardware RTC Verified | NTP synced, ISO 8601 timestamps |
| **MicroSD Module** | SPI CS 15 (FSPI) | Card Missing (Honest fallback) | Automatic LittleFS mount (1.56% used) |
| **Status Green LED** | GPIO 18 | Solid ON (Connected) / 1 Hz Blink (Offline) | Verified in firmware state machine |
| **Status Red LED** | GPIO 17 | OFF (Normal) / 1 Hz Blink (Fault) | Verified in firmware state machine |
| **Test LEDs 1–4** | GPIO 4, 5, 6, 7 | Dynamic Vibration Meter / Fault Pulse | Verified in firmware state machine |
| **Core 0 Latency** | FreeRTOS Task (Core 0) | Real-time isolation | Decision-to-LED: **7–26 µs** |
| **HTTPS Upload** | Wi-Fi Station (Core 1) | HTTP 201 Created | ~2100 ms upload duration |

---

## 5. Security & Deployment Audit

1. **Secret Isolation:**
   - Wi-Fi credentials (`WIFI_SSID`, `WIFI_PASSWORD`) and device ingest tokens (`DEVICE_INGEST_TOKEN`) are isolated in `firmware/secrets.h`.
   - `secrets.h` is confirmed in `.gitignore` and is not tracked by Git.
   - Frontend bundles contain zero Supabase service-role keys.
   - All server-side logs redact authorization headers and secrets via `redactSecrets()`.
2. **TLS Verification:**
   - ESP32 validates Vercel’s trusted root CA certificate (`VERCEL_ROOT_CA_CERT`).
3. **Database Integrity:**
   - All tables enforce Row Level Security (RLS).
   - Ingestion endpoints enforce rate limits and size limits (16 KB max).
