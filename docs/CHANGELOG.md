# Industrial Motor Health Monitor — Changelog

All notable changes, architectural improvements, and pin mappings for the Industrial Motor Health Monitor are documented in this file.

## [v1.6.0-hardened] — 2026-10-18: Final Engineering Hardening & Production Reliability

### 1. Embedded Firmware Reliability Upgrades (ESP32-S3)
- **Explicit TLS Socket Teardown:** Added explicit `client.stop()` following `http.end()` across all HTTPS requests (`sendTelemetryPayload`, `sendDiagnosticEventPayload`, `sendDeviceCommandAck`, `pollDeviceCommands`). Prevents TCP socket leaks in `TIME_WAIT` state and fixes the 2-minute connection drop. Verified across 400+ consecutive uploads on COM12.
- **Enhanced LED State Machine & 4-LED Meter:**
  - Integrated 4-LED dynamic vibration meter on Test LEDs 1–4: LED 1 OFF (baseline $<0.04g$), slow blink (small variation), medium blink, fast blink, and continuous solid ON ($\ge 0.25g$ or `CRITICAL`).
  - Added dedicated double-pulse blinking pattern on Test LEDs 1–4 to indicate which sensor probe is disconnected or faulty:
    - LED 1 (GPIO 4): ADXL345 accelerometer error.
    - LED 2 (GPIO 5): Motor DS18B20 temp probe error (GPIO 10).
    - LED 3 (GPIO 6): Ambient DS18B20 temp probe error (GPIO 11).
    - LED 4 (GPIO 7): DS3231 RTC clock module error (I2C 0x68).
  - Test LED 5 (GPIO 16) physically unpopulated on bench; firmware forces GPIO 16 LOW and restricts diagnostic chaser sequences to LEDs 1–4.
  - Green Status LED (GPIO 18): Solid ON when connected and fresh; 1 Hz slow blink (500ms ON / 500ms OFF) when machine is normal but Wi-Fi link is disconnected / logging offline.
  - Red Status LED (GPIO 17): OFF (Normal); 1 Hz slow blink (Sensor probe fault); 2 Hz fast blink (Vibration warning); Solid ON (Critical alarm).
- **Backlog Queue HTTP Retry & Quarantine Policy:**
  - HTTP 2xx & 409 (Conflict): Confirmed accepted / idempotent duplicate already persisted $\rightarrow$ safely remove from queue, reset backoff to 400 ms.
  - HTTP 400 & 422: Malformed payload / schema mismatch $\rightarrow$ quarantined to `/quarantine` (SD) or `/lfs_quar` (LittleFS) without blocking subsequent live or backlog telemetry.
  - HTTP 401 & 403: Auth / token failure $\rightarrow$ preserve data in queue, backoff 30 seconds, alert operator.
  - HTTP 429: Rate limited $\rightarrow$ preserve data, backoff 15 seconds.
  - HTTP 408, 5xx & Connection Errors: Preserve data, apply bounded exponential backoff up to 60 seconds.
- **Queue Starvation Resolution:** Decoupled live telemetry from offline queue processing so historical uploads never block or delay live telemetry packets.

### 2. Backend & Dashboard Display Accuracy
- **MicroSD Buffer vs. Flash Fallback Separation:**
  - Separated storage status into distinct UI cards in Technical View:
    1. **MicroSD Buffer:** Authoritatively displays hardware SPI card state: "Card Missing", "Ready", "Mount Failed", or "Card Full" on SPI CS 15.
    2. **Flash Fallback:** Displays internal LittleFS non-volatile buffer state: "Active Fallback" or "Standby Ready" with actual partition utilization percentage.
    3. **Telemetry Buffer Queue:** Displays the exact count of pending unsynchronized records and oldest pending timestamp.
- **Diagnostic Event Idempotency:** Verified deterministic UUID conversion (`toDeterministicUuid`) mapping string event identifiers to valid RFC4122 v4 UUIDs for conflict-safe deduplication in PostgreSQL.
- **API Enrichments:** Updated `/api/devices` to include explicit `storage_diagnostics` and expanded `sensor_health` fields.

### 3. Documentation & Verification
- `docs/FINAL_HARDENING_AUDIT.md`: Complete repository audit, Graphify code map link, and root-cause analyses.
- `docs/FINAL_HARDENING_TEST_REPORT.md`: Comprehensive test report covering Vitest unit tests (65/65 passed), production build, COM12 flashing, and sustained run performance.
- `docs/LED_BEHAVIOR_GUIDE.md`: Dedicated operator guide detailing LED meanings, blink frequencies, vibration levels, and sensor fault double-pulse codes.

