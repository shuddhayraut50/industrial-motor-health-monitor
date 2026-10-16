import { NextRequest, NextResponse } from 'next/server';
import { getLiveTelemetry, getDevice, getDeviceConfig } from '@/lib/supabase/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('device_id') || 'motor-monitor-001';
    const windowSeconds = parseInt(searchParams.get('window') || '300', 10); // default 5 min

    const [device, records, config] = await Promise.all([
      getDevice(deviceId),
      getLiveTelemetry(deviceId, windowSeconds),
      getDeviceConfig(deviceId),
    ]);

    const latest = records.length > 0 ? records[records.length - 1] : null;

    let isOnline = false;
    let isStale = true;
    let ageSeconds: number | null = null;

    if (latest) {
      const nowMs = Date.now();
      const recMs = new Date(latest.recorded_at).getTime();
      ageSeconds = Math.max(0, Math.round((nowMs - recMs) / 1000));

      const reportingIntervalSec = (config?.reporting_interval_ms ?? 1000) / 1000;
      // Online if data received within 3x reporting interval or at least within 10s
      const gracePeriodSec = Math.max(10, reportingIntervalSec * 3);
      isOnline = ageSeconds <= gracePeriodSec;
      isStale = ageSeconds > gracePeriodSec;
    }

    // Independent sensor health statuses
    const sensorHealth = {
      esp32: isOnline ? (isStale ? 'stale' : 'online') : 'offline',
      wifi: isOnline
        ? { status: 'connected', rssi_dbm: latest?.wifi_rssi_dbm ?? device?.wifi_rssi_dbm ?? null }
        : { status: 'offline', rssi_dbm: null },
      adxl345: !isOnline
        ? 'no_data'
        : latest?.sensor_status?.adxl345 ?? (latest?.rms_z_g !== null && latest?.rms_z_g !== undefined ? 'ready' : 'not_detected'),
      motor_temp: !isOnline
        ? 'no_data'
        : latest?.sensor_status?.motor_temp ?? (latest?.motor_temp_c !== null && latest?.motor_temp_c !== undefined ? 'ready' : 'not_detected'),
      ambient_temp: !isOnline
        ? 'no_data'
        : latest?.sensor_status?.ambient_temp ?? (latest?.ambient_temp_c !== null && latest?.ambient_temp_c !== undefined ? 'ready' : 'not_detected'),
    };

    return NextResponse.json(
      {
        device,
        latest,
        is_online: isOnline,
        is_stale: isStale,
        age_seconds: ageSeconds,
        sensor_health: sensorHealth,
        last_successful_telemetry: latest?.recorded_at ?? device?.last_seen_at ?? null,
        reporting_interval_ms: config?.reporting_interval_ms ?? 1000,
        config_version: config?.config_version ?? 1,
        count: records.length,
        records,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to query live telemetry';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
