import crypto from 'crypto';
import { getAdminClient } from './admin';
import {
  TelemetryRecord,
  DeviceRecord,
  TelemetryStats,
  DeviceConnectionStatus,
  StorageBudgetBreakdown,
} from '../types/telemetry';
import { DeviceConfig, DeviceConfigAck } from '../types/config';
import {
  DeviceCommandRecord,
  CreateCommandRequest,
  CommandAckRequest,
} from '../types/commands';
import { DeviceDiagnosticEvent, DiagnosticEventsFilter } from '../types/events';

export function toDeterministicUuid(str: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return str;
  }
  const hex = crypto.createHash('md5').update(str).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// In-memory test store used for local testing, CI, and Playwright verification
class MockDatabaseStore {
  devices: Map<string, DeviceRecord> = new Map();
  telemetry: TelemetryRecord[] = [];
  configs: Map<string, DeviceConfig[]> = new Map();
  acks: Map<string, DeviceConfigAck[]> = new Map();
  commands: DeviceCommandRecord[] = [];
  events: DeviceDiagnosticEvent[] = [];

  constructor() {
    this.seedDefault();
  }

  seedDefault() {
    this.devices.clear();
    this.telemetry = [];
    this.configs.clear();
    this.acks.clear();
    this.commands = [];
    this.events = [];

    const now = new Date();
    // Default prototype device
    this.devices.set('motor-monitor-001', {
      id: 'd0000001-0000-0000-0000-000000000001',
      device_id: 'motor-monitor-001',
      display_name: 'Induction Motor Prototype #1',
      location: 'Test Bench A (ESP32-S3 N16R8)',
      enabled: true,
      last_seen_at: new Date(now.getTime() - 2000).toISOString(),
      wifi_rssi_dbm: -62,
      sensor_status: { adxl345: 'ready', motor_temp: 'ready', ambient_temp: 'ready' },
      created_at: new Date(now.getTime() - 86400000).toISOString(),
      updated_at: now.toISOString(),
    });

    this.configs.set('motor-monitor-001', [
      {
        id: 'c0000001-0000-0000-0000-000000000001',
        device_id: 'motor-monitor-001',
        config_version: 1,
        reporting_interval_ms: 1000,
        enabled_fields: ['motor_temp_c', 'ambient_temp_c', 'ax_g', 'ay_g', 'az_g', 'rms_x_g', 'rms_y_g', 'rms_z_g'],
        configuration_json: { sensor_adxl345_range_g: 16, sensor_ds18b20_resolution_bits: 12 },
        updated_at: now.toISOString(),
      },
    ]);

    this.acks.set('motor-monitor-001', [
      {
        id: 'a0000001-0000-0000-0000-000000000001',
        device_id: 'motor-monitor-001',
        acknowledged_config_version: 1,
        acknowledged_at: now.toISOString(),
        firmware_version: 'v1.0.0-esp32s3',
        status: 'acknowledged',
      },
    ]);

    // Seed realistic sample historical points only when real Supabase is not configured
    if (!isRealSupabaseConfigured()) {
      const totalSamples = 30;
      for (let i = totalSamples; i >= 0; i--) {
        const timeOffsetMs = i * 60 * 1000; // every 1 min
        const recTime = new Date(now.getTime() - timeOffsetMs).toISOString();
        const motorT = 42.5 + Math.sin(i / 5) * 2.2;
        const ambT = 28.0 + Math.cos(i / 7) * 0.8;
        this.telemetry.push({
          id: totalSamples - i + 1,
          device_id: 'motor-monitor-001',
          recorded_at: recTime,
          motor_temp_c: Number(motorT.toFixed(2)),
          ambient_temp_c: Number(ambT.toFixed(2)),
          ax_g: Number((0.02 + Math.sin(i) * 0.03).toFixed(4)),
          ay_g: Number((-0.05 + Math.cos(i) * 0.04).toFixed(4)),
          az_g: Number((0.98 + Math.sin(i * 2) * 0.02).toFixed(4)),
          rms_x_g: Number((0.008 + Math.abs(Math.sin(i)) * 0.005).toFixed(4)),
          rms_y_g: Number((0.009 + Math.abs(Math.cos(i)) * 0.006).toFixed(4)),
          rms_z_g: Number((0.012 + Math.abs(Math.sin(i * 1.5)) * 0.008).toFixed(4)),
          firmware_version: 'v1.0.0-esp32s3',
          sample_count: 200,
          acquisition_quality: 1.0,
        });
      }
    }

    // Seed baseline diagnostic events
    this.events.push({
      id: 'e0000001-0000-0000-0000-000000000001',
      device_id: 'motor-monitor-001',
      component: 'esp32',
      event_code: 'BOOT_INITIALIZED',
      severity: 'info',
      previous_state: null,
      new_state: 'READY',
      event_timestamp: new Date(now.getTime() - 7200000).toISOString(),
      timestamp_source: 'system',
      diagnostic_message: 'ESP32-S3 firmware initialized with Core 0 real-time engine',
      details: { fw: '1.5.0-fast-rt', cores: 2 },
      firmware_version: '1.5.0-fast-rt',
      resolved: true,
      server_received_at: new Date(now.getTime() - 7200000).toISOString(),
    });
    this.events.push({
      id: 'e0000001-0000-0000-0000-000000000002',
      device_id: 'motor-monitor-001',
      component: 'wifi',
      event_code: 'WIFI_CONNECTED',
      severity: 'info',
      previous_state: 'DISCONNECTED',
      new_state: 'CONNECTED',
      event_timestamp: new Date(now.getTime() - 7190000).toISOString(),
      timestamp_source: 'system',
      diagnostic_message: 'Wi-Fi station associated and IP acquired',
      details: { rssi_dbm: -62 },
      firmware_version: '1.5.0-fast-rt',
      resolved: true,
      server_received_at: new Date(now.getTime() - 7190000).toISOString(),
    });
    this.events.push({
      id: 'e0000001-0000-0000-0000-000000000003',
      device_id: 'motor-monitor-001',
      component: 'sd_card',
      event_code: 'SD_CARD_MISSING',
      severity: 'warning',
      previous_state: 'UNKNOWN',
      new_state: 'MISSING',
      event_timestamp: new Date(now.getTime() - 7180000).toISOString(),
      timestamp_source: 'system',
      diagnostic_message: 'MicroSD SPI mount failed. Internal LittleFS flash fallback activated.',
      details: { fallback: 'flash_littlefs', cs_pin: 15 },
      firmware_version: '1.5.0-fast-rt',
      resolved: false,
      server_received_at: new Date(now.getTime() - 7180000).toISOString(),
    });
  }

