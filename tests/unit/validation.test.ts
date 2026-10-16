import { describe, it, expect } from 'vitest';
import { TelemetryPayloadSchema } from '../../src/lib/validation/telemetry';
import { DeviceConfigUpdateSchema } from '../../src/lib/validation/config';

describe('TelemetryPayloadSchema validation', () => {
  it('accepts valid realistic industrial telemetry payloads', () => {
    const valid = {
      device_id: 'motor-monitor-001',
      motor_temp_c: 32.5,
      ambient_temp_c: 29.0,
      ax_g: 0.04,
      ay_g: -0.10,
      az_g: 0.95,
      rms_x_g: 0.003,
      rms_y_g: 0.004,
      rms_z_g: 0.003,
    };

    const result = TelemetryPayloadSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects non-finite values like NaN and Infinity', () => {
    const payloadWithNaN = {
      device_id: 'motor-monitor-001',
      motor_temp_c: NaN,
      ambient_temp_c: 29.0,
      ax_g: 0.04,
      ay_g: -0.10,
      az_g: 0.95,
      rms_x_g: 0.003,
      rms_y_g: 0.004,
      rms_z_g: 0.003,
    };

    const result = TelemetryPayloadSchema.safeParse(payloadWithNaN);
    expect(result.success).toBe(false);
  });

  it('rejects unreasonable motor temperatures (>180°C or <-40°C)', () => {
    const tooHot = {
      device_id: 'motor-monitor-001',
      motor_temp_c: 250.0,
      ambient_temp_c: 29.0,
      ax_g: 0.04,
      ay_g: -0.10,
      az_g: 0.95,
      rms_x_g: 0.003,
      rms_y_g: 0.004,
      rms_z_g: 0.003,
    };

    const result = TelemetryPayloadSchema.safeParse(tooHot);
    expect(result.success).toBe(false);
  });

  it('rejects acceleration values outside ADXL345 physical scale (±16g)', () => {
    const outOfScale = {
      device_id: 'motor-monitor-001',
      motor_temp_c: 35.0,
      ambient_temp_c: 25.0,
      ax_g: 30.5, // > 16g
      ay_g: -0.10,
      az_g: 0.95,
      rms_x_g: 0.003,
      rms_y_g: 0.004,
      rms_z_g: 0.003,
    };

    const result = TelemetryPayloadSchema.safeParse(outOfScale);
    expect(result.success).toBe(false);
  });

  it('rejects negative RMS vibration values', () => {
    const negativeRMS = {
      device_id: 'motor-monitor-001',
      motor_temp_c: 35.0,
      ambient_temp_c: 25.0,
      ax_g: 0.05,
      ay_g: -0.10,
      az_g: 0.95,
      rms_x_g: -0.05, // RMS cannot be negative
      rms_y_g: 0.004,
      rms_z_g: 0.003,
    };

    const result = TelemetryPayloadSchema.safeParse(negativeRMS);
    expect(result.success).toBe(false);
  });

  it('rejects invalid device_id with special characters', () => {
    const invalidId = {
      device_id: 'motor;DROP TABLE telemetry;--',
      motor_temp_c: 35.0,
      ambient_temp_c: 25.0,
      ax_g: 0.05,
      ay_g: -0.10,
      az_g: 0.95,
      rms_x_g: 0.005,
      rms_y_g: 0.004,
      rms_z_g: 0.003,
    };

    const result = TelemetryPayloadSchema.safeParse(invalidId);
    expect(result.success).toBe(false);
  });
});

describe('DeviceConfigUpdateSchema validation', () => {
  it('enforces minimum safe reporting interval of 100ms', () => {
    const tooFast = {
      device_id: 'motor-monitor-001',
      reporting_interval_ms: 20, // too fast
      enabled_fields: ['motor_temp_c'],
    };

    const result = DeviceConfigUpdateSchema.safeParse(tooFast);
    expect(result.success).toBe(false);
  });

  it('accepts safe monitoring interval and fields', () => {
    const validConfig = {
      device_id: 'motor-monitor-001',
      reporting_interval_ms: 2000,
      enabled_fields: ['motor_temp_c', 'ambient_temp_c', 'rms_z_g'],
    };

    const result = DeviceConfigUpdateSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });
});
