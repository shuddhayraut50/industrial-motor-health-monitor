-- Industrial Motor Health Monitoring Platform
-- Schema Migration 00003: Independent Sensor Health & Nullable Telemetry
-- Allows missing/failed sensors (single DS18B20 probe, disconnected ADXL345) to send partial telemetry
-- without blocking working sensors or fabricating synthetic values.

-- 1. Make telemetry metric columns nullable
ALTER TABLE public.telemetry ALTER COLUMN motor_temp_c DROP NOT NULL;
ALTER TABLE public.telemetry ALTER COLUMN ambient_temp_c DROP NOT NULL;
ALTER TABLE public.telemetry ALTER COLUMN ax_g DROP NOT NULL;
ALTER TABLE public.telemetry ALTER COLUMN ay_g DROP NOT NULL;
ALTER TABLE public.telemetry ALTER COLUMN az_g DROP NOT NULL;
ALTER TABLE public.telemetry ALTER COLUMN rms_x_g DROP NOT NULL;
ALTER TABLE public.telemetry ALTER COLUMN rms_y_g DROP NOT NULL;
ALTER TABLE public.telemetry ALTER COLUMN rms_z_g DROP NOT NULL;

-- 2. Add Wi-Fi RSSI and structured sensor status to telemetry table
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS wifi_rssi_dbm INTEGER;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS sensor_status JSONB DEFAULT '{"adxl345":"ready","motor_temp":"ready","ambient_temp":"ready"}'::jsonb;

-- 3. Add Wi-Fi RSSI and latest sensor status map to devices table for rapid device health querying
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS wifi_rssi_dbm INTEGER;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS sensor_status JSONB DEFAULT '{"adxl345":"ready","motor_temp":"ready","ambient_temp":"ready"}'::jsonb;

-- 4. Comments for clarity
COMMENT ON COLUMN public.telemetry.motor_temp_c IS 'Motor stator temperature in Celsius (null if motor probe not detected)';
COMMENT ON COLUMN public.telemetry.ambient_temp_c IS 'Ambient reference temperature in Celsius (null if ambient probe not detected)';
COMMENT ON COLUMN public.telemetry.sensor_status IS 'Independent hardware availability map: {adxl345, motor_temp, ambient_temp}';
COMMENT ON COLUMN public.devices.sensor_status IS 'Latest reported sensor hardware availability statuses';