  clear() {
    this.devices.clear();
    this.telemetry = [];
    this.configs.clear();
    this.acks.clear();
    this.commands = [];
    this.events = [];
  }
}

// Global singleton mock store
const mockDb = new MockDatabaseStore();

export function getMockDatabaseInstance() {
  return mockDb;
}

export function isRealSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return false;
  if (url.includes('placeholder')) return false;
  return true;
}

export async function getDevices(): Promise<DeviceRecord[]> {
  const admin = getAdminClient();
  if (admin) {
    const { data, error } = await admin
      .from('devices')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && data) {
      return data as DeviceRecord[];
    }
  }

  // Fallback to mock store
  return Array.from(mockDb.devices.values());
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  const admin = getAdminClient();
  const mockDev = mockDb.devices.get(deviceId);

  if (admin) {
    const { data, error } = await admin
      .from('devices')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!error && data) {
      const dev = data as DeviceRecord;
      if (mockDev) {
        if (mockDev.sensor_status) dev.sensor_status = mockDev.sensor_status;
        if (mockDev.wifi_rssi_dbm !== undefined) dev.wifi_rssi_dbm = mockDev.wifi_rssi_dbm;
        if (mockDev.last_seen_at && new Date(mockDev.last_seen_at).getTime() > new Date(dev.last_seen_at || 0).getTime()) {
          dev.last_seen_at = mockDev.last_seen_at;
        }
      }
      return dev;
    }

    if (mockDev) return mockDev;
  }

  return mockDev || null;
}

