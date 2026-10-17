import { NextRequest, NextResponse } from 'next/server';
import { getLiveTelemetry, getDevice, getDeviceConfig, calculateDeviceConnectionStatus } from '@/lib/supabase/db';

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

    // Strict server-side connection status calculation
    const connectionStatus = calculateDeviceConnectionStatus(device);
    const isOnline = connectionStatus === 'ONLINE';
    const isStale = connectionStatus === 'STALE';

    let ageSeconds: number | null = null;
    if (device?.last_seen_at) {
      const nowMs = Date.now();
      const lastSeenMs = new Date(device.last_seen_at).getTime();
      ageSeconds = Math.max(0, Math.round((nowMs - lastSeenMs) / 1000));
    }

    // Condition status from local ESP32 evaluation
    const conditionStatus = latest?.condition_status ?? device?.condition_status ?? 'UNKNOWN';
    const conditionReason = latest?.condition_reason ?? device?.condition_reason ?? 'Initial observation or unconfigured';

    // Storage hierarchy diagnostics
    const storageDiagnostics = {
      medium: latest?.storage_medium ?? device?.storage_medium ?? (latest?.sd_card_status === 'ready' ? 'sd_card' : 'none'),
      used_pct: latest?.storage_used_pct ?? device?.storage_used_pct ?? 0,
      dropped_records_count: latest?.dropped_records_count ?? device?.dropped_records_count ?? 0,
      sd_card_status: latest?.sd_card_status ?? device?.sd_card_status ?? 'not_initialized',
      unsynced_records_count: latest?.unsynced_records_count ?? device?.unsynced_records_count ?? 0,
      oldest_unsynced_timestamp: latest?.oldest_unsynced_timestamp ?? null,
    };

    // Independent sensor health statuses
    const sensorHealth = {
      esp32: isOnline ? (isStale ? 'stale' : 'online') : 'offline',
      wifi: isOnline || isStale
        ? { status: 'connected', rssi_dbm: latest?.wifi_rssi_dbm ?? device?.wifi_rssi_dbm ?? null }
        : { status: 'offline', rssi_dbm: null },
      adxl345: !isOnline && !isStale
        ? 'no_data'
        : latest?.sensor_status?.adxl345 ?? (latest?.rms_z_g !== null && latest?.rms_z_g !== undefined ? 'ready' : 'not_detected'),
      motor_temp: !isOnline && !isStale
        ? 'no_data'
        : latest?.sensor_status?.motor_temp ?? (latest?.motor_temp_c !== null && latest?.motor_temp_c !== undefined ? 'ready' : 'not_detected'),
      ambient_temp: !isOnline && !isStale
        ? 'no_data'
        : latest?.sensor_status?.ambient_temp ?? (latest?.ambient_temp_c !== null && latest?.ambient_temp_c !== undefined ? 'ready' : 'not_detected'),
      sd_card: storageDiagnostics.sd_card_status,
      rtc: {
        status: latest?.rtc_status ?? device?.rtc_status ?? 'not_detected',
        synced: Boolean(latest?.rtc_synced),
      },
      offline_queue: {
        unsynced_count: storageDiagnostics.unsynced_records_count,
        oldest_timestamp: storageDiagnostics.oldest_unsynced_timestamp,
      },
    };

    return NextResponse.json(
      {
        device,
        latest,
        connection_status: connectionStatus,
        is_online: isOnline,
        is_stale: isStale,
        age_seconds: ageSeconds,
        condition_status: conditionStatus,
        condition_reason: conditionReason,
        storage_diagnostics: storageDiagnostics,
        sensor_health: sensorHealth,
        last_successful_telemetry: latest?.recorded_at ?? device?.last_seen_at ?? null,
        last_measured_at: latest?.measured_at ?? device?.last_measured_at ?? null,
        reporting_interval_ms: config?.reporting_interval_ms ?? 5000,
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
    return NextResponse.json(
      {
        error: errorMsg,
        connection_status: 'API_ERROR',
        is_online: false,
        is_stale: false,
      },
      { status: 500 }
    );
  }
}
