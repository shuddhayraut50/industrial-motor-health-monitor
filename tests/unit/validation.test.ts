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

  it('accepts telemetry with only motor probe connected (ambient_temp_c is null)', () => {
    const singleProbePayload = {
      device_id: 'motor-monitor-001',
      motor_temp_c: 41.8,
      ambient_temp_c: null,
      ax_g: 0.02,
      ay_g: -0.05,
      az_g: 0.98,
      rms_x_g: 0.012,
      rms_y_g: 0.015,
      rms_z_g: 0.018,
      wifi_rssi_dbm: -58,
      sensor_status: {
        adxl345: 'ready',
        motor_temp: 'ready',
        ambient_temp: 'not_detected',
      },
    };

    const result = TelemetryPayloadSchema.safeParse(singleProbePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ambient_temp_c).toBeNull();
      expect(result.data.motor_temp_c).toBe(41.8);
      expect(result.data.sensor_status?.ambient_temp).toBe('not_detected');
    }
  });

  it('accepts telemetry with only ambient probe connected (motor_temp_c is null)', () => {
    const ambientOnlyPayload = {
      device_id: 'motor-monitor-001',
      motor_temp_c: null,
      ambient_temp_c: 26.5,
      ax_g: 0.01,
      ay_g: -0.02,
      az_g: 0.99,
      rms_x_g: 0.008,
      rms_y_g: 0.009,
      rms_z_g: 0.011,
      sensor_status: {
        adxl345: 'ready',
        motor_temp: 'not_detected',
        ambient_temp: 'ready',
      },
    };

    const result = TelemetryPayloadSchema.safeParse(ambientOnlyPayload);
    expect(result.success).toBe(true);
  });

  it('accepts telemetry with ADXL345 disconnected (vibration metrics null, sample_count 0)', () => {
    const noAdxlPayload = {
      device_id: 'motor-monitor-001',
      motor_temp_c: 38.2,
      ambient_temp_c: 24.1,
      ax_g: null,
      ay_g: null,
      az_g: null,
      rms_x_g: null,
      rms_y_g: null,
      rms_z_g: null,
      sample_count: 0,
      sensor_status: {
        adxl345: 'not_detected',
        motor_temp: 'ready',
        ambient_temp: 'ready',
      },
    };

    const result = TelemetryPayloadSchema.safeParse(noAdxlPayload);
    expect(result.success).toBe(true);
  });

  it('accepts heartbeat-only packet when all external sensors are disconnected', () => {
    const heartbeatOnly = {
      device_id: 'motor-monitor-001',
      motor_temp_c: null,
      ambient_temp_c: null,
      ax_g: null,
      ay_g: null,
      az_g: null,
      rms_x_g: null,
      rms_y_g: null,
      rms_z_g: null,
      sample_count: 0,
      firmware_version: '1.1.0',
      wifi_rssi_dbm: -64,
      sensor_status: {
        adxl345: 'not_detected',
        motor_temp: 'not_detected',
        ambient_temp: 'not_detected',
      },
    };

    const result = TelemetryPayloadSchema.safeParse(heartbeatOnly);
    expect(result.success).toBe(true);
  });

  it('accepts telemetry with i2c_errors and missed_sample_slots diagnostics', () => {
    const withDiagnostics = {
      device_id: 'motor-monitor-001',
      motor_temp_c: 34.2,
      ambient_temp_c: 25.1,
      ax_g: 0.02,
      ay_g: -0.05,
      az_g: 0.98,
      rms_x_g: 0.012,
      rms_y_g: 0.015,
      rms_z_g: 0.018,
      sample_count: 1000,
      acquisition_quality: 1.0,
      i2c_errors: 0,
      missed_sample_slots: 2,
    };

    const result = TelemetryPayloadSchema.safeParse(withDiagnostics);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.i2c_errors).toBe(0);
      expect(result.data.missed_sample_slots).toBe(2);
      expect(result.data.acquisition_quality).toBe(1.0);
    }
  });

  it('rejects negative i2c_errors and missed_sample_slots', () => {
    const invalidDiagnostics = {
      device_id: 'motor-monitor-001',
      motor_temp_c: 34.2,
      ambient_temp_c: 25.1,
      ax_g: 0.02,
      ay_g: -0.05,
      az_g: 0.98,
      rms_x_g: 0.012,
      rms_y_g: 0.015,
      rms_z_g: 0.018,
      i2c_errors: -1,
      missed_sample_slots: -5,
    };

    const result = TelemetryPayloadSchema.safeParse(invalidDiagnostics);
    expect(result.success).toBe(false);
  });

  it('resiliently handles empty or invalid measured_at strings by converting to null', () => {
    const withEmptyDate = {
      device_id: 'motor-monitor-001',
      measured_at: '',
    };
    const res1 = TelemetryPayloadSchema.safeParse(withEmptyDate);
    expect(res1.success).toBe(true);
    if (res1.success) expect(res1.data.measured_at).toBeNull();

    const withInvalidDate = {
      device_id: 'motor-monitor-001',
      measured_at: 'not-a-valid-date',
    };
    const res2 = TelemetryPayloadSchema.safeParse(withInvalidDate);
    expect(res2.success).toBe(true);
    if (res2.success) expect(res2.data.measured_at).toBeNull();
  });

  it('resiliently clamps acquisition_quality slightly above 1.0 and handles anomalous positive RSSI', () => {
    const edgeTelemetry = {
      device_id: 'motor-monitor-001',
      acquisition_quality: 1.002,
      wifi_rssi_dbm: 1,
      sensor_status: null,
    };
    const res = TelemetryPayloadSchema.safeParse(edgeTelemetry);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.acquisition_quality).toBe(1.0);
      expect(res.data.wifi_rssi_dbm).toBeNull();
      expect(res.data.sensor_status).toBeNull();
    }
  });

  it('accepts telemetry with record_id, measured_at, sd_card_status, and rtc_status', () => {
    const withOfflineAndRtc = {
      device_id: 'motor-monitor-001',
      record_id: 'rec-motor-monitor-001-1729177200-42',
      measured_at: '2026-10-17T10:00:00.000Z',
      motor_temp_c: 35.0,
      ambient_temp_c: 24.5,
      ax_g: 0.01,
      ay_g: -0.04,
      az_g: 0.99,
      rms_x_g: 0.005,
      rms_y_g: 0.006,
      rms_z_g: 0.008,
      sd_card_status: 'ready',
      unsynced_records_count: 5,
      oldest_unsynced_timestamp: '2026-10-17T09:55:00.000Z',
      rtc_status: 'ready',
      rtc_synced: true,
    };

    const result = TelemetryPayloadSchema.safeParse(withOfflineAndRtc);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.record_id).toBe('rec-motor-monitor-001-1729177200-42');
      expect(result.data.sd_card_status).toBe('ready');
      expect(result.data.rtc_status).toBe('ready');
      expect(result.data.rtc_synced).toBe(true);
      expect(result.data.unsynced_records_count).toBe(5);
    }
  });

  it('rejects invalid record_id with forbidden special characters', () => {
    const unsafeRecordId = {
      device_id: 'motor-monitor-001',
      record_id: 'rec-001; DROP TABLE telemetry;--',
      motor_temp_c: 35.0,
      ambient_temp_c: 24.5,
      ax_g: 0.01,
      ay_g: -0.04,
      az_g: 0.99,
      rms_x_g: 0.005,
      rms_y_g: 0.006,
      rms_z_g: 0.008,
    };

    const result = TelemetryPayloadSchema.safeParse(unsafeRecordId);
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
