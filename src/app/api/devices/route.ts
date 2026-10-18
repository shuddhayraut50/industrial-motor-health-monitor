import { NextResponse } from 'next/server';
import { getDevices, getLiveTelemetry, getDeviceConfig, getLatestDeviceAck } from '@/lib/supabase/db';

export async function GET() {
  try {
    const devices = await getDevices();

    const enriched = await Promise.all(
      devices.map(async (dev) => {
        const [liveRecords, config, ack] = await Promise.all([
          getLiveTelemetry(dev.device_id, 300),
          getDeviceConfig(dev.device_id),
          getLatestDeviceAck(dev.device_id),
        ]);

        const latest = liveRecords.length > 0 ? liveRecords[liveRecords.length - 1] : null;
        let isOnline = false;
        let isStale = true;
        let ageSeconds: number | null = null;

        if (latest) {
          const nowMs = Date.now();
          const recMs = new Date(latest.recorded_at).getTime();
          ageSeconds = Math.max(0, Math.round((nowMs - recMs) / 1000));
          const reportingIntervalSec = (config?.reporting_interval_ms ?? 5000) / 1000;
          const gracePeriodSec = Math.max(25, reportingIntervalSec * 5);
          const stalePeriodSec = 120;
          isOnline = ageSeconds <= gracePeriodSec;
          isStale = ageSeconds > gracePeriodSec && ageSeconds <= stalePeriodSec;
        }

        const effectiveSensorStatus = latest?.sensor_status ?? dev?.sensor_status ?? null;
        const hasLatestAdxl = latest?.rms_z_g !== null && latest?.rms_z_g !== undefined;
        const hasLatestMotor = latest?.motor_temp_c !== null && latest?.motor_temp_c !== undefined;
        const hasLatestAmbient = latest?.ambient_temp_c !== null && latest?.ambient_temp_c !== undefined;

        const sensorHealth = {
          esp32: isOnline ? 'online' : (isStale ? 'stale' : 'offline'),
          wifi: isOnline || isStale
            ? { status: 'connected', rssi_dbm: latest?.wifi_rssi_dbm ?? dev?.wifi_rssi_dbm ?? null }
            : { status: 'offline', rssi_dbm: null },
          adxl345: !isOnline && !isStale
            ? 'no_data'
            : (effectiveSensorStatus?.adxl345 ?? (hasLatestAdxl ? 'ready' : 'not_detected')),
          motor_temp: !isOnline && !isStale
            ? 'no_data'
            : (effectiveSensorStatus?.motor_temp ?? (hasLatestMotor ? 'ready' : 'not_detected')),
          ambient_temp: !isOnline && !isStale
            ? 'no_data'
            : (effectiveSensorStatus?.ambient_temp ?? (hasLatestAmbient ? 'ready' : 'not_detected')),
          sd_card: latest?.sd_card_status ?? dev?.sd_card_status ?? 'missing',
          rtc: latest?.rtc_status ?? dev?.rtc_status ?? 'not_detected',
          rtc_synced: latest?.rtc_synced ?? false,
        };

        const storageDiagnostics = {
          sd_card: {
            status: latest?.sd_card_status ?? dev?.sd_card_status ?? 'missing',
            medium: latest?.storage_medium ?? 'none',
          },
          littlefs: {
            status: latest?.storage_medium === 'flash_littlefs' || (latest?.storage_used_pct !== null && latest?.storage_used_pct !== undefined)
              ? 'active_fallback'
              : 'ready',
            used_pct: latest?.storage_used_pct ?? 0,
          },
          queue: {
            unsynced_count: latest?.unsynced_records_count ?? dev?.unsynced_records_count ?? 0,
            oldest_pending: latest?.oldest_unsynced_timestamp ?? null,
            dropped_count: latest?.dropped_records_count ?? 0,
          },
        };

        return {
          device: dev,
          latest,
          config,
          ack,
          is_online: isOnline,
          is_stale: isStale,
          age_seconds: ageSeconds,
          sensor_health: sensorHealth,
          storage_diagnostics: storageDiagnostics,
          last_successful_telemetry: latest?.recorded_at ?? dev?.last_seen_at ?? null,
        };
      })
    );

    return NextResponse.json(
      { devices: enriched },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to query devices';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
