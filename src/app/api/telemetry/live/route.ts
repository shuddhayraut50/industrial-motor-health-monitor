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

    // Use most authoritative last seen timestamp between device.last_seen_at and latest telemetry
    const deviceLastSeenMs = device?.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
    const latestTelemetryMs = latest?.recorded_at ? new Date(latest.recorded_at).getTime() : 0;
    const authoritativeLastSeenMs = Math.max(deviceLastSeenMs, latestTelemetryMs);
    const authoritativeLastSeenIso = authoritativeLastSeenMs > 0 ? new Date(authoritativeLastSeenMs).toISOString() : null;

    const effectiveDevice = device
      ? { ...device, last_seen_at: authoritativeLastSeenIso ?? device.last_seen_at }
      : (authoritativeLastSeenIso
        ? {
            id: `dev-${deviceId}`,
            device_id: deviceId,
            display_name: deviceId,
            location: 'Field',
            enabled: true,
            last_seen_at: authoritativeLastSeenIso,
            created_at: authoritativeLastSeenIso,
            updated_at: authoritativeLastSeenIso,
          }
        : null);

    // Strict server-side connection status calculation
    const connectionStatus = calculateDeviceConnectionStatus(effectiveDevice);
    const isOnline = connectionStatus === 'ONLINE';
    const isStale = connectionStatus === 'STALE';

    let ageSeconds: number | null = null;
    if (authoritativeLastSeenIso) {
      const nowMs = Date.now();
      ageSeconds = Math.max(0, Math.round((nowMs - authoritativeLastSeenMs) / 1000));
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

    // Validate RSSI: Standard 2.4GHz Wi-Fi RSSI is between -100 and -15 dBm.
    // Suspicious or invalid values (e.g. >= 0, < -110) are flagged.
    const rawRssi = latest?.wifi_rssi_dbm ?? device?.wifi_rssi_dbm ?? null;
    const isValidRssi = rawRssi !== null && rawRssi >= -105 && rawRssi <= -10;
    const sanitizedRssi = isValidRssi ? rawRssi : null;

    // Independent sensor health statuses
    const effectiveSensorStatus = latest?.sensor_status ?? device?.sensor_status ?? null;
    const hasLatestAdxl = latest?.rms_z_g !== null && latest?.rms_z_g !== undefined;
    const hasLatestMotor = latest?.motor_temp_c !== null && latest?.motor_temp_c !== undefined;
    const hasLatestAmbient = latest?.ambient_temp_c !== null && latest?.ambient_temp_c !== undefined;

    const sensorHealth = {
      esp32: isOnline ? 'online' : (isStale ? 'stale' : 'offline'),
      wifi: isOnline
        ? { status: 'connected', rssi_dbm: sanitizedRssi, raw_rssi: rawRssi, ingest_state: 'active' }
        : isStale
        ? { status: 'connected', rssi_dbm: sanitizedRssi, raw_rssi: rawRssi, ingest_state: 'delayed' }
        : { status: 'offline', rssi_dbm: null, raw_rssi: null, ingest_state: 'none' },
      adxl345: !isOnline && !isStale
        ? 'no_data'
        : isStale
        ? (effectiveSensorStatus?.adxl345 === 'ready' || hasLatestAdxl ? 'cached' : effectiveSensorStatus?.adxl345 ?? 'not_detected')
        : (effectiveSensorStatus?.adxl345 ?? (hasLatestAdxl ? 'ready' : 'not_detected')),
      motor_temp: !isOnline && !isStale
        ? 'no_data'
        : isStale
        ? (effectiveSensorStatus?.motor_temp === 'ready' || hasLatestMotor ? 'cached' : effectiveSensorStatus?.motor_temp ?? 'not_detected')
        : (effectiveSensorStatus?.motor_temp ?? (hasLatestMotor ? 'ready' : 'not_detected')),
      ambient_temp: !isOnline && !isStale
        ? 'no_data'
        : isStale
        ? (effectiveSensorStatus?.ambient_temp === 'ready' || hasLatestAmbient ? 'cached' : effectiveSensorStatus?.ambient_temp ?? 'not_detected')
        : (effectiveSensorStatus?.ambient_temp ?? (hasLatestAmbient ? 'ready' : 'not_detected')),
      sd_card: storageDiagnostics.sd_card_status,
      storage_medium: storageDiagnostics.medium,
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
