# Vercel Deployment Guide

## Project: `industrial-motor-health-monitor`

The project has been created and linked to the dedicated Vercel project under user account `shuddhayraut50`:
- **Vercel Project Name**: `industrial-motor-health-monitor`
- **Project ID**: `prj_5VCevWvSzDuQyrfHONZ2343fzFRe`

---

### Step 1: Configure Environment Variables in Vercel

Before deploying to production, configure the following environment variables in the Vercel Dashboard under **Project Settings** → **Environment Variables**:

| Variable Name | Environment | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Dev | The HTTPS URL of your newly created Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview, Dev | The `anon` / public key from your Supabase project |
| `SUPABASE_SECRET_KEY` | Production, Preview, Dev | The privileged `service_role` key from Supabase (server-only) |
| `DEVICE_INGEST_TOKEN` | Production, Preview, Dev | Secret 32+ char token required in headers by ESP32 for ingestion |
| `NEXT_PUBLIC_APP_URL` | Production | `https://industrial-motor-health-monitor.vercel.app` |

---

### Step 2: Deploy Using the Vercel CLI

From the workspace root directory:

1. **Deploy to Preview Environment**
   ```bash
   npx vercel
   ```

2. **Deploy to Production**
   ```bash
   npx vercel --prod
   ```

After deployment, Vercel will provide your live production URL:
`https://industrial-motor-health-monitor.vercel.app`

---

### Step 3: Verify the Live Ingestion Endpoint

Test the deployed API ingestion with `curl` or PowerShell:
```bash
curl -X POST https://industrial-motor-health-monitor.vercel.app/api/telemetry \
  -H "Content-Type: application/json" \
  -H "x-device-token: <YOUR_DEVICE_INGEST_TOKEN>" \
  -d '{
    "device_id": "motor-monitor-001",
    "motor_temp_c": 34.2,
    "ambient_temp_c": 28.5,
    "ax_g": 0.035,
    "ay_g": -0.090,
    "az_g": 0.980,
    "rms_x_g": 0.005,
    "rms_y_g": 0.006,
    "rms_z_g": 0.004,
    "firmware_version": "v1.0.0-esp32s3"
  }'
```

Expected HTTP Response: `201 Created`
```json
{
  "success": true,
  "device_id": "motor-monitor-001",
  "recorded_at": "2026-10-16T16:00:00.000Z",
  "id": 1
}
```
