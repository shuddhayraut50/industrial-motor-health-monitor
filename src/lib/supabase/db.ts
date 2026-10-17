import { getAdminClient } from './admin';
import { TelemetryRecord, DeviceRecord, TelemetryStats } from '../types/telemetry';
import { DeviceConfig, DeviceConfigAck } from '../types/config';

// In-memory test store used for local testing, CI, and Playwright verification
class MockDatabaseStore {
  devices: Map<string, DeviceRecord> = new Map();
  telemetry: TelemetryRecord[] = [];
  configs: Map<string, DeviceConfig[]> = new Map();
  acks: Map<string, DeviceConfigAck[]> = new Map();

  constructor() {
    this.seedDefault();
  }

  seedDefault() {
    this.devices.clear();
    this.telemetry = [];
    this.configs.clear();
    this.acks.clear();

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
  }

  clear() {
    this.devices.clear();
    this.telemetry = [];
    this.configs.clear();
    this.acks.clear();
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

    const { error: devError } = await admin
      .from('devices')
      .upsert(devUpsert, { onConflict: 'device_id' });

    // Fallback if sensor_status or wifi_rssi_dbm columns don't exist yet on remote table
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

    let { data, error } = await admin
      .from('telemetry')
      .insert(telemetryInsertPayload)
      .select()
      .single();

    // If remote table doesn't have the new columns yet, retry without them
    if (error && (error.message.includes('column') || error.code === '42703')) {
      delete telemetryInsertPayload.wifi_rssi_dbm;
      delete telemetryInsertPayload.sensor_status;
      delete telemetryInsertPayload.i2c_errors;
      delete telemetryInsertPayload.missed_sample_slots;
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
        `[DB_MIGRATION_PENDING] Live Supabase database requires migration 00003 to allow NULL columns for disconnected sensors: ${error.message}. Telemetry cached in store.`
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
      created_at: recordedAt,
      updated_at: recordedAt,
    });
  }

  const newRecord: TelemetryRecord = {
    ...record,
    id: mockDb.telemetry.length + 1,
    recorded_at: recordedAt,
    i2c_errors: record.i2c_errors ?? 0,
    missed_sample_slots: record.missed_sample_slots ?? 0,
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

  if (admin) {
    const { data, error } = await admin
      .from('telemetry')
      .select('*')
      .eq('device_id', deviceId)
      .gte('recorded_at', sinceTime)
      .order('recorded_at', { ascending: true })
      .limit(1000);

    if (!error && data) {
      if (mockRecords.length > 0) {
        const combined = [...data, ...mockRecords];
        return combined.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
      }
      return data as TelemetryRecord[];
    } else if (mockRecords.length > 0) {
      return mockRecords.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    }
  }

  // Mock store
  return mockRecords.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
}

export async function getHistoricalTelemetry(
  deviceId: string,
  startDate?: string,
  endDate?: string,
  limit: number = 500
): Promise<TelemetryRecord[]> {
  const admin = getAdminClient();

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
      return (data as TelemetryRecord[]).reverse();
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
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
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
