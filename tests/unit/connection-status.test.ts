import { describe, it, expect } from 'vitest';
import { calculateDeviceConnectionStatus } from '@/lib/supabase/db';
import { DeviceRecord } from '@/lib/types/telemetry';

describe('Strict Server-Side Online/Offline Calculation', () => {
  const baseDevice: DeviceRecord = {
    id: 'dev-1',
    device_id: 'motor-monitor-001',
    display_name: 'Motor Monitor',
    location: 'Lab A',
    enabled: true,
    last_seen_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const fixedNow = 1700000000000; // Fixed timestamp ms

  it('reports NEVER_CONNECTED if device has never sent a packet (null last_seen_at)', () => {
    const dev = { ...baseDevice, last_seen_at: null };
    const status = calculateDeviceConnectionStatus(dev, { nowMs: fixedNow });
    expect(status).toBe('NEVER_CONNECTED');
  });

  it('reports NEVER_CONNECTED if device record is null', () => {
    const status = calculateDeviceConnectionStatus(null, { nowMs: fixedNow });
    expect(status).toBe('NEVER_CONNECTED');
  });

  it('reports ONLINE when last_seen_at was 5 seconds ago (within 25s window)', () => {
    const dev = {
      ...baseDevice,
      last_seen_at: new Date(fixedNow - 5000).toISOString(),
    };
    const status = calculateDeviceConnectionStatus(dev, { nowMs: fixedNow });
    expect(status).toBe('ONLINE');
  });

  it('reports ONLINE when last_seen_at was exactly 25 seconds ago (boundary)', () => {
    const dev = {
      ...baseDevice,
      last_seen_at: new Date(fixedNow - 25000).toISOString(),
    };
    const status = calculateDeviceConnectionStatus(dev, { nowMs: fixedNow });
    expect(status).toBe('ONLINE');
  });

  it('reports STALE when communication stopped 45 seconds ago (between 25s and 120s)', () => {
    const dev = {
      ...baseDevice,
      last_seen_at: new Date(fixedNow - 45000).toISOString(),
    };
    const status = calculateDeviceConnectionStatus(dev, { nowMs: fixedNow });
    expect(status).toBe('STALE');
  });

  it('reports OFFLINE when communication exceeded 120 seconds timeout', () => {
    const dev = {
      ...baseDevice,
      last_seen_at: new Date(fixedNow - 130000).toISOString(),
    };
    const status = calculateDeviceConnectionStatus(dev, { nowMs: fixedNow });
    expect(status).toBe('OFFLINE');
  });

  it('tolerates small negative clock skew without reporting error', () => {
    const dev = {
      ...baseDevice,
      last_seen_at: new Date(fixedNow + 1000).toISOString(), // 1s ahead
    };
    const status = calculateDeviceConnectionStatus(dev, { nowMs: fixedNow });
    expect(status).toBe('ONLINE');
  });
});
