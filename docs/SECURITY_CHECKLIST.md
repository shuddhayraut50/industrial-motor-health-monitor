# Security Checklist & Secret Rotation Policy

## Project: `industrial-motor-health-monitor`

This checklist details the security controls implemented in the platform, secret handling rules, and rotation procedures.

---

### Security Architecture Controls

- [x] **Strict Project Isolation**: Distinct Vercel and Supabase project configurations, independent environment variables, and dedicated database tables. No shared tables or credentials with any other project.
- [x] **Timing-Safe Authentication**: Constant-time token verification prevents timing side-channel attacks when validating device ingestion tokens.
- [x] **Server-Authoritative Timestamps**: Device timestamps are ignored as authoritative ingestion time. The server injects its own trusted ISO 8601 timestamp (`recorded_at = new Date().toISOString()`).
- [x] **Strict Input Validation**: Zod schema rejects non-finite numbers (`NaN`, `Infinity`), string injections, negative RMS values, and out-of-scale sensor values.
- [x] **Rate Limiting**: Sliding-window rate limiter prevents flooding and denial of service.
- [x] **Payload Size Limits**: Strict 16 KB body size limit on ingestion requests.
- [x] **Zero Secret Leakage**:
  - `SUPABASE_SECRET_KEY` (service role) is never exposed in browser bundles or client code.
  - Logging functions automatically redact all keys named `token`, `password`, `secret`, `authorization`, or `key`.
- [x] **Row Level Security (RLS)**: Public write access is denied. Authenticated dashboard users have read-only access to telemetry.
- [x] **Passive Safety Architecture**: No motor actuation, relay control, start/stop commands, or safety-critical interfaces are exposed.

---

### Secret Rotation Guidelines

1. **Rotating `DEVICE_INGEST_TOKEN`**:
   - Step 1: Generate a high-entropy string (e.g. `openssl rand -hex 32`).
   - Step 2: In Vercel Project Settings → Environment Variables, update `DEVICE_INGEST_TOKEN`.
   - Step 3: Trigger a redeployment in Vercel (`npx vercel --prod` or dashboard redeploy).
   - Step 4: Flash the new token to the ESP32-S3 firmware.
   - Step 5: Verify the Serial Monitor outputs `Upload OK (201)` and the dashboard receives live packets.

2. **Rotating Supabase Keys**:
   - If the Supabase `service_role` key is ever compromised, navigate to Supabase Dashboard → Settings → API, click **Regenerate**, and immediately update `SUPABASE_SECRET_KEY` in Vercel.
