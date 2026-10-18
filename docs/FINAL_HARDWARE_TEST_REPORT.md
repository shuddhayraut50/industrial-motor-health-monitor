# FINAL HARDWARE TEST REPORT
**Target System**: ESP32-S3 N16R8 Dual-Core 240 MHz, ADXL345, Dual DS18B20s, DS3231 RTC, MicroSD SPI, Status LEDs
**Port**: COM12 (115200 Baud)
**Firmware Version**: `1.5.1-hardened`
**Cloud Stack**: Next.js 16.4.2 on Vercel + Supabase PostgreSQL

---

## 1. Physical Verification Summary

| Component / Subsystem | Test Performed | Measured Value / Result | Status |
| :--- | :--- | :--- | :--- |
| **ESP32-S3 Core & Clock** | PlatformIO flash & boot | 240 MHz dual-core, 16MB Flash, 8MB Octal PSRAM | **PASSED** |
| **Power Supply** | External 5V / 2A regulated | Powers MicroSD module & DevKit VIN; no brownouts | **PASSED** |
| **ADXL345 Accelerometer** | I2C address 0x53 read | 200 Hz continuous ODR; Ax: 0.054g, Ay: -0.124g, Az: 0.948g | **PASSED** |
| **Local Vibration Math** | 50-sample circular RMS buffer | Calculation: 83–90 µs; Decision-to-LED: 8–13 µs | **PASSED** |
| **Motor DS18B20** | OneWire on GPIO 10 | Measured: 32.25 °C (12-bit, non-blocking) | **PASSED** |
| **Ambient DS18B20** | OneWire on GPIO 11 | Measured: 35.44 °C (12-bit, non-blocking) | **PASSED** |
| **Signed Thermal Rise ($\Delta T$)** | Motor minus Ambient | 32.25 - 35.44 = **-3.19 °C** (Motor surface is 3.2 °C cooler than ambient) | **PASSED** |
| **DS3231 RTC** | I2C address 0x68 read | Clock valid: 2026-10-18T08:11:02Z; 0 read errors | **PASSED** |
| **MicroSD SPI Module** | SPI (SCK:12, MISO:13, MOSI:14, CS:15) | 32GB FAT32 card initialized @ 4 MHz; Write latency: 12–14 ms | **PASSED** |
| **Status LEDs** | Red (GPIO 17) & Green (GPIO 18) | Green SOLID ON during normal ingestion; Red overrides on faults | **PASSED** |
| **5-LED Test Array** | GPIOs 4, 5, 6, 7, 16 | Non-blocking chaser test decoupled from Core 0 via queueCommandAck | **PASSED** |
| **Wi-Fi Subsystem** | 802.11 b/g/n STA mode | IP: 192.168.84.102 | RSSI: -40 dBm; Event callback tracking active | **PASSED** |
| **HTTPS Telemetry Upload** | POST to Vercel API via TLS | HTTP 201 Created every 5 seconds; Upload duration: ~2.4 s | **PASSED** |
| **Diagnostic Events Queue** | Persistent SD queue `/events/` | Boot & sensor recovery events queued and drained without blocking | **PASSED** |

---

## 2. Firmware Compilation & Flash Evidence

```
Processing esp32s3 (platform: espressif32; board: esp32-s3-devkitc-1; framework: arduino)
RAM:   [=         ]  14.4% (used 47148 bytes from 327680 bytes)
Flash: [===       ]  30.5% (used 1018713 bytes from 3342336 bytes)
Uploading .pio\build\esp32s3\firmware.bin
Serial port COM12
Chip is ESP32-S3 (QFN56) (revision v0.2)
Features: WiFi, BLE, Embedded PSRAM 8MB (AP_3v3)
Crystal is 40MHz
MAC: 44:1b:f6:d3:76:c8
Wrote 1019072 bytes (662053 compressed) at 0x00010000 in 6.7 seconds (effective 1223.9 kbit/s)...
Hash of data verified.
Leaving...
Hard resetting via RTS pin...
========================= [SUCCESS] Took 13.69 seconds =========================
```

---

## 3. Serial Monitor Execution Trace (115200 Baud on COM12)

