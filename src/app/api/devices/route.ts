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
          const reportingIntervalSec = (config?.reporting_interval_ms ?? 1000) / 1000;
          const gracePeriodSec = Math.max(10, reportingIntervalSec * 3);
          isOnline = ageSeconds <= gracePeriodSec;
          isStale = ageSeconds > gracePeriodSec;
        }

        return {
          device: dev,
          latest,
          config,
          ack,
          is_online: isOnline,
          is_stale: isStale,
          age_seconds: ageSeconds,
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
