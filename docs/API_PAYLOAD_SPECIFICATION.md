# Telemetry API Ingestion Specification

## Endpoint: `POST /api/telemetry`

This document defines the contract, authentication headers, payload schema, physical validation bounds, and response codes for IoT telemetry ingestion.

---

### Request Headers

| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `Content-Type` | `string` | **Yes** | Must be `application/json` |
| `x-device-token` | `string` | **Yes** | Secret ingestion token (or `Authorization: Bearer <token>`) |

---

### JSON Body Specification

```json
{
  "device_id": "motor-monitor-001",
  "motor_temp_c": 38.45,
  "ambient_temp_c": 27.20,
  "ax_g": 0.038,
  "ay_g": -0.095,
  "az_g": 0.985,
  "rms_x_g": 0.0042,
  "rms_y_g": 0.0051,
  "rms_z_g": 0.0084,
  "firmware_version": "v1.0.0-esp32s3",
  "sample_count": 200,
  "acquisition_quality": 1.0
}
```

---

### Field Validations & Physical Bounds

| Field | Type | Bounds / Rules | Description |
| :--- | :--- | :--- | :--- |
| `device_id` | `string` | Min 3, max 64 chars. Regex `^[a-zA-Z0-9_-]+$` | Unique identifier of the device |
| `motor_temp_c` | `number` | Finite number, `-40.0` to `180.0` °C | Stator casing surface temperature probe |
| `ambient_temp_c`| `number` | Finite number, `-40.0` to `85.0` °C | Surrounding ambient temperature probe |
| `ax_g` | `number` | Finite number, `-16.0` to `16.0` g | Mean static acceleration along X-axis |
| `ay_g` | `number` | Finite number, `-16.0` to `16.0` g | Mean static acceleration along Y-axis |
| `az_g` | `number` | Finite number, `-16.0` to `16.0` g | Mean static acceleration along Z-axis (gravity) |
| `rms_x_g` | `number` | Finite number, `0.0` to `16.0` g | AC RMS vibration along X-axis |
| `rms_y_g` | `number` | Finite number, `0.0` to `16.0` g | AC RMS vibration along Y-axis |
| `rms_z_g` | `number` | Finite number, `0.0` to `16.0` g | AC RMS vibration along Z-axis (axial) |
| `firmware_version`| `string` | Optional, max 64 chars | Active microcontroller firmware tag |
| `sample_count` | `integer`| Optional, `1` to `100,000` | Samples collected during interval |
| `acquisition_quality`| `number`| Optional, `0.0` to `1.0` | Health score of sensor readings |

---

### HTTP Response Codes

- **`201 Created`**: Payload validated, authenticated, and persisted with server timestamp.
  ```json
  {
    "success": true,
    "device_id": "motor-monitor-001",
    "recorded_at": "2026-10-16T16:05:00.123Z",
    "id": 142
  }
  ```
- **`400 Bad Request`**: Malformed JSON or schema validation failure (e.g. non-finite number, temperature out of bounds, invalid device ID).
- **`401 Unauthorized`**: Missing, invalid, or mismatched `x-device-token`.
- **`413 Payload Too Large`**: Request body exceeds 16KB.
- **`429 Too Many Requests`**: Rate limit exceeded (more than 30 requests per 10 seconds).
- **`405 Method Not Allowed`**: Request method other than `POST` (e.g. `GET`).
- **`500 Internal Server Error`**: Database or server error. No internal secrets or stack traces are leaked.
