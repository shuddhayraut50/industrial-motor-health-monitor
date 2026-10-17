-- Industrial Motor Health Monitoring Platform
-- Schema Migration 00005: Offline Storage, Idempotency, and DS3231 RTC Telemetry

-- 1. Idempotency & Measurement Timestamp in Telemetry
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS record_id TEXT;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS measured_at TIMESTAMPTZ DEFAULT now();

-- Unique constraint on record_id for idempotent upload retries
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_record_id ON public.telemetry (record_id) WHERE record_id IS NOT NULL;

-- Index for ordering telemetry by physical measurement time
CREATE INDEX IF NOT EXISTS idx_telemetry_device_measured ON public.telemetry (device_id, measured_at DESC);

-- 2. MicroSD Card and DS3231 RTC Diagnostics in Telemetry
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS sd_card_status TEXT DEFAULT 'not_initialized';
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS unsynced_records_count INTEGER DEFAULT 0;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS oldest_unsynced_timestamp TIMESTAMPTZ;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS rtc_status TEXT DEFAULT 'not_detected';
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS rtc_synced BOOLEAN DEFAULT false;

-- 3. Device Summary Table Diagnostics
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS sd_card_status TEXT DEFAULT 'not_initialized';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS rtc_status TEXT DEFAULT 'not_detected';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS unsynced_records_count INTEGER DEFAULT 0;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_measured_at TIMESTAMPTZ;

-- 4. Column Documentation
COMMENT ON COLUMN public.telemetry.record_id IS 'Unique client-generated record ID for idempotent upload retries';
COMMENT ON COLUMN public.telemetry.measured_at IS 'Physical measurement timestamp recorded by DS3231 RTC';
COMMENT ON COLUMN public.telemetry.sd_card_status IS 'MicroSD offline buffer state: ready, missing, full, write_error, not_initialized';
COMMENT ON COLUMN public.telemetry.unsynced_records_count IS 'Count of pending offline telemetry records in local queue';
COMMENT ON COLUMN public.telemetry.oldest_unsynced_timestamp IS 'Timestamp of the oldest pending record in the offline queue';
COMMENT ON COLUMN public.telemetry.rtc_status IS 'DS3231 RTC hardware status: ready, not_detected, invalid_time, time_lost';
COMMENT ON COLUMN public.telemetry.rtc_synced IS 'Whether local RTC time was synchronized via NTP network source';
