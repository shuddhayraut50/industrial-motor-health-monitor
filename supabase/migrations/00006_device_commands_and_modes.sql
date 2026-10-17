-- Industrial Motor Health Monitoring Platform
-- Schema Migration 00006: Device Command Queue, Condition Indicators & Storage Diagnostics

-- 1. Create device_commands table for two-way web-to-device command lifecycle
CREATE TABLE IF NOT EXISTS public.device_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL REFERENCES public.devices(device_id) ON DELETE CASCADE,
    command_type TEXT NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'acknowledged', 'executing', 'succeeded', 'failed', 'expired')),
    requesting_user TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
    result JSONB,
    error_message TEXT
);

-- Index for rapid command polling per device and status
CREATE INDEX IF NOT EXISTS idx_device_commands_device_status ON public.device_commands (device_id, status);
CREATE INDEX IF NOT EXISTS idx_device_commands_created_at ON public.device_commands (created_at DESC);

-- 2. Add Condition Classification and Storage Diagnostics to telemetry table
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS condition_status TEXT DEFAULT 'unknown';
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS condition_reason TEXT;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS storage_medium TEXT DEFAULT 'sd_card';
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS storage_used_pct NUMERIC(5, 2) DEFAULT 0.0;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS dropped_records_count INTEGER DEFAULT 0;

-- 3. Add Condition Classification and Storage Diagnostics to devices table
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS condition_status TEXT DEFAULT 'unknown';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS condition_reason TEXT;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS storage_medium TEXT DEFAULT 'sd_card';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS storage_used_pct NUMERIC(5, 2) DEFAULT 0.0;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS dropped_records_count INTEGER DEFAULT 0;

-- 4. Add alert_thresholds to device_config table
ALTER TABLE public.device_config ADD COLUMN IF NOT EXISTS alert_thresholds JSONB DEFAULT '{
  "vibration_warning_rms": 0.10,
  "vibration_critical_rms": 0.25,
  "temp_warning_c": 80.0,
  "temp_critical_c": 95.0,
  "temp_diff_warning_c": 25.0
}'::jsonb;

-- 5. Comments for Documentation
COMMENT ON TABLE public.device_commands IS 'Asynchronous, acknowledged two-way command queue for edge devices';
COMMENT ON COLUMN public.telemetry.condition_status IS 'ESP32 local rule-based condition: good, caution, warning, critical, unknown';
COMMENT ON COLUMN public.telemetry.condition_reason IS 'Plain-text explanation of the condition classification rule fired';
COMMENT ON COLUMN public.telemetry.storage_medium IS 'Active local buffer medium: sd_card, flash_fallback, or none';
COMMENT ON COLUMN public.telemetry.storage_used_pct IS 'Storage capacity utilization percentage against 90% ceiling';
COMMENT ON COLUMN public.telemetry.dropped_records_count IS 'Cumulative count of records dropped due to exhausted offline storage';
