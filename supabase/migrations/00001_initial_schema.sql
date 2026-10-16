-- Industrial Motor Health Monitoring Platform
-- Schema Migration 00001: Initial Schema
-- Isolated database schema for industrial-motor-health-monitor

-- 1. Create devices table
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    location TEXT DEFAULT 'Unassigned',
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on device_id for rapid device lookup
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON public.devices (device_id);

-- 2. Create telemetry table
-- High-throughput, optimized time-series store for motor & ambient temps, 3-axis accel, 3-axis RMS vibration
CREATE TABLE IF NOT EXISTS public.telemetry (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES public.devices(device_id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    motor_temp_c NUMERIC(6, 2) NOT NULL,
    ambient_temp_c NUMERIC(6, 2) NOT NULL,
    ax_g NUMERIC(7, 4) NOT NULL,
    ay_g NUMERIC(7, 4) NOT NULL,
    az_g NUMERIC(7, 4) NOT NULL,
    rms_x_g NUMERIC(7, 4) NOT NULL,
    rms_y_g NUMERIC(7, 4) NOT NULL,
    rms_z_g NUMERIC(7, 4) NOT NULL,
    firmware_version TEXT,
    sample_count INTEGER,
    acquisition_quality NUMERIC(4, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_motor_temp CHECK (motor_temp_c >= -50 AND motor_temp_c <= 200),
    CONSTRAINT chk_ambient_temp CHECK (ambient_temp_c >= -50 AND ambient_temp_c <= 100),
    CONSTRAINT chk_rms_positive CHECK (rms_x_g >= 0 AND rms_y_g >= 0 AND rms_z_g >= 0)
);

-- Composite index for fast live-window and historical queries per device
CREATE INDEX IF NOT EXISTS idx_telemetry_device_recorded ON public.telemetry (device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_recorded_at ON public.telemetry (recorded_at DESC);

-- 3. Create device_config table
-- Remote monitoring parameters (reporting interval, enabled fields)
-- STRICT RESTRICTION: No motor actuation or safety-critical commands are supported.
CREATE TABLE IF NOT EXISTS public.device_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL REFERENCES public.devices(device_id) ON DELETE CASCADE,
    config_version INTEGER NOT NULL DEFAULT 1,
    reporting_interval_ms INTEGER NOT NULL DEFAULT 1000,
    enabled_fields JSONB NOT NULL DEFAULT '["motor_temp_c", "ambient_temp_c", "ax_g", "ay_g", "az_g", "rms_x_g", "rms_y_g", "rms_z_g"]'::jsonb,
    configuration_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_min_interval CHECK (reporting_interval_ms >= 100),
    CONSTRAINT uq_device_config_version UNIQUE (device_id, config_version)
);

CREATE INDEX IF NOT EXISTS idx_device_config_device_ver ON public.device_config (device_id, config_version DESC);

-- 4. Create device_config_ack table
-- Tracks configuration receipt by hardware
CREATE TABLE IF NOT EXISTS public.device_config_ack (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL REFERENCES public.devices(device_id) ON DELETE CASCADE,
    acknowledged_config_version INTEGER NOT NULL,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    firmware_version TEXT,
    status TEXT NOT NULL DEFAULT 'acknowledged'
);

CREATE INDEX IF NOT EXISTS idx_device_config_ack_device ON public.device_config_ack (device_id, acknowledged_at DESC);

-- 5. Row Level Security (RLS) Policies
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_config_ack ENABLE ROW LEVEL SECURITY;

-- Allow authenticated dashboard users to read devices
CREATE POLICY "Authenticated users can read devices"
    ON public.devices FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated users to update device metadata (display_name, location)
CREATE POLICY "Authenticated users can update device metadata"
    ON public.devices FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Allow authenticated dashboard users to read telemetry
CREATE POLICY "Authenticated users can read telemetry"
    ON public.telemetry FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated dashboard users to read device configuration
CREATE POLICY "Authenticated users can read device config"
    ON public.device_config FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated dashboard users to create new config versions
CREATE POLICY "Authenticated users can insert device config"
    ON public.device_config FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Allow authenticated users to view config acknowledgements
CREATE POLICY "Authenticated users can view config acks"
    ON public.device_config_ack FOR SELECT
    TO authenticated
    USING (true);

-- Note: Ingestion inserts into telemetry and updates devices.last_seen_at
-- are executed server-side using the SUPABASE_SECRET_KEY (Service Role),
-- completely bypassing client RLS while ensuring no public write access.