export async function insertTelemetry(record: Omit<TelemetryRecord, 'id'>): Promise<TelemetryRecord> {
  const admin = getAdminClient();
  const recordedAt = record.recorded_at || new Date().toISOString();

  // Idempotency: If record_id is provided, check if it was already inserted
  if (record.record_id) {
    if (admin) {
      const { data: existing } = await admin
        .from('telemetry')
        .select('*')
        .eq('record_id', record.record_id)
        .maybeSingle();
      if (existing) {
        return existing as TelemetryRecord;
      }
    } else {
      const existing = mockDb.telemetry.find((t) => t.record_id === record.record_id);
      if (existing) {
        return existing;
      }
    }
  }

  if (admin) {
    // 1. Ensure device exists in devices table & record heartbeat and sensor status
    const devUpsert: Record<string, unknown> = {
      device_id: record.device_id,
      display_name: `Motor Device ${record.device_id}`,
      last_seen_at: recordedAt,
      updated_at: recordedAt,
    };
    if (record.sensor_status) {
      devUpsert.sensor_status = record.sensor_status;
    }
    if (record.wifi_rssi_dbm !== undefined) {
      devUpsert.wifi_rssi_dbm = record.wifi_rssi_dbm;
    }
    if (record.sd_card_status) {
      devUpsert.sd_card_status = record.sd_card_status;
    }
    if (record.rtc_status) {
      devUpsert.rtc_status = record.rtc_status;
    }
    if (record.unsynced_records_count !== undefined) {
      devUpsert.unsynced_records_count = record.unsynced_records_count;
    }
    if (record.measured_at) {
      devUpsert.last_measured_at = record.measured_at;
    }
    if (record.condition_status) {
      devUpsert.condition_status = record.condition_status;
    }
    if (record.condition_reason) {
      devUpsert.condition_reason = record.condition_reason;
    }
    if (record.storage_medium) {
      devUpsert.storage_medium = record.storage_medium;
    }
    if (record.storage_used_pct !== undefined) {
      devUpsert.storage_used_pct = record.storage_used_pct;
    }
    if (record.dropped_records_count !== undefined) {
      devUpsert.dropped_records_count = record.dropped_records_count;
    }

    const { error: devError } = await admin
      .from('devices')
      .upsert(devUpsert, { onConflict: 'device_id' });

    // Fallback if newer columns don't exist yet on remote table
    if (devError && (devError.message.includes('column') || devError.code === '42703')) {
      await admin.from('devices').upsert(
        {
          device_id: record.device_id,
          display_name: `Motor Device ${record.device_id}`,
          last_seen_at: recordedAt,
          updated_at: recordedAt,
        },
        { onConflict: 'device_id' }
      );
    }

    // 2. Insert telemetry record
    const telemetryInsertPayload: Record<string, unknown> = {
      device_id: record.device_id,
      recorded_at: recordedAt,
      motor_temp_c: record.motor_temp_c ?? null,
      ambient_temp_c: record.ambient_temp_c ?? null,
      ax_g: record.ax_g ?? null,
      ay_g: record.ay_g ?? null,
      az_g: record.az_g ?? null,
      rms_x_g: record.rms_x_g ?? null,
      rms_y_g: record.rms_y_g ?? null,
      rms_z_g: record.rms_z_g ?? null,
      firmware_version: record.firmware_version ?? null,
      sample_count: record.sample_count ?? null,
      acquisition_quality: record.acquisition_quality ?? null,
    };
    if (record.record_id) {
      telemetryInsertPayload.record_id = record.record_id;
    }
    if (record.measured_at) {
      telemetryInsertPayload.measured_at = record.measured_at;
    }
    if (record.wifi_rssi_dbm !== undefined) {
      telemetryInsertPayload.wifi_rssi_dbm = record.wifi_rssi_dbm;
    }
    if (record.sensor_status) {
      telemetryInsertPayload.sensor_status = record.sensor_status;
    }
    if (record.i2c_errors !== undefined) {
      telemetryInsertPayload.i2c_errors = record.i2c_errors;
    }
    if (record.missed_sample_slots !== undefined) {
      telemetryInsertPayload.missed_sample_slots = record.missed_sample_slots;
    }
    if (record.sd_card_status) {
      telemetryInsertPayload.sd_card_status = record.sd_card_status;
    }
    if (record.unsynced_records_count !== undefined) {
      telemetryInsertPayload.unsynced_records_count = record.unsynced_records_count;
    }
    if (record.oldest_unsynced_timestamp) {
      telemetryInsertPayload.oldest_unsynced_timestamp = record.oldest_unsynced_timestamp;
    }
    if (record.rtc_status) {
      telemetryInsertPayload.rtc_status = record.rtc_status;
    }
    if (record.rtc_synced !== undefined) {
      telemetryInsertPayload.rtc_synced = record.rtc_synced;
    }
    if (record.condition_status) {
      telemetryInsertPayload.condition_status = record.condition_status;
    }
    if (record.condition_reason) {
      telemetryInsertPayload.condition_reason = record.condition_reason;
    }
    if (record.storage_medium) {
      telemetryInsertPayload.storage_medium = record.storage_medium;
    }
    if (record.storage_used_pct !== undefined) {
      telemetryInsertPayload.storage_used_pct = record.storage_used_pct;
    }
    if (record.dropped_records_count !== undefined) {
      telemetryInsertPayload.dropped_records_count = record.dropped_records_count;
    }

    let { data, error } = await admin
      .from('telemetry')
      .insert(telemetryInsertPayload)
      .select()
      .single();

    // Idempotency: Duplicate record_id race handling
    if (error && (error.code === '23505' || error.message.includes('duplicate key') || error.message.includes('unique constraint'))) {
      if (record.record_id) {
        const { data: existing } = await admin
          .from('telemetry')
          .select('*')
          .eq('record_id', record.record_id)
          .maybeSingle();
        if (existing) return existing as TelemetryRecord;
      }
    }

    // If remote table doesn't have the new columns yet, retry without them
    if (error && (error.message.includes('column') || error.code === '42703')) {
      delete telemetryInsertPayload.record_id;
      delete telemetryInsertPayload.measured_at;
      delete telemetryInsertPayload.sd_card_status;
      delete telemetryInsertPayload.unsynced_records_count;
      delete telemetryInsertPayload.oldest_unsynced_timestamp;
      delete telemetryInsertPayload.rtc_status;
      delete telemetryInsertPayload.rtc_synced;
      delete telemetryInsertPayload.wifi_rssi_dbm;
      delete telemetryInsertPayload.sensor_status;
      delete telemetryInsertPayload.i2c_errors;
      delete telemetryInsertPayload.missed_sample_slots;
      delete telemetryInsertPayload.condition_status;
      delete telemetryInsertPayload.condition_reason;
      delete telemetryInsertPayload.storage_medium;
      delete telemetryInsertPayload.storage_used_pct;
      delete telemetryInsertPayload.dropped_records_count;
      const retry = await admin
        .from('telemetry')
        .insert(telemetryInsertPayload)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error && (error.code === '23502' || error.message.includes('not-null constraint'))) {
      console.warn(
        `[DB_MIGRATION_PENDING] Live Supabase database requires migration to allow NULL columns for disconnected sensors: ${error.message}. Telemetry cached in store.`
      );
      // Fall through to update mockDb store so telemetry is preserved and API succeeds with 201
    } else if (error) {
      throw new Error(`Supabase telemetry insert failed: ${error.message}`);
    } else if (data) {
      return data as TelemetryRecord;
    }
  }

  // Update mock database
  const dev = mockDb.devices.get(record.device_id);
  if (dev) {
    dev.last_seen_at = recordedAt;
    dev.updated_at = recordedAt;
    if (record.sensor_status) dev.sensor_status = record.sensor_status;
    if (record.wifi_rssi_dbm !== undefined) dev.wifi_rssi_dbm = record.wifi_rssi_dbm;
    if (record.sd_card_status) dev.sd_card_status = record.sd_card_status;
    if (record.rtc_status) dev.rtc_status = record.rtc_status;
    if (record.unsynced_records_count !== undefined) dev.unsynced_records_count = record.unsynced_records_count;
    if (record.measured_at) dev.last_measured_at = record.measured_at;
    if (record.condition_status) dev.condition_status = record.condition_status;
    if (record.condition_reason) dev.condition_reason = record.condition_reason;
    if (record.storage_medium) dev.storage_medium = record.storage_medium;
    if (record.storage_used_pct !== undefined) dev.storage_used_pct = record.storage_used_pct;
    if (record.dropped_records_count !== undefined) dev.dropped_records_count = record.dropped_records_count;
  } else {
    mockDb.devices.set(record.device_id, {
      id: `dev-${Date.now()}`,
      device_id: record.device_id,
      display_name: `Motor Device ${record.device_id}`,
      location: 'Test Location',
      enabled: true,
      last_seen_at: recordedAt,
      wifi_rssi_dbm: record.wifi_rssi_dbm ?? null,
      sensor_status: record.sensor_status,
      sd_card_status: record.sd_card_status ?? 'not_initialized',
      rtc_status: record.rtc_status ?? 'not_detected',
      unsynced_records_count: record.unsynced_records_count ?? 0,
      last_measured_at: record.measured_at ?? null,
      condition_status: record.condition_status ?? null,
      condition_reason: record.condition_reason ?? null,
      storage_medium: record.storage_medium ?? null,
      storage_used_pct: record.storage_used_pct ?? null,
      dropped_records_count: record.dropped_records_count ?? 0,
      created_at: recordedAt,
      updated_at: recordedAt,
    });
  }

  const newRecord: TelemetryRecord = {
    ...record,
    id: mockDb.telemetry.length + 1,
    recorded_at: recordedAt,
    measured_at: record.measured_at || recordedAt,
    i2c_errors: record.i2c_errors ?? 0,
    missed_sample_slots: record.missed_sample_slots ?? 0,
    sd_card_status: record.sd_card_status ?? 'not_initialized',
    rtc_status: record.rtc_status ?? 'not_detected',
    unsynced_records_count: record.unsynced_records_count ?? 0,
    condition_status: record.condition_status ?? null,
    condition_reason: record.condition_reason ?? null,
    storage_medium: record.storage_medium ?? null,
    storage_used_pct: record.storage_used_pct ?? null,
    dropped_records_count: record.dropped_records_count ?? 0,
  };

  mockDb.telemetry.push(newRecord);
  return newRecord;
}

