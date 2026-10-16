#ifndef SECRETS_EXAMPLE_H
#define SECRETS_EXAMPLE_H

/**
 * ==============================================================================
 * Industrial Motor Health Monitoring Platform — Firmware Secrets Template
 * ==============================================================================
 * Instructions:
 *   1. Duplicate this file as "secrets.h" in the firmware/ directory.
 *   2. Populate with your local Wi-Fi SSID and Password.
 *   3. Set DEVICE_INGEST_TOKEN to match the rotated DEVICE_INGEST_TOKEN in Vercel.
 *   4. secrets.h is listed in .gitignore and will never be committed to Git.
 * ==============================================================================
 */

// Wi-Fi Access Point Credentials
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Rotated Device Ingestion Secret Token (must match Vercel DEVICE_INGEST_TOKEN)
const char *DEVICE_INGEST_TOKEN = "YOUR_ROTATED_DEVICE_INGEST_TOKEN";

// Optional: Override Ingestion Endpoint URL if using custom domain or staging server
// const char *SERVER_TELEMETRY_URL = "https://industrial-motor-health-monitor.vercel.app/api/telemetry";

#endif // SECRETS_EXAMPLE_H
