import { describe, it, expect, beforeEach } from 'vitest';
import {
  SingleDiagnosticEventSchema,
  IngestDiagnosticEventsPayloadSchema,
} from '@/lib/validation/events';
import {
  insertDiagnosticEvent,
  insertDiagnosticEventsBatch,
  getDeviceDiagnosticEvents,
} from '@/lib/supabase/db';
import { DeviceDiagnosticEvent } from '@/lib/types/events';

describe('Diagnostic Events Ingestion & Validation', () => {
  const sampleEvent: DeviceDiagnosticEvent = {
    id: 'evt-test-001',
    device_id: 'motor-monitor-001',
    component: 'wifi',
    event_code: 'WIFI_CONNECTED',
    severity: 'info',
    previous_state: 'disconnected',
    new_state: 'connected',
    event_timestamp: new Date().toISOString(),
    timestamp_source: 'rtc',
    diagnostic_message: 'Wi-Fi link established with local router',
    details: { ip: '192.168.1.120', rssi_dbm: -58 },
    firmware_version: '1.5.0-fast-rt',
    resolved: true,
  };

  it('validates a correct single diagnostic event schema', () => {
    const res = SingleDiagnosticEventSchema.safeParse(sampleEvent);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.component).toBe('wifi');
      expect(res.data.severity).toBe('info');
      expect(res.data.event_code).toBe('WIFI_CONNECTED');
    }
  });

  it('rejects an invalid component name', () => {
    const invalid = { ...sampleEvent, component: 'microwave_oven' };
    const res = SingleDiagnosticEventSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });

  it('rejects an invalid severity', () => {
    const invalid = { ...sampleEvent, severity: 'catastrophic' };
    const res = SingleDiagnosticEventSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });

  it('rejects lowercase or invalid characters in event_code', () => {
    const invalid = { ...sampleEvent, event_code: 'wifi-connected' };
    const res = SingleDiagnosticEventSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });

  it('accepts payload whether as single object, array, or wrapped in { events: [] }', () => {
    // Single object
    expect(IngestDiagnosticEventsPayloadSchema.safeParse(sampleEvent).success).toBe(true);

    // Array of objects
    expect(IngestDiagnosticEventsPayloadSchema.safeParse([sampleEvent]).success).toBe(true);

    // Wrapped in events object
    expect(IngestDiagnosticEventsPayloadSchema.safeParse({ events: [sampleEvent] }).success).toBe(true);
  });

  it('performs idempotent insertion and deduplication across identical event IDs', async () => {
    const uniqueId = `evt-idemp-${Date.now()}`;
    const testEvent: DeviceDiagnosticEvent = {
      ...sampleEvent,
      id: uniqueId,
      event_code: 'ADXL345_NOT_RESPONDING',
      component: 'adxl345',
      severity: 'error',
      previous_state: 'ready',
      new_state: 'fault',
      resolved: false,
    };

    // First insertion
    const firstResult = await insertDiagnosticEventsBatch([testEvent]);
    expect(firstResult.inserted).toBe(1);
    expect(firstResult.skipped).toBe(0);

    // Duplicate insertion with the exact same ID
    const secondResult = await insertDiagnosticEventsBatch([testEvent]);
    expect(secondResult.inserted).toBe(0);
    expect(secondResult.skipped).toBe(1);
  });

  it('filters events by component, severity, and resolution status', async () => {
    const deviceId = `filter-dev-${Date.now()}`;
    const ev1: DeviceDiagnosticEvent = {
      ...sampleEvent,
      id: `evt-f1-${Date.now()}`,
      device_id: deviceId,
      component: 'motor_temp',
      severity: 'warning',
      previous_state: 'ready',
      new_state: 'sensor_missing',
      resolved: false,
      event_timestamp: new Date(Date.now() - 10000).toISOString(),
    };
    const ev2: DeviceDiagnosticEvent = {
      ...sampleEvent,
      id: `evt-f2-${Date.now()}`,
      device_id: deviceId,
      component: 'motor_temp',
      severity: 'info',
      previous_state: 'sensor_missing',
      new_state: 'ready',
      resolved: true,
      event_timestamp: new Date().toISOString(),
    };
    const ev3: DeviceDiagnosticEvent = {
      ...sampleEvent,
      id: `evt-f3-${Date.now()}`,
      device_id: deviceId,
      component: 'rtc',
      severity: 'critical',
      previous_state: 'valid',
      new_state: 'oscillator_stopped',
      resolved: false,
      event_timestamp: new Date(Date.now() - 5000).toISOString(),
    };

    await insertDiagnosticEventsBatch([ev1, ev2, ev3]);

    // Query all for this device
    const all = await getDeviceDiagnosticEvents({ deviceId });
    expect(all.length).toBe(3);

    // Filter by component
    const tempOnly = await getDeviceDiagnosticEvents({ deviceId, component: 'motor_temp' });
    expect(tempOnly.length).toBe(2);
    expect(tempOnly.every((e) => e.component === 'motor_temp')).toBe(true);

    // Filter by severity
    const criticalOnly = await getDeviceDiagnosticEvents({ deviceId, severity: 'critical' });
    expect(criticalOnly.length).toBe(1);
    expect(criticalOnly[0].id).toBe(ev3.id);

    // Filter by unresolved only
    const unresolvedOnly = await getDeviceDiagnosticEvents({ deviceId, unresolvedOnly: true });
    expect(unresolvedOnly.length).toBe(2);
    expect(unresolvedOnly.every((e) => e.resolved === false)).toBe(true);
  });
});