export async function getLiveTelemetry(
  deviceId: string,
  windowSeconds: number = 300
): Promise<TelemetryRecord[]> {
  const sinceTime = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const admin = getAdminClient();
  const mockRecords = mockDb.telemetry.filter(
    (t) => t.device_id === deviceId && new Date(t.recorded_at).getTime() >= new Date(sinceTime).getTime()
  );

  const sortByTime = (a: TelemetryRecord, b: TelemetryRecord) =>
    new Date(a.measured_at || a.recorded_at).getTime() - new Date(b.measured_at || b.recorded_at).getTime();

  if (admin) {
    const { data, error } = await admin
      .from('telemetry')
      .select('*')
      .eq('device_id', deviceId)
      .gte('recorded_at', sinceTime)
      .order('recorded_at', { ascending: true })
      .limit(1000);

    if (!error && data) {
      if (data.length === 0 && mockRecords.length === 0) {
        // Fallback: Fetch the single most recent record so dashboard always has the latest known reading
        const { data: fallbackLatest } = await admin
          .from('telemetry')
          .select('*')
          .eq('device_id', deviceId)
          .order('recorded_at', { ascending: false })
          .limit(1);
        if (fallbackLatest && fallbackLatest.length > 0) {
          return fallbackLatest as TelemetryRecord[];
        }
      }
      if (mockRecords.length > 0) {
        const combined = [...data, ...mockRecords];
        return combined.sort(sortByTime);
      }
      return (data as TelemetryRecord[]).sort(sortByTime);
    } else if (mockRecords.length > 0) {
      return mockRecords.sort(sortByTime);
    }
  }

  // Mock store
  if (mockRecords.length === 0) {
    const lastMock = mockDb.telemetry
      .filter((t) => t.device_id === deviceId)
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0];
    if (lastMock) return [lastMock];
  }
  return mockRecords.sort(sortByTime);
}

/**
 * Fast exact count of telemetry rows stored in Supabase table.
 * Uses PostgREST HEAD request ({ count: 'exact', head: true }) so zero row data is transferred.
 */
export async function getTotalTelemetryCount(deviceId?: string): Promise<number> {
  const admin = getAdminClient();
  if (admin) {
    try {
      let query = admin.from('telemetry').select('*', { count: 'exact', head: true });
      if (deviceId) {
        query = query.eq('device_id', deviceId);
      }
      const { count, error } = await query;
      if (!error && count !== null) {
        return count;
      }
    } catch (err) {
      console.warn('[TOTAL_COUNT_ERROR]', err);
    }
  }

  // Fallback for mock store
  if (deviceId) {
    return mockDb.telemetry.filter((t) => t.device_id === deviceId).length;
  }
  return mockDb.telemetry.length;
}

export async function getHistoricalTelemetry(
  deviceId: string,
  startDate?: string,
  endDate?: string,
  limit: number = 500
): Promise<TelemetryRecord[]> {
  const admin = getAdminClient();
  const sortByTime = (a: TelemetryRecord, b: TelemetryRecord) =>
    new Date(a.measured_at || a.recorded_at).getTime() - new Date(b.measured_at || b.recorded_at).getTime();

  if (admin) {
    let query = admin
      .from('telemetry')
      .select('*')
      .eq('device_id', deviceId);

    if (startDate) {
      query = query.gte('recorded_at', startDate);
    }
    if (endDate) {
      query = query.lte('recorded_at', endDate);
    }

    const { data, error } = await query
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (!error && data) {
      return (data as TelemetryRecord[]).sort(sortByTime);
    }
  }

  let records = mockDb.telemetry.filter((t) => t.device_id === deviceId);
  if (startDate) {
    const startMs = new Date(startDate).getTime();
    records = records.filter((t) => new Date(t.recorded_at).getTime() >= startMs);
  }
  if (endDate) {
    const endMs = new Date(endDate).getTime();
    records = records.filter((t) => new Date(t.recorded_at).getTime() <= endMs);
  }

  return records
    .sort(sortByTime)
    .slice(-limit);
}

export function computeStats(records: TelemetryRecord[]): TelemetryStats {
  if (records.length === 0) {
    return {
      sample_count: 0,
      motor_temp: { min: 0, max: 0, avg: 0 },
      ambient_temp: { min: 0, max: 0, avg: 0 },
      temp_diff: { min: 0, max: 0, avg: 0 },
      rms_x: { min: 0, max: 0, avg: 0 },
      rms_y: { min: 0, max: 0, avg: 0 },
      rms_z: { min: 0, max: 0, avg: 0 },
    };
  }

  const calc = (arr: number[]) => {
    if (arr.length === 0) {
      return { min: 0, max: 0, avg: 0 };
    }
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      min: Number(min.toFixed(3)),
      max: Number(max.toFixed(3)),
      avg: Number(avg.toFixed(3)),
    };
  };

  const motorTemps = records
    .map((r) => r.motor_temp_c)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(Number(v)))
    .map(Number);

  const ambTemps = records
    .map((r) => r.ambient_temp_c)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(Number(v)))
    .map(Number);

  const diffs = records
    .filter(
      (r) =>
        r.motor_temp_c !== null &&
        r.motor_temp_c !== undefined &&
        Number.isFinite(Number(r.motor_temp_c)) &&
        r.ambient_temp_c !== null &&
        r.ambient_temp_c !== undefined &&
        Number.isFinite(Number(r.ambient_temp_c))
    )
    .map((r) => Number(r.motor_temp_c) - Number(r.ambient_temp_c));

  const rmsX = records
    .map((r) => r.rms_x_g)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(Number(v)))
    .map(Number);

  const rmsY = records
    .map((r) => r.rms_y_g)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(Number(v)))
    .map(Number);

  const rmsZ = records
    .map((r) => r.rms_z_g)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(Number(v)))
    .map(Number);

  return {
    sample_count: records.length,
    motor_temp: calc(motorTemps),
    ambient_temp: calc(ambTemps),
    temp_diff: calc(diffs),
    rms_x: calc(rmsX),
    rms_y: calc(rmsY),
    rms_z: calc(rmsZ),
  };
}

export async function getDeviceConfig(deviceId: string): Promise<DeviceConfig | null> {
  const admin = getAdminClient();
  if (admin) {
    const { data, error } = await admin
      .from('device_config')
      .select('*')
      .eq('device_id', deviceId)
      .order('config_version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return data as DeviceConfig;
    }
  }

  const list = mockDb.configs.get(deviceId) || [];
  return list.length > 0 ? list[list.length - 1] : null;
}