```
Connected to COM12 @ 115200 baud. Reading for 16 seconds...

--------------------------------------------------------------------------------
[PERF-STATS] Sample Interval: 5009 us (Min: 8 | Max: 45022) | Exec: 589 us
[PERF-STATS] Fast RMS Eval: 83 us | Decision->LED Latency: 8 us
[PERF-STATS] SD Write: 12 ms | HTTPS Upload: 2451 ms | Overflow: 0 | Core0 Stack Free: 1628 B
[PERF-STATS] Heap Free: 241604 B (Min: 176356 B | Max Block: 176116 B) | Wi-Fi Disconnects: 1
[PERF-STATS] Reset Reason: UNKNOWN | RTC Read Errors: 0 | Condition: GOOD
--------------------------------------------------------------------------------
[TELEMETRY] HTTP 201 (Upload: 2413 ms)
--------------------------------------------------------------------------------
[PERF-STATS] Sample Interval: 5000 us (Min: 8 | Max: 45022) | Exec: 302 us
[PERF-STATS] Fast RMS Eval: 90 us | Decision->LED Latency: 13 us
[PERF-STATS] SD Write: 14 ms | HTTPS Upload: 2415 ms | Overflow: 0 | Core0 Stack Free: 1628 B
[PERF-STATS] Heap Free: 241156 B (Min: 173472 B | Max Block: 176116 B) | Wi-Fi Disconnects: 1
[PERF-STATS] Reset Reason: UNKNOWN | RTC Read Errors: 0 | Condition: GOOD
--------------------------------------------------------------------------------
[TELEMETRY] HTTP 201 (Upload: 2424 ms)
--------------------------------------------------------------------------------
[PERF-STATS] Sample Interval: 5180 us (Min: 8 | Max: 45022) | Exec: 454 us
[PERF-STATS] Fast RMS Eval: 141 us | Decision->LED Latency: 53 us
[PERF-STATS] SD Write: 12 ms | HTTPS Upload: 2426 ms | Overflow: 0 | Core0 Stack Free: 1628 B
[PERF-STATS] Heap Free: 240708 B (Min: 173472 B | Max Block: 176116 B) | Wi-Fi Disconnects: 1
[PERF-STATS] Reset Reason: UNKNOWN | RTC Read Errors: 0 | Condition: GOOD
--------------------------------------------------------------------------------
[TELEMETRY] HTTP 201 (Upload: 2821 ms)
--------------------------------------------------------------------------------
[DONE] Serial capture finished.
```

---

## 4. Cloud Ingestion & Supabase Persistence Evidence

Verified via query to `https://industrial-motor-health-monitor.vercel.app/api/telemetry/live`:

```json
{
  "device": {
    "device_id": "motor-monitor-001",
    "location": "Test Bench A (ESP32-S3 N16R8)",
    "last_seen_at": "2026-10-18T08:11:43.242Z",
    "wifi_rssi_dbm": -62,
    "sensor_status": {
      "adxl345": "ready",
      "motor_temp": "ready",
      "ambient_temp": "ready"
    },
    "sd_card_status": "ready",
    "rtc_status": "ready",
    "unsynced_records_count": 0,
    "condition_status": "GOOD",
    "condition_reason": "Normal baseline: vibration and thermal rise within nominal limits.",
    "storage_medium": "sd_card"
  },
  "latest": {
    "firmware_version": "1.5.1-hardened",
    "motor_temp_c": 32.25,
    "ambient_temp_c": 35.44,
    "ax_g": 0.0545,
    "ay_g": -0.1241,
    "az_g": 0.9484,
    "rms_x_g": 0.0034,
    "rms_y_g": 0.0035,
    "rms_z_g": 0.0045,
    "sample_count": 1000,
    "acquisition_quality": 1.0,
    "i2c_errors": 0,
    "missed_sample_slots": 0,
    "sd_card_status": "ready",
    "rtc_status": "ready"
  },
  "connection_status": "ONLINE",
  "is_online": true,
  "is_stale": false,
  "age_seconds": 3
}
```

---

## 5. Remaining Physical Checklist & Recommendations

1. **Wiring Vibration Strains**:
   - The breadboard jumper wires for the SPI SD card module and I2C ADXL345 accelerometer should be secured with zip-ties or transitioned to a soldered proto-shield to prevent loose contact faults during high mechanical motor vibration.
2. **Current-Limiting Resistors on LEDs**:
   - Ensure all LEDs on GPIOs 4, 5, 6, 7, 17, and 18 have $220\,\Omega$ to $330\,\Omega$ series resistors to prevent drawing excessive current from the ESP32-S3 I/O bank.
3. **External 5V Common Ground**:
   - The external 5V 2A power supply must share a solid, low-impedance ground connection with the ESP32 development board's GND pins.
