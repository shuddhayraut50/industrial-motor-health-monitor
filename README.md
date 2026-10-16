# Industrial Motor Health Monitoring Platform

A production-structured IoT monitoring web application for an ESP32-S3 industrial motor monitoring prototype.

> [!IMPORTANT]
> **Strict Project Isolation**: This project is independently named `industrial-motor-health-monitor` and is completely separate from Vanshilp, vanshilp.in, and any other repository or database.

---

## System Architecture

```text
+-----------------------------+
|  ESP32-S3 DevKit M-1 N16R8  |
|  - ADXL345 (200 Hz Core 1)  |
|  - 2x DS18B20 Probes        |
|  - FreeRTOS Telemetry Core 0|
+--------------+--------------+
               | HTTPS POST (JSON)
               | x-device-token header
               v
+-----------------------------+
|    Vercel Ingestion API     |
|    POST /api/telemetry      |
|    - Timing-safe Auth       |
|    - Zod Schema Validation  |
|    - Server Timestamping    |
|    - Sliding-window Rate Lmt|
+--------------+--------------+
               | Service Role Insert
               v
+-----------------------------+
|     Supabase PostgreSQL     |
|   - devices, telemetry,     |
|     device_config, ack      |
|   - Row Level Security (RLS)|
+--------------+--------------+
               | Authenticated Real-Time Queries
               v
+-----------------------------+
|     Next.js 16 Dashboard    |
|   - Overview & Stale Banner |
|   - Live Recharts Curves    |
|   - Analytics & CSV Export  |
|   - Device Sync & Config    |
+-----------------------------+
```

---

## Hardware Specifications

- **Microcontroller**: ESP32-S3 DevKit M-1 (N16R8, Dual-Core Xtensa LX7, Wi-Fi 2.4 GHz)
- **Vibration Sensor**: ADXL345 3-Axis Digital Accelerometer (±16g range, sampled continuously at 200 Hz on Core 1)
- **Temperature Probes**: Two waterproof DS18B20 1-Wire sensors (Motor stator casing + ambient reference)
- **Non-blocking Firmware**: Real-time sampling on Core 1 is never interrupted or blocked by Wi-Fi / HTTPS uploads on Core 0.

---

## Tech Stack

- **Framework**: Next.js 16 (App Router) with TypeScript (Strict mode)
- **Styling**: Tailwind CSS with custom industrial high-contrast dark palette
- **Visualizations**: Recharts time-series dual-temperature and tri-axis vibration charts
- **Persistence**: Supabase PostgreSQL with RLS and composite indexes
- **Testing**: Playwright (E2E across Desktop & Mobile) and Vitest (Unit tests)
- **Security**: Timing-safe token verification (`crypto.timingSafeEqual`), server-side timestamps, secret redaction

---

## Documentation Index

- [Local Development Setup Guide](file:///docs/SETUP_GUIDE.md)
- [Supabase Setup & Database Migrations](file:///docs/SUPABASE_SETUP_AND_MIGRATIONS.md)
- [Vercel Deployment Guide](file:///docs/VERCEL_DEPLOYMENT_GUIDE.md)
- [ESP32-S3 Firmware Configuration Guide](file:///docs/DEVICE_CONFIGURATION_GUIDE.md)
- [API Ingestion Payload Specification](file:///docs/API_PAYLOAD_SPECIFICATION.md)
- [Security Checklist & Token Rotation](file:///docs/SECURITY_CHECKLIST.md)
- [Troubleshooting & Diagnostics](file:///docs/TROUBLESHOOTING_GUIDE.md)

---

## Verification & Test Results

Run all test suites locally:

```bash
# 1. TypeScript Strict Typecheck
npm run typecheck

# 2. ESLint Checks
npm run lint

# 3. Vitest Unit Tests (18 tests passing)
npm run test

# 4. Production Build Verification
npm run build

# 5. Playwright End-to-End Tests (20 tests passing)
npm run test:e2e
```
