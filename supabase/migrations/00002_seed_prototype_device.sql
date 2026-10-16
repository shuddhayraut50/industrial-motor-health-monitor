-- Industrial Motor Health Monitoring Platform
-- Schema Migration 00002: Seed Prototype Device and Initial Configuration
-- Provisions the default device record for the ESP32-S3 hardware prototype.

INSERT INTO public.devices (device_id, display_name, location, enabled)
VALUES (
    'motor-monitor-001',
    'Induction Motor Prototype #1',
    'Test Bench A (ESP32-S3 N16R8)',
    true
)
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO public.device_config (device_id, config_version, reporting_interval_ms, enabled_fields, configuration_json)
VALUES (
    'motor-monitor-001',
    1,
    1000,
    '["motor_temp_c", "ambient_temp_c", "ax_g", "ay_g", "az_g", "rms_x_g", "rms_y_g", "rms_z_g"]'::jsonb,
    '{"sensor_adxl345_range_g": 16, "sensor_ds18b20_resolution_bits": 12, "notes": "Initial prototype configuration"}'::jsonb
)
ON CONFLICT (device_id, config_version) DO NOTHING;

INSERT INTO public.device_config_ack (device_id, acknowledged_config_version, firmware_version, status)
VALUES (
    'motor-monitor-001',
    1,
    'v1.0.0-esp32s3',
    'acknowledged'
)
ON CONFLICT DO NOTHING;
