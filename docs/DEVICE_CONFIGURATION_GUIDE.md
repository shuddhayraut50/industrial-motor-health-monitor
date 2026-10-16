# ESP32-S3 Firmware Configuration Guide

## Hardware Target: ESP32-S3 DevKit M-1 (N16R8)

This guide explains how to connect your existing working Arduino sensor firmware to the online telemetry monitoring platform without breaking your high-speed 200 Hz continuous accelerometer sampling loop.

---

### Exact Values to Copy into Firmware

In `firmware/esp32_telemetry_client.ino`, update the following definitions:

```cpp
// 1. Wi-Fi Access Point Credentials
const char* WIFI_SSID     = "YOUR_LOCAL_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// 2. Telemetry Ingestion Endpoint
// If testing locally on LAN:
// const char* SERVER_TELEMETRY_URL = "http://192.168.1.50:3000/api/telemetry";
// For live production deployment:
const char* SERVER_TELEMETRY_URL = "https://industrial-motor-health-monitor.vercel.app/api/telemetry";

// 3. Device Identification and Dedicated Secret Ingestion Token
const char* DEVICE_ID           = "motor-monitor-001";
const char* DEVICE_INGEST_TOKEN = "YOUR_DEVICE_INGEST_TOKEN"; // Matches DEVICE_INGEST_TOKEN in Vercel
const char* FIRMWARE_VERSION    = "v1.0.0-esp32s3";
```

---

### Multi-Core FreeRTOS Architecture

To prevent Wi-Fi latency, HTTPS handshakes, or server timeouts from blocking your 200 Hz sensor sampling loop:

1. **Core 1 (Real-Time Sensor Loop)**:
   - Dedicated exclusively to sampling the ADXL345 at 200 Hz (every 5 ms) and reading the DS18B20 temperature probes.
   - Computes real-time AC RMS running averages.
   - Updates the shared telemetry struct thread-safely using `portENTER_CRITICAL(&telemetryMux)`.

2. **Core 0 (Telemetry & Network Task)**:
   - Created with `xTaskCreatePinnedToCore(telemetryTask, "TelemetryTask", 8192, NULL, 1, NULL, 0)`.
   - Copies the latest sensor snapshot without delaying Core 1.
   - Serializes the JSON payload and transmits it over HTTPS POST every 1000 ms.
   - Handles network reconnections and backoff automatically.

---

### Step-by-Step Instructions to Send the First Real Sensor Reading

1. **Verify Your Server Deployment**:
   Ensure your website is running at `https://industrial-motor-health-monitor.vercel.app` (or locally at `http://localhost:3000`).
2. **Flash the ESP32-S3**:
   - Open Arduino IDE or PlatformIO.
   - Select Board: `ESP32S3 Dev Module` (Flash Size: 16MB, PSRAM: OPI PSRAM).
   - Install required libraries: `ArduinoJson` (v6 or v7), `OneWire`, `DallasTemperature`, `Adafruit_ADXL345`.
   - Compile and flash `firmware/esp32_telemetry_client.ino`.
3. **Open Serial Monitor**:
   Set baud rate to `115200`. Watch for:
   ```text
   Connecting to Wi-Fi.....
   Wi-Fi Connected! IP: 192.168.1.120
   [SYSTEM] Core 0 Telemetry Task started.
   [TELEMETRY] Upload OK (201). Sent 278 bytes.
   ```
4. **View Live on the Web**:
   Open `/dashboard` in your browser. The device status will switch from "Disconnected" to "Live Ingestion" with animated green pulse, displaying live temperatures and RMS vibration values!
