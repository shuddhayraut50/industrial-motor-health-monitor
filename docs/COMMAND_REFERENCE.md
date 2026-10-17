# Industrial Motor Health Monitor — Two-Way Command Reference

This document defines the complete catalog of authorized device commands, JSON payload structures, parameter schemas, execution lifecycles, and acknowledgment specifications for the Industrial Motor Health Monitor.

---

## 1. Security & Authentication Architecture

1. **Web-to-Cloud Authorization:**
   - Operators submit commands through the web dashboard via `POST /api/device/commands`.
   - The endpoint validates the user's role and authorization, verifies the JSON schema using Zod, and assigns a cryptographically unique `command_id` (UUIDv4).
2. **Device-to-Cloud Authentication:**
   - The ESP32-S3 polls `POST /api/device/commands/poll` on its 5-second cadence.
   - The ESP32 must provide the pre-shared secret header: `x-device-token: <DEVICE_INGEST_TOKEN>`.
   - The device never receives service role keys or direct database access credentials.
3. **Replay & Concurrency Protection:**
   - The ESP32 tracks the last processed `command_id`. If a command ID has already been executed, the ESP32 acknowledges the duplicate without re-triggering GPIO routines.
   - Only non-blocking diagnostic commands are permitted during active motor vibration monitoring. Machine start/stop commands are strictly prohibited by firmware design.

---

## 2. Command Lifecycle States

```
+-----------+     ESP32 Polls     +-------------+     ESP32 Starts     +-------------+     Execution Ends     +-------------+
|  CREATED  | ------------------> |  DELIVERED  | -------------------> |  EXECUTING  | ---------------------> |  SUCCEEDED  |
+-----------+                     +-------------+                      +-------------+                        +-------------+
      |                                                                                                              |
      | (If timeout_seconds expires)                                                                                 v
      v                                                                                                       +-------------+
+-----------+                                                                                                 |   FAILED    |
|  EXPIRED  |                                                                                                 +-------------+
+-----------+
```

| Lifecycle State | Description |
|---|---|
| **`CREATED`** | The command was validated and persisted to `public.device_commands`. Waiting for ESP32 to poll. |
| **`DELIVERED`** | The ESP32 received the command during its 5-second polling cycle. |
| **`EXECUTING`** | The ESP32 acknowledged receipt and commenced the requested non-blocking operation. |
| **`SUCCEEDED`** | The requested routine completed normally, and the ESP32 dispatched its result payload. |
| **`FAILED`** | An error occurred during validation, bus communication, or execution on the ESP32. |
| **`EXPIRED`** | The command was not retrieved by the ESP32 within `timeout_seconds` (default: 30 seconds). |

---

## 3. Supported Commands Catalog

### 3.1 `LED_TEST_ALL` (Sequential Chaser Test)
Sequentially illuminates Test LED 1 through Test LED 5 with a configurable step interval, verifying optical function without blocking vibration acquisition.

- **Parameters Schema:**
  ```json
  {
    "step_duration_ms": 500
  }
  ```
  - `step_duration_ms` (integer, optional, default: 500, range: 100 to 2000): Duration in milliseconds that each individual LED remains illuminated.
- **ESP32 Initial ACK (`EXECUTING`):**
  ```json
  {
    "command_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "status": "EXECUTING",
    "result": { "state": "running_all", "step_ms": 500 }
  }
  ```
- **ESP32 Completion ACK (`SUCCEEDED`):**
  ```json
  {
    "command_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "status": "SUCCEEDED",
    "result": {
      "led_sequence": [4, 5, 6, 7, 16],
      "duration_total_ms": 2500,
      "disclaimer": "Physical illumination must be verified by visual inspection"
    }
  }
  ```

---

### 3.2 `LED_TEST_SINGLE` (Single LED Verification)
Illuminates a single specified Test LED for a bounded duration before returning it to the local vibration indicator state.

- **Parameters Schema:**
  ```json
  {
    "led_index": 1,
    "duration_ms": 1000
  }
  ```
  - `led_index` (integer, required, range: 1 to 5): The 1-based index corresponding to Test LEDs 1 through 5 (GPIO 4, 5, 6, 7, 16).
  - `duration_ms` (integer, optional, default: 1000, range: 200 to 5000): Pulse duration in milliseconds.
- **ESP32 Initial ACK (`EXECUTING`):**
  ```json
  {
    "command_id": "e4b2a8d1-1234-4567-89ab-cdef01234567",
    "status": "EXECUTING",
    "result": { "led_index": 1, "gpio": 4, "duration_ms": 1000 }
  }
  ```
