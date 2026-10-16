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

    return NextResponse.json(
      {
        device,
        latest,
        is_online: isOnline,
        is_stale: isStale,
        age_seconds: ageSeconds,
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