---

## [v1.5.0-fast-rt] — 2026-10-17: Urgent Fast Vibration Detection & Immediate LED Driver

### 1. Embedded Firmware Real-Time Segregation (ESP32-S3)
- **Core 0 Dedicated Real-Time Task (`RT_VibeEngine`):**
  - High-priority FreeRTOS task (Priority 5) pinned to Core 0, completely isolated from Arduino networking, Wi-Fi stack, and lwIP.
  - Maintains strict 200 Hz continuous ADXL345 accelerometer acquisition ($5000\,\mu\text{s}$ interval) with $\pm 12\,\mu\text{s}$ jitter.
- **Fast 250 ms Rolling RMS Engine:**
  - Replaced 5-second classifier latency with an $O(1)$ constant-time circular rolling window (50 samples = 250 ms).
  - Fast condition evaluation runs every 250 ms: immediate transition to `CRITICAL` ($<250\text{ ms}$ detection), 2-cycle debounce for `WARNING` ($500\text{ ms}$), and 3-cycle/10% hysteresis for recovery.
- **Sub-Millisecond Physical LED Driver:**
  - Physical LED state changes are executed immediately after condition decisions ($<1\text{ ms}$ measured latency, well below the $<20\text{ ms}$ target).
  - Added Safety Priority Override: Active `CRITICAL` alarm immediately aborts any user diagnostic tests (`LED_TEST_ALL` / `LED_TEST_SINGLE`) and triggers urgent 200 ms flash.
- **Background Pipeline Isolation (Core 1):**
  - Core 1 handles 5-second telemetry formatting, MicroSD/LittleFS writes, HTTPS uploads, non-blocking Wi-Fi backoff, and command polling.
  - Telemetry snapshots are dispatched from Core 0 to Core 1 via a bounded FreeRTOS queue (`telemetrySnapshotQueue`), completely preventing HTTP timeouts (up to 4.5s) or SD flushes from stalling sensor acquisition or LED updates.
- **Low-Overhead Monotonic Instrumentation:**
  - Integrated `esp_timer_get_time()` measuring microsecond sample intervals, RMS calculation duration ($6\,\mu\text{s}$), decision-to-LED latency ($2\text{--}5\,\mu\text{s}$), and FreeRTOS stack high water marks.

---

## [v1.4.0] — 2026-10-17: Major System Upgrade

### 1. Embedded Firmware (ESP32-S3)
- **Authoritative Pin Map:** Created `firmware/pin_config.h` as the single machine-readable source of truth for all GPIO assignments. Removed scattered duplicate definitions.
- **Local Condition Classification Engine:** Implemented local edge condition evaluation (`GOOD`, `CHECK`, `WARNING`, `CRITICAL`, `UNKNOWN`) calculated directly on the ESP32 within every 5-second reporting window. Added 2-cycle escalation debounce and 3-cycle/10% hysteresis to prevent alarm flutter.
- **Diagnostic LED Engine:**
  - Configured 5 test LEDs (GPIO 4, 5, 6, 7, 16) driven as a real-time vibration severity meter during normal operation.
  - Implemented non-blocking `millis()` state machine supporting remote diagnostic commands (`LED_TEST_ALL` and `LED_TEST_SINGLE`) without interrupting Core 0's continuous 200 Hz accelerometer sampling.
  - Separate Red (GPIO 17) and Green (GPIO 18) status indicators with distinct operational blink patterns for normal, warning, critical, offline, and fault states.
- **Two-Way Command Polling & Execution:**
  - Added periodic polling against `/api/device/commands/poll` on the 5-second telemetry cadence.
  - Implemented acknowledgment pipeline dispatching `EXECUTING`, `SUCCEEDED`, or `FAILED` states to `/api/device/commands/ack`.
  - Added command replay protection to prevent duplicate execution during network retries.
- **Offline Storage Hierarchy & 90% Ceiling:**
  - Primary offline store: Append-only JSONL logging on MicroSD over SPI.
  - Fallback store: Bounded internal LittleFS flash logging when SD is absent or fails.
  - Strict 90% capacity ceiling policy: Prunes oldest queue files to preserve at least 10% operational headroom.
  - Tracks and transmits `storage_medium`, `storage_used_pct`, `pending_records_count`, and `dropped_records_count` in telemetry payloads.
- **TLS Security Fix:** Standardized all secure HTTP requests (`sendTelemetryPayload`, `sendDeviceCommandAck`, `pollDeviceCommands`) to use `VERCEL_ROOT_CA_CERT` from `certificates.h` for Google Trust Services root verification.