- **ESP32 Completion ACK (`SUCCEEDED`):**
  ```json
  {
    "command_id": "e4b2a8d1-1234-4567-89ab-cdef01234567",
    "status": "SUCCEEDED",
    "result": {
      "led_index": 1,
      "gpio": 4,
      "state": "completed",
      "disclaimer": "Physical illumination must be verified by visual inspection"
    }
  }
  ```

---

### 3.3 `STATUS_REQUEST` (Device & Sensor Status Query)
Forces an immediate hardware state inspection and reports sensor availability, uptime, memory, and Wi-Fi metrics.

- **Parameters Schema:** Empty object `{}`.
- **ESP32 Completion ACK (`SUCCEEDED`):**
  ```json
  {
    "command_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "SUCCEEDED",
    "result": {
      "uptime_s": 86420,
      "free_heap_bytes": 281040,
      "wifi_rssi_dbm": -64,
      "sensors": {
        "adxl345_online": true,
        "ds18b20_motor_online": true,
        "ds18b20_ambient_online": false,
        "ds3231_rtc_online": true
      },
      "condition_classification": "GOOD",
      "firmware_version": "1.4.0"
    }
  }
  ```

---

### 3.4 `SENSOR_DIAGNOSTIC` (Non-Destructive Bus Scan)
Performs an active I2C bus scan (checking addresses `0x53` and `0x68`) and triggers a OneWire probe enumeration on GPIO 10 and 11.

- **Parameters Schema:** Empty object `{}`.
- **ESP32 Completion ACK (`SUCCEEDED`):**
  ```json
  {
    "command_id": "f5e4d3c2-b1a0-9876-5432-10fedcba9876",
    "status": "SUCCEEDED",
    "result": {
      "i2c_scan": {
        "0x53": "ADXL345 Accelerometer detected",
        "0x68": "DS3231 RTC detected"
      },
      "onewire_bus": {
        "motor_pin_10": "1 device(s) found",
        "ambient_pin_11": "0 device(s) found"
      },
      "bus_errors": 0
    }
  }
  ```

---

### 3.5 `SYNC_STATUS_REQUEST` (Storage Queue Query)
Queries the offline telemetry queue size, active filesystem medium, storage capacity, and dropped record metrics.

- **Parameters Schema:** Empty object `{}`.
- **ESP32 Completion ACK (`SUCCEEDED`):**
  ```json
  {
    "command_id": "7890abcd-ef12-3456-7890-abcdef123456",
    "status": "SUCCEEDED",
    "result": {
      "storage_medium": "microSD",
      "capacity_total_bytes": 31914983424,
      "capacity_used_bytes": 104857600,
      "storage_used_pct": 0.33,
      "ceiling_pct": 90.0,
      "pending_records_count": 0,
      "dropped_records_count": 0
    }
  }
  ```

---

### 3.6 `SET_ALERT_THRESHOLDS` (Update Permitted Thresholds)
Updates software alert thresholds on the ESP32 with validation against safety boundaries.

- **Parameters Schema:**
  ```json
  {
    "vibration_warning_rms": 4.5,
    "vibration_critical_rms": 7.1,
    "temp_warning_c": 75.0,
    "temp_critical_c": 85.0
  }
  ```
  - `vibration_warning_rms` (float, optional, range: 0.5 to 15.0 mm/s)
  - `vibration_critical_rms` (float, optional, range: 1.0 to 25.0 mm/s)
  - `temp_warning_c` (float, optional, range: 40.0 to 110.0 °C)
  - `temp_critical_c` (float, optional, range: 50.0 to 125.0 °C)
- **ESP32 Completion ACK (`SUCCEEDED`):**
  ```json
  {
    "command_id": "c1d2e3f4-5678-90ab-cdef-123456789abc",
    "status": "SUCCEEDED",
    "result": {
      "applied_thresholds": {
        "vibration_warning_rms": 4.5,
        "vibration_critical_rms": 7.1,
        "temp_warning_c": 75.0,
        "temp_critical_c": 85.0
      }
    }
  }
  ```

---

## 4. Error Codes & Failure Modes

When a command cannot be executed, the ESP32 dispatches status `FAILED` with an informative error message:

| Error Message | Meaning | Recovery Action |
|---|---|---|
| `Unknown command_type` | Command name unrecognized by firmware | Check spelling against this reference document. |
| `Invalid LED index [X]` | `led_index` out of bounds ($<1$ or $>5$) | Provide index between 1 and 5. |
| `Threshold out of safe range` | Threshold exceeds safety limits | Review allowable min/max boundaries in section 3.6. |
| `Hardware busy: active test in progress` | Another LED test is actively executing | Wait for current sequence to finish or send stop. |
