-- Industrial Motor Health Monitoring Platform
-- Schema Migration 00004: Accelerometer Diagnostics (I2C Errors & Missed Sampling Slots)

ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS i2c_errors INTEGER DEFAULT 0;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS missed_sample_slots INTEGER DEFAULT 0;

COMMENT ON COLUMN public.telemetry.i2c_errors IS 'Count of I2C bus transmission failures during reporting window';
COMMENT ON COLUMN public.telemetry.missed_sample_slots IS 'Count of 200 Hz sampling timer intervals missed due to processor load';
