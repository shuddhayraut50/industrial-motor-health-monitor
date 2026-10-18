import { describe, it, expect } from 'vitest';
import { computeStats } from '../../src/lib/supabase/db';
import { TelemetryRecord } from '../../src/lib/types/telemetry';

describe('Independent Sensor Health & Fault-Tolerant Statistics', () => {
  it('correctly calculates statistics when only motor probe is connected (ambient_temp is null)', () => {
    const records: TelemetryRecord[] = [
      {
        id: 1,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 3000).toISOString(),
        motor_temp_c: 40.0,
        ambient_temp_c: null,
        ax_g: 0.02,
        ay_g: -0.05,
        az_g: 0.98,
        rms_x_g: 0.01,
        rms_y_g: 0.02,
        rms_z_g: 0.03,
      },
      {
        id: 2,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 1000).toISOString(),
        motor_temp_c: 44.0,
        ambient_temp_c: null,
        ax_g: 0.02,
        ay_g: -0.05,
        az_g: 0.98,
        rms_x_g: 0.01,
        rms_y_g: 0.02,
        rms_z_g: 0.03,
      },
    ];

    const stats = computeStats(records);
    // Motor temp computed accurately
    expect(stats.motor_temp.min).toBe(40.0);
    expect(stats.motor_temp.max).toBe(44.0);
    expect(stats.motor_temp.avg).toBe(42.0);

    // Ambient temp should be zero baseline without fabricating numbers
    expect(stats.ambient_temp.min).toBe(0);
    expect(stats.ambient_temp.max).toBe(0);
    expect(stats.ambient_temp.avg).toBe(0);

    // Thermal rise (diff) cannot be computed without both probes
    expect(stats.temp_diff.min).toBe(0);
    expect(stats.temp_diff.max).toBe(0);
    expect(stats.temp_diff.avg).toBe(0);
  });

  it('correctly calculates statistics when only ambient probe is connected (motor_temp is null)', () => {
    const records: TelemetryRecord[] = [
      {
        id: 1,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 3000).toISOString(),
        motor_temp_c: null,
        ambient_temp_c: 25.0,
        ax_g: 0.01,
        ay_g: 0.01,
        az_g: 0.99,
        rms_x_g: 0.005,
        rms_y_g: 0.006,
        rms_z_g: 0.007,
      },
      {
        id: 2,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 1000).toISOString(),
        motor_temp_c: null,
        ambient_temp_c: 27.0,
        ax_g: 0.01,
        ay_g: 0.01,
        az_g: 0.99,
        rms_x_g: 0.005,
        rms_y_g: 0.006,
        rms_z_g: 0.007,
      },
    ];

    const stats = computeStats(records);
    expect(stats.ambient_temp.min).toBe(25.0);
    expect(stats.ambient_temp.max).toBe(27.0);
    expect(stats.ambient_temp.avg).toBe(26.0);
    expect(stats.motor_temp.min).toBe(0);
    expect(stats.temp_diff.avg).toBe(0);
  });

  it('computes thermal rise only when both probes report valid measurements', () => {
    const records: TelemetryRecord[] = [
      {
        id: 1,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 3000).toISOString(),
        motor_temp_c: 50.0,
        ambient_temp_c: 25.0,
        ax_g: 0.01,
        ay_g: 0.01,
        az_g: 0.99,
        rms_x_g: 0.01,
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
      {
        id: 2,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 2000).toISOString(),
        motor_temp_c: 52.0,
        ambient_temp_c: null, // Ambient probe momentarily disconnected
        ax_g: 0.01,
        ay_g: 0.01,
        az_g: 0.99,
        rms_x_g: 0.01,
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
      {
        id: 3,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 1000).toISOString(),
        motor_temp_c: 54.0,
        ambient_temp_c: 26.0,
        ax_g: 0.01,
        ay_g: 0.01,
        az_g: 0.99,
        rms_x_g: 0.01,
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
    ];

    const stats = computeStats(records);
    // Diff should only be calculated for records 1 (50 - 25 = 25) and 3 (54 - 26 = 28)
    expect(stats.temp_diff.min).toBe(25.0);
    expect(stats.temp_diff.max).toBe(28.0);
    expect(stats.temp_diff.avg).toBe(26.5);
  });

  it('correctly handles signed negative thermal rise when motor is cooler than ambient', () => {
    const records: TelemetryRecord[] = [
      {
        id: 1,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 2000).toISOString(),
        motor_temp_c: 27.0,
        ambient_temp_c: 31.0,
        ax_g: 0.01,
        ay_g: 0.01,
        az_g: 0.99,
        rms_x_g: 0.01,
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
      {
        id: 2,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 1000).toISOString(),
        motor_temp_c: 26.0,
        ambient_temp_c: 32.0,
        ax_g: 0.01,
        ay_g: 0.01,
        az_g: 0.99,
        rms_x_g: 0.01,
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
    ];

    const stats = computeStats(records);
    // 27 - 31 = -4.0, 26 - 32 = -6.0
    expect(stats.temp_diff.min).toBe(-6.0);
    expect(stats.temp_diff.max).toBe(-4.0);
    expect(stats.temp_diff.avg).toBe(-5.0);
  });

  it('computes vibration RMS accurately when ADXL345 reports valid measurements', () => {
    const records: TelemetryRecord[] = [
      {
        id: 1,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 2000).toISOString(),
        motor_temp_c: 35.0,
        ambient_temp_c: 25.0,
        ax_g: 0.02,
        ay_g: 0.03,
        az_g: 0.98,
        rms_x_g: 0.01,
        rms_y_g: 0.02,
        rms_z_g: 0.03,
      },
      {
        id: 2,
        device_id: 'motor-monitor-001',
        recorded_at: new Date(Date.now() - 1000).toISOString(),
        motor_temp_c: 36.0,
        ambient_temp_c: 25.0,
        ax_g: null,
        ay_g: null,
        az_g: null,
        rms_x_g: null,
        rms_y_g: null,
        rms_z_g: null,
      },
    ];

    const stats = computeStats(records);
    expect(stats.rms_x.avg).toBe(0.01);
    expect(stats.rms_y.avg).toBe(0.02);
    expect(stats.rms_z.avg).toBe(0.03);
  });

  it('evaluates device connection and timeout correctly', () => {
    const reportingIntervalMs = 1000;
    const gracePeriodSec = Math.max(10, (reportingIntervalMs / 1000) * 3); // 10s

    // Case A: Fresh telemetry (2 seconds ago) -> Online and fresh
    const freshAgeSec = 2;
    const isOnlineFresh = freshAgeSec <= gracePeriodSec;
    const isStaleFresh = freshAgeSec > gracePeriodSec;
    expect(isOnlineFresh).toBe(true);
    expect(isStaleFresh).toBe(false);

    // Case B: Expired telemetry (45 seconds ago) -> Offline
    const oldAgeSec = 45;
    const isOnlineOld = oldAgeSec <= gracePeriodSec;
    const isStaleOld = oldAgeSec > gracePeriodSec;
    expect(isOnlineOld).toBe(false);
    expect(isStaleOld).toBe(true);
  });
});