---

### 2. Cloud API & Backend Services (Next.js 16 & Supabase)
- **Database Schema Migration (`00006_device_commands_and_modes.sql`):**
  - Created `public.device_commands` table with full audit lifecycle (`CREATED`, `DELIVERED`, `EXECUTING`, `SUCCEEDED`, `FAILED`, `EXPIRED`), execution timestamps, requesting user, and JSONB results.
  - Added `condition_status` (`GOOD`, `CHECK`, `WARNING`, `CRITICAL`, `UNKNOWN`) and `condition_reason` to `public.motor_telemetry`.
  - Added storage diagnostic columns (`storage_medium`, `storage_used_pct`, `dropped_records_count`) to `public.motor_telemetry`.
  - Extended `public.device_config` with configurable alert threshold boundaries.
- **Server-Side Online/Offline Calculation:**
  - Fixed false-online reporting. Created `calculateDeviceConnectionStatus()` evaluating genuine `last_seen_at` timestamps against explicit thresholds:
    - `ONLINE`: $\le 25\text{s}$
    - `STALE`: $25\text{s}$ to $120\text{s}$
    - `OFFLINE`: $> 120\text{s}$
    - `NEVER_CONNECTED`: `last_seen_at` is null
    - `API_ERROR`: Endpoint failure
- **Command API Endpoints:**
  - `POST /api/device/commands`: Authenticated endpoint to validate and queue new device commands.
  - `GET /api/device/commands`: Endpoint to list active and historical commands with execution logs.
  - `POST /api/device/commands/poll`: Authenticated device endpoint (`x-device-token`) for ESP32 to retrieve pending commands.
  - `POST /api/device/commands/ack`: Authenticated device endpoint for ESP32 to acknowledge execution and upload results.
- **Telemetry Enhancements:**
  - `GET /api/telemetry/live`: Returns server-side connection status, local condition classification, storage metrics, and sensor availability.
  - `GET /api/telemetry/history`: Added support for 12-hour (`43200s`) and 24-hour (`86400s`) indexed windows, and updated CSV export to include condition and storage diagnostics.

---

### 3. Web User Interface & Dashboard
- **Dual Dashboard Modes (Simple vs. Technical):**
  - Segmented toggle at the top of the dashboard allowing instant switching between Simple View and Technical View.
  - User preference persisted to `localStorage` and synchronized via URL parameter (`?mode=simple` or `?mode=technical`).
  - **Simple View:** Designed for plant operators with large, non-technical condition banners (`GOOD`, `CHECK`, `WARNING`, `CRITICAL`), plain-English explanations, and recommended maintenance actions.
  - **Technical View:** Retains full engineering telemetry cards: 3-axis vibration metrics, temperature rise ($\Delta T$), sample quality stats, I2C bus metrics, storage partition utilization, and network logs.
- **Interactive LED Diagnostic Command Center:**
  - Dedicated diagnostic panel to test the 5 hardware test LEDs directly from the browser.
  - Buttons for sequential chaser test (`LED_TEST_ALL`) and individual LED pulses 1 through 5 (`LED_TEST_SINGLE`).
  - Live execution status polling, command ID tracking, and explicit disclaimer reminding operators that physical illumination requires optical inspection.
- **12-Hour & 24-Hour Time-Window Selectors:**
  - Added 12 Hours (`12h`) and 24 Hours (`24h`) buttons across Live and History views.
  - Preserved timeseries line breaks across missing sensor intervals to avoid misleading interpolated data.

---

### 4. Documentation Suite
- `docs/UPGRADE_AUDIT.md`: System audit, root-cause analysis, storage hierarchy, and command flow diagram.
- `docs/HARDWARE_PIN_MAP.md`: Master wiring reference table, bus connections, and electrical guidelines.
- `docs/SYSTEM_GUIDE.md`: Comprehensive operational manual covering architecture, power safety, and local condition logic.
- `docs/TROUBLESHOOTING.md`: Step-by-step diagnostic workflows for network, API, storage, and sensor issues.
- `docs/COMMAND_REFERENCE.md`: Complete API schemas, payloads, and lifecycle states for all device commands.
- `docs/HARDWARE_PURCHASE_LIST.md`: Itemized component Bill of Materials, electrical ratings, and jumper-wire requirements.
- `docs/TEST_REPORT.md`: Comprehensive test report covering automated builds, unit/E2E test results, and physical bench test procedures.