export async function updateDeviceConfig(
  deviceId: string,
  reportingIntervalMs: number,
  enabledFields: string[],
  configJson: Record<string, unknown> = {}
): Promise<DeviceConfig> {
  const current = await getDeviceConfig(deviceId);
  const nextVersion = (current?.config_version ?? 0) + 1;
  const admin = getAdminClient();

  if (admin) {
    const { data, error } = await admin
      .from('device_config')
      .insert({
        device_id: deviceId,
        config_version: nextVersion,
        reporting_interval_ms: reportingIntervalMs,
        enabled_fields: enabledFields,
        configuration_json: configJson,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update device config: ${error.message}`);
    }

    return data as DeviceConfig;
  }

  const newConfig: DeviceConfig = {
    id: `cfg-${Date.now()}`,
    device_id: deviceId,
    config_version: nextVersion,
    reporting_interval_ms: reportingIntervalMs,
    enabled_fields: enabledFields,
    configuration_json: configJson,
    updated_at: new Date().toISOString(),
  };

  const currentList = mockDb.configs.get(deviceId) || [];
  currentList.push(newConfig);
  mockDb.configs.set(deviceId, currentList);
  return newConfig;
}

export async function acknowledgeDeviceConfig(
  deviceId: string,
  version: number,
  firmwareVersion?: string
): Promise<DeviceConfigAck> {
  const admin = getAdminClient();
  if (admin) {
    const { data, error } = await admin
      .from('device_config_ack')
      .insert({
        device_id: deviceId,
        acknowledged_config_version: version,
        firmware_version: firmwareVersion,
        acknowledged_at: new Date().toISOString(),
        status: 'acknowledged',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to insert config ack: ${error.message}`);
    }

    return data as DeviceConfigAck;
  }

  const ack: DeviceConfigAck = {
    id: `ack-${Date.now()}`,
    device_id: deviceId,
    acknowledged_config_version: version,
    firmware_version: firmwareVersion,
    acknowledged_at: new Date().toISOString(),
    status: 'acknowledged',
  };

  const list = mockDb.acks.get(deviceId) || [];
  list.push(ack);
  mockDb.acks.set(deviceId, list);
  return ack;
}

export async function getLatestDeviceAck(deviceId: string): Promise<DeviceConfigAck | null> {
  const admin = getAdminClient();
  if (admin) {
    const { data, error } = await admin
      .from('device_config_ack')
      .select('*')
      .eq('device_id', deviceId)
      .order('acknowledged_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return data as DeviceConfigAck;
    }
  }

  const list = mockDb.acks.get(deviceId) || [];
  return list.length > 0 ? list[list.length - 1] : null;
}

/**
 * Strict server-side connection status calculation.
 * Distinguishes ONLINE, STALE, OFFLINE, NEVER_CONNECTED based on real last_seen_at.
 */
export function calculateDeviceConnectionStatus(
  device: DeviceRecord | null,
  options?: { nowMs?: number; onlineThresholdMs?: number; staleThresholdMs?: number }
): DeviceConnectionStatus {
  if (!device || !device.last_seen_at) return 'NEVER_CONNECTED';
  const lastSeenMs = new Date(device.last_seen_at).getTime();
  if (isNaN(lastSeenMs)) return 'NEVER_CONNECTED';
  const nowMs = options?.nowMs ?? Date.now();
  const ageMs = nowMs - lastSeenMs;
  if (ageMs < 0) return 'ONLINE'; // minor clock skew tolerance
  const onlineThresholdMs = options?.onlineThresholdMs ?? 25000; // 25s (approx 5 reporting cycles)
  const staleThresholdMs = options?.staleThresholdMs ?? 120000; // 2 minutes
  if (ageMs <= onlineThresholdMs) return 'ONLINE';
  if (ageMs <= staleThresholdMs) return 'STALE';
  return 'OFFLINE';
}

/**
 * Creates a new device command and enqueues it.
 */
