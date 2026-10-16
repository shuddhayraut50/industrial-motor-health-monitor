# Supabase Setup and Database Migrations Guide

## Project: `industrial-motor-health-monitor`

> [!CRITICAL]
> **STRICT PROJECT ISOLATION**: Do not connect or link this project to Vanshilp, vanshilp.in, or any other existing project database. Always create a brand-new, isolated Supabase project.

---

### Step 1: Create a Dedicated Supabase Project

1. Log into your Supabase account at [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Click **New Project**.
3. Choose your organization.
4. Set the project name strictly to:
   ```text
   industrial-motor-health-monitor
   ```
5. Set a secure database password and choose your preferred region (e.g. `ap-south-1` Mumbai or closest to your deployment).
6. Click **Create new project** and wait for provisioning (~1–2 minutes).

---

### Step 2: Apply Database Schema Migrations

The SQL migrations are versioned in `supabase/migrations/`:
- `00001_initial_schema.sql`: Core schema, foreign keys, indexes, and RLS policies.
- `00002_seed_prototype_device.sql`: Provisions prototype device `motor-monitor-001` and initial config.
- `00003_sensor_health_and_nullable_telemetry.sql`: Makes sensor columns nullable and introduces `sensor_status` and `wifi_rssi_dbm` for independent sensor health monitoring.

#### Option A: Via Supabase SQL Editor (Recommended & Fastest)
1. Open your new Supabase project in the browser.
2. In the left navigation, select **SQL Editor** (`/sql/new`).
3. Open `supabase/migrations/00001_initial_schema.sql` from this repository, copy all contents, paste into the editor, and click **Run**.
4. Open `supabase/migrations/00002_seed_prototype_device.sql`, paste into the SQL Editor, and click **Run**.
5. Open `supabase/migrations/00003_sensor_health_and_nullable_telemetry.sql`, paste into the SQL Editor, and click **Run**.

#### Option B: Via Supabase CLI
```bash
npx supabase login
npx supabase link --project-ref <your-new-project-ref>
npx supabase db push
```

---

### Step 3: Copy Your Project API Credentials

In the Supabase Dashboard, navigate to **Project Settings** → **API**:
1. **Project URL**:
   Example: `https://xyzcompanyproject.supabase.co`
   Copy into `NEXT_PUBLIC_SUPABASE_URL`.
2. **Project API Keys** → `anon` / `public`:
   Copy into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. **Project API Keys** → `service_role` / `secret`:
   Copy into `SUPABASE_SECRET_KEY` in Vercel and your `.env.local`.

> [!WARNING]
> Keep `SUPABASE_SECRET_KEY` server-only! Never commit it to git, embed it in ESP32 firmware, or expose it in browser bundles.

---

### Step 4: Verify Table Structure

In Supabase **Table Editor**, confirm the following 4 tables exist:
1. `devices` (contains initial prototype device `motor-monitor-001`)
2. `telemetry` (time-series store with composite index `[device_id, recorded_at]`)
3. `device_config` (versioned monitoring configuration)
4. `device_config_ack` (hardware acknowledgments)