export async function createDeviceCommand(
  req: CreateCommandRequest,
  requestedBy: string = 'dashboard'
): Promise<DeviceCommandRecord> {
  const admin = getAdminClient();
  const now = new Date();
  const expiresInSec = req.expires_in_seconds ?? 300;
  const expiresAt = new Date(now.getTime() + expiresInSec * 1000).toISOString();

  if (admin) {
    const { data, error } = await admin
      .from('device_commands')
      .insert({
        device_id: req.device_id,
        command_type: req.command_type,
        parameters: req.parameters || {},
        status: 'QUEUED',
        requested_by: requestedBy,
        created_at: now.toISOString(),
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) {
      console.warn(`[SUPABASE_COMMAND_FALLBACK] Failed to insert to device_commands table: ${error.message}. Storing in mock.`);
    } else if (data) {
      return data as DeviceCommandRecord;
    }
  }

  // Fallback to in-memory store
  const id = `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const cmdRecord: DeviceCommandRecord = {
    id,
    device_id: req.device_id,
    command_type: req.command_type,
    parameters: req.parameters || {},
    status: 'QUEUED',
    requested_by: requestedBy,
    created_at: now.toISOString(),
    expires_at: expiresAt,
  };
  mockDb.commands.push(cmdRecord);
  return cmdRecord;
}

/**
 * Retrieves pending commands for an authenticated ESP32 device, advances their status to DELIVERED.
 */
export async function getPendingDeviceCommands(deviceId: string): Promise<DeviceCommandRecord[]> {
  const admin = getAdminClient();
  const nowIso = new Date().toISOString();

  if (admin) {
    try {
      // Expire overdue commands first
      await admin
        .from('device_commands')
        .update({ status: 'EXPIRED' })
        .eq('device_id', deviceId)
        .in('status', ['CREATED', 'QUEUED', 'DELIVERED'])
        .lt('expires_at', nowIso);

      // Fetch queued commands
      const { data, error } = await admin
        .from('device_commands')
        .select('*')
        .eq('device_id', deviceId)
        .in('status', ['CREATED', 'QUEUED'])
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: true })
        .limit(5);

      if (!error && data && data.length > 0) {
        // Mark as DELIVERED
        const ids = data.map((c) => c.id);
        await admin
          .from('device_commands')
          .update({ status: 'DELIVERED', delivered_at: nowIso })
          .in('id', ids);

        return data.map((c) => ({ ...c, status: 'DELIVERED', delivered_at: nowIso })) as DeviceCommandRecord[];
      }
    } catch (e) {
      console.warn(`[SUPABASE_COMMAND_POLL_FALLBACK] Error polling device_commands: ${e}. Using mock store.`);
    }
  }

  // Fallback to in-memory store
  const nowMs = Date.now();
  mockDb.commands.forEach((c) => {
    if (c.device_id === deviceId && ['CREATED', 'QUEUED', 'DELIVERED'].includes(c.status)) {
      if (new Date(c.expires_at).getTime() < nowMs) {
        c.status = 'EXPIRED';
      }
    }
  });

  const pending = mockDb.commands.filter(
    (c) =>
      c.device_id === deviceId &&
      ['CREATED', 'QUEUED'].includes(c.status) &&
      new Date(c.expires_at).getTime() >= nowMs
  );

  pending.forEach((c) => {
    c.status = 'DELIVERED';
    c.delivered_at = nowIso;
  });

  return pending;
}

/**
 * Acknowledges or updates execution status of a device command.
 */
export async function acknowledgeDeviceCommand(
  ack: CommandAckRequest
): Promise<DeviceCommandRecord | null> {
  const admin = getAdminClient();
  const nowIso = new Date().toISOString();

  if (admin) {
    try {
      const updatePayload: Record<string, unknown> = {
        status: ack.status,
      };
      if (ack.status === 'ACKNOWLEDGED' || ack.status === 'EXECUTING') {
        updatePayload.acknowledged_at = nowIso;
      }
      if (ack.status === 'SUCCEEDED' || ack.status === 'FAILED') {
        updatePayload.completed_at = nowIso;
        updatePayload.acknowledged_at = nowIso;
      }
      if (ack.result !== undefined) {
        updatePayload.result = ack.result;
      }
      if (ack.error_message !== undefined) {
        updatePayload.error_message = ack.error_message;
      }

      const { data, error } = await admin
        .from('device_commands')
        .update(updatePayload)
        .eq('id', ack.command_id)
        .select()
        .maybeSingle();

      if (!error && data) {
        return data as DeviceCommandRecord;
      }
    } catch (e) {
      console.warn(`[SUPABASE_COMMAND_ACK_FALLBACK] Error acking command: ${e}. Updating mock store.`);
    }
  }

  // Fallback to in-memory store
  const found = mockDb.commands.find((c) => c.id === ack.command_id);
  if (found) {
    found.status = ack.status;
    if (ack.status === 'ACKNOWLEDGED' || ack.status === 'EXECUTING') {
      if (!found.acknowledged_at) found.acknowledged_at = nowIso;
    }
    if (ack.status === 'SUCCEEDED' || ack.status === 'FAILED') {
      found.completed_at = nowIso;
      if (!found.acknowledged_at) found.acknowledged_at = nowIso;
    }
    if (ack.result !== undefined) found.result = ack.result;
    if (ack.error_message !== undefined) found.error_message = ack.error_message;
    return found;
  }
  return null;
}

/**
 * Retrieves the command execution history for a device.
 */
export async function getDeviceCommandsHistory(
  deviceId: string,
  limit: number = 20
): Promise<DeviceCommandRecord[]> {
  const admin = getAdminClient();

  if (admin) {
    try {
      const { data, error } = await admin
        .from('device_commands')
        .select('*')
        .eq('device_id', deviceId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) {
        return data as DeviceCommandRecord[];
      }
    } catch (e) {
      console.warn(`[SUPABASE_COMMAND_HISTORY_FALLBACK] Error fetching command history: ${e}. Using mock store.`);
    }
  }

  return mockDb.commands
    .filter((c) => c.device_id === deviceId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
}

/**
 * Inserts a single diagnostic event with idempotency.
 */
export async function insertDiagnosticEvent(
  event: DeviceDiagnosticEvent
): Promise<DeviceDiagnosticEvent> {
  const res = await insertDiagnosticEventsBatch([event]);
  if (res.inserted > 0 || res.skipped > 0) {
    return event;
  }
  return event;
}

/**
 * Inserts a batch of diagnostic events idempotently.
 * Ignores duplicate event IDs.
 */
export async function insertDiagnosticEventsBatch(
  events: DeviceDiagnosticEvent[]
): Promise<{ inserted: number; skipped: number }> {
  if (events.length === 0) return { inserted: 0, skipped: 0 };
  const admin = getAdminClient();
  let inserted = 0;
  let skipped = 0;

  if (admin) {
    try {
      const recordsToInsert = events.map((e) => {
        let validTimestamp = e.event_timestamp;
        try {
          const parsed = new Date(e.event_timestamp);
          if (isNaN(parsed.getTime())) {
            validTimestamp = new Date().toISOString();
          }
        } catch {
          validTimestamp = new Date().toISOString();
        }

        return {
          id: toDeterministicUuid(e.id),
          device_id: e.device_id,
          component: e.component,
          event_code: e.event_code,
          severity: e.severity,
          previous_state: e.previous_state ?? null,
          new_state: e.new_state,
          event_timestamp: validTimestamp,
          timestamp_source: e.timestamp_source ?? 'system',
          diagnostic_message: e.diagnostic_message,
          details: e.details ?? {},
          firmware_version: e.firmware_version ?? null,
          resolved: e.resolved ?? false,
        };
      });

      const { data, error } = await admin
        .from('device_diagnostic_events')
        .upsert(recordsToInsert, { onConflict: 'id', ignoreDuplicates: true })
        .select();

      if (!error && data) {
        inserted = data.length;
        skipped = events.length - inserted;
        return { inserted, skipped };
      }
    } catch (e) {
      console.warn(`[SUPABASE_EVENTS_FALLBACK] Error writing events to Supabase: ${e}. Using mock store.`);
    }
  }

  // Mock store fallback (idempotent: skip existing IDs)
  for (const ev of events) {
    const exists = mockDb.events.some((existing) => existing.id === ev.id);
    if (!exists) {
      mockDb.events.push({
        ...ev,
        server_received_at: ev.server_received_at || new Date().toISOString(),
      });
      inserted++;
    } else {
      skipped++;
    }
  }

  return { inserted, skipped };
}

/**
 * Retrieves filtered diagnostic events timeline for a device (newest first).
 */
export async function getDeviceDiagnosticEvents(
  options: DiagnosticEventsFilter
): Promise<DeviceDiagnosticEvent[]> {
  const admin = getAdminClient();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  if (admin) {
    try {
      let query = admin
        .from('device_diagnostic_events')
        .select('*')
        .eq('device_id', options.deviceId);

      if (options.component && options.component !== 'all') {
        query = query.eq('component', options.component);
      }
      if (options.severity && options.severity !== 'all') {
        query = query.eq('severity', options.severity);
      }
      if (options.unresolvedOnly) {
        query = query.eq('resolved', false);
      }

      const { data, error } = await query
        .order('event_timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      if (!error && data) {
        return data as DeviceDiagnosticEvent[];
      }
    } catch (e) {
      console.warn(`[SUPABASE_GET_EVENTS_FALLBACK] Error fetching events: ${e}. Using mock store.`);
    }
  }

  // Mock store fallback
  return mockDb.events
    .filter((e) => {
      if (e.device_id !== options.deviceId) return false;
      if (options.component && options.component !== 'all' && e.component !== options.component) return false;
      if (options.severity && options.severity !== 'all' && e.severity !== options.severity) return false;
      if (options.unresolvedOnly && e.resolved) return false;
      return true;
    })
    .sort((a, b) => new Date(b.event_timestamp).getTime() - new Date(a.event_timestamp).getTime())
    .slice(offset, offset + limit);
}

/**
 * Calculates current Supabase 500 MB Free Tier quota utilization:
 *  - 400 MB dedicated to General Telemetry
 *  - 100 MB reserved for Diagnostics, Errors & Audit Events
 * Also aligns with edge storage 90% ceiling (85% backlog / 15% error reserve).
 */
export async function getStorageBudgetStatus(): Promise<StorageBudgetBreakdown> {
  const admin = getAdminClient();
  const defaultBudget: StorageBudgetBreakdown = {
    cloud: {
      general_data_mb: 0.1,
      general_data_limit_mb: 400.0,
      general_data_used_pct: 0.02,
      error_data_mb: 0.05,
      error_data_limit_mb: 100.0,
      error_data_used_pct: 0.05,
      total_used_mb: 0.15,
      total_limit_mb: 500.0,
      total_used_pct: 0.03,
    },
    edge: {
      total_ceiling_pct: 90.0,
      telemetry_backlog_budget_pct: 85.0,
      error_diagnostics_budget_pct: 15.0,
      fifo_step_deletion_active: true,
    },
  };

  if (!admin) {
    const telRows = mockDb.telemetry.length;
    const evtRows = mockDb.events.length;
    const genMb = Number(((telRows * 500) / (1024 * 1024)).toFixed(2));
    const errMb = Number(((evtRows * 600) / (1024 * 1024)).toFixed(2));
    defaultBudget.cloud.general_data_mb = Math.max(0.01, genMb);
    defaultBudget.cloud.general_data_used_pct = Number(((genMb / 400.0) * 100).toFixed(2));
    defaultBudget.cloud.error_data_mb = Math.max(0.01, errMb);
    defaultBudget.cloud.error_data_used_pct = Number(((errMb / 100.0) * 100).toFixed(2));
    defaultBudget.cloud.total_used_mb = Number((genMb + errMb).toFixed(2));
    defaultBudget.cloud.total_used_pct = Number((((genMb + errMb) / 500.0) * 100).toFixed(2));
    return defaultBudget;
  }

  try {
    const { data: rpcData, error: rpcError } = await admin.rpc('get_storage_budget_status');
    if (!rpcError && rpcData && typeof rpcData === 'object' && 'cloud_quota' in rpcData) {
      const cq = (rpcData as { cloud_quota: Record<string, number> }).cloud_quota;
      return {
        cloud: {
          general_data_mb: Number(cq.general_data_mb || 0),
          general_data_limit_mb: 400.0,
          general_data_used_pct: Number(cq.general_data_used_pct || 0),
          error_data_mb: Number(cq.error_data_mb || 0),
          error_data_limit_mb: 100.0,
          error_data_used_pct: Number(cq.error_data_used_pct || 0),
          total_used_mb: Number(cq.total_used_mb || 0),
          total_limit_mb: 500.0,
          total_used_pct: Number(cq.total_used_pct || 0),
        },
        edge: {
          total_ceiling_pct: 90.0,
          telemetry_backlog_budget_pct: 85.0,
          error_diagnostics_budget_pct: 15.0,
          fifo_step_deletion_active: true,
        },
      };
    }

    const [telRes, evtRes] = await Promise.all([
      admin.from('telemetry').select('id', { count: 'exact', head: true }),
      admin.from('device_diagnostic_events').select('id', { count: 'exact', head: true }),
    ]);

    const telCount = telRes.count || 0;
    const evtCount = evtRes.count || 0;
    const estimatedGenBytes = telCount * 750 + 50000;
    const estimatedErrBytes = evtCount * 800 + 50000;
    const genMb = Number((estimatedGenBytes / (1024 * 1024)).toFixed(2));
    const errMb = Number((estimatedErrBytes / (1024 * 1024)).toFixed(2));
    const totMb = Number((genMb + errMb).toFixed(2));

    return {
      cloud: {
        general_data_mb: genMb,
        general_data_limit_mb: 400.0,
        general_data_used_pct: Number(((genMb / 400.0) * 100).toFixed(2)),
        error_data_mb: errMb,
        error_data_limit_mb: 100.0,
        error_data_used_pct: Number(((errMb / 100.0) * 100).toFixed(2)),
        total_used_mb: totMb,
        total_limit_mb: 500.0,
        total_used_pct: Number(((totMb / 500.0) * 100).toFixed(2)),
      },
      edge: {
        total_ceiling_pct: 90.0,
        telemetry_backlog_budget_pct: 85.0,
        error_diagnostics_budget_pct: 15.0,
        fifo_step_deletion_active: true,
      },
    };
  } catch {
    return defaultBudget;
  }
}

/**
 * High-throughput batch insertion of telemetry records.
 * Drastically speeds up backlog flushes when offline devices catch an internet connection.
 */
export async function insertTelemetryBatch(
  records: Array<Omit<TelemetryRecord, 'id'>>
): Promise<TelemetryRecord[]> {
  if (records.length === 0) return [];
  if (records.length === 1) {
    const single = await insertTelemetry(records[0]);
    return [single];
  }

  const admin = getAdminClient();
  const latestRecord = records[records.length - 1];
  const recordedAt = latestRecord.recorded_at || new Date().toISOString();

  if (admin) {
    try {
      const devUpsert: Record<string, unknown> = {
        device_id: latestRecord.device_id,
        display_name: `Motor Device ${latestRecord.device_id}`,
        last_seen_at: recordedAt,
        updated_at: recordedAt,
      };
      if (latestRecord.sensor_status) devUpsert.sensor_status = latestRecord.sensor_status;
      if (latestRecord.wifi_rssi_dbm !== undefined) devUpsert.wifi_rssi_dbm = latestRecord.wifi_rssi_dbm;
      if (latestRecord.sd_card_status) devUpsert.sd_card_status = latestRecord.sd_card_status;
      if (latestRecord.rtc_status) devUpsert.rtc_status = latestRecord.rtc_status;
      if (latestRecord.unsynced_records_count !== undefined) devUpsert.unsynced_records_count = latestRecord.unsynced_records_count;
      if (latestRecord.measured_at) devUpsert.last_measured_at = latestRecord.measured_at;
      if (latestRecord.condition_status) devUpsert.condition_status = latestRecord.condition_status;
      if (latestRecord.condition_reason) devUpsert.condition_reason = latestRecord.condition_reason;
      if (latestRecord.storage_medium) devUpsert.storage_medium = latestRecord.storage_medium;
      if (latestRecord.storage_used_pct !== undefined) devUpsert.storage_used_pct = latestRecord.storage_used_pct;
      if (latestRecord.dropped_records_count !== undefined) devUpsert.dropped_records_count = latestRecord.dropped_records_count;

      await admin.from('devices').upsert(devUpsert, { onConflict: 'device_id' });

      const batchPayloads = records.map((r) => {
        const recTime = r.recorded_at || new Date().toISOString();
        const p: Record<string, unknown> = {
          device_id: r.device_id,
          recorded_at: recTime,
          motor_temp_c: r.motor_temp_c ?? null,
          ambient_temp_c: r.ambient_temp_c ?? null,
          ax_g: r.ax_g ?? null,
          ay_g: r.ay_g ?? null,
          az_g: r.az_g ?? null,
          rms_x_g: r.rms_x_g ?? null,
          rms_y_g: r.rms_y_g ?? null,
          rms_z_g: r.rms_z_g ?? null,
          firmware_version: r.firmware_version || null,
          sample_count: r.sample_count ?? null,
          acquisition_quality: r.acquisition_quality ?? null,
        };
        if (r.record_id) p.record_id = r.record_id;
        if (r.measured_at) p.measured_at = r.measured_at;
        if (r.wifi_rssi_dbm !== undefined) p.wifi_rssi_dbm = r.wifi_rssi_dbm;
        if (r.sensor_status) p.sensor_status = r.sensor_status;
        if (r.i2c_errors !== undefined) p.i2c_errors = r.i2c_errors;
        if (r.missed_sample_slots !== undefined) p.missed_sample_slots = r.missed_sample_slots;
        if (r.sd_card_status) p.sd_card_status = r.sd_card_status;
        if (r.unsynced_records_count !== undefined) p.unsynced_records_count = r.unsynced_records_count;
        if (r.oldest_unsynced_timestamp) p.oldest_unsynced_timestamp = r.oldest_unsynced_timestamp;
        if (r.rtc_status) p.rtc_status = r.rtc_status;
        if (r.rtc_synced !== undefined) p.rtc_synced = r.rtc_synced;
        if (r.condition_status) p.condition_status = r.condition_status;
        if (r.condition_reason) p.condition_reason = r.condition_reason;
        if (r.storage_medium) p.storage_medium = r.storage_medium;
        if (r.storage_used_pct !== undefined) p.storage_used_pct = r.storage_used_pct;
        if (r.dropped_records_count !== undefined) p.dropped_records_count = r.dropped_records_count;
        return p;
      });

      const { data, error } = await admin
        .from('telemetry')
        .upsert(batchPayloads, { onConflict: 'record_id', ignoreDuplicates: true })
        .select();

      if (!error && data && data.length > 0) {
        return data as TelemetryRecord[];
      }
    } catch (e) {
      console.warn(`[BATCH_UPSERT_FALLBACK] Error in batch upsert: ${e}. Inserting individually.`);
    }
  }

  const inserted: TelemetryRecord[] = [];
  for (const r of records) {
    const item = await insertTelemetry(r);
    inserted.push(item);
  }
  return inserted;
}

/**
 * Evaluates storage quotas and triggers step-by-step FIFO pruning if 400 MB general quota is exceeded.
 */
export async function pruneCloudStorageIfExceeded(): Promise<{ pruned: boolean; message: string }> {
  const admin = getAdminClient();
  if (!admin) return { pruned: false, message: 'Admin client not available' };

  try {
    const { data, error } = await admin.rpc('prune_telemetry_within_budget', { target_max_mb: 400.0, batch_size: 5000 });
    if (!error && data) {
      return { pruned: true, message: `Pruned telemetry: ${JSON.stringify(data)}` };
    }
  } catch {
    // If stored procedure not yet executed on remote DB, fallback to row count check
    try {
      const { count } = await admin.from('telemetry').select('id', { count: 'exact', head: true });
      if (count && count > 500000) {
        const { data: oldest } = await admin
          .from('telemetry')
          .select('id')
          .order('recorded_at', { ascending: true })
          .limit(5000);
        if (oldest && oldest.length > 0) {
          const ids = oldest.map((r: { id: number }) => r.id);
          await admin.from('telemetry').delete().in('id', ids);
          return { pruned: true, message: `Pruned oldest ${ids.length} rows step-by-step to protect 400 MB quota` };
        }
      }
    } catch {
      // Ignore
    }
  }
  return { pruned: false, message: 'Storage within quota limits' };
}

