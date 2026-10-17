import { NextRequest, NextResponse } from 'next/server';
import { TelemetryPayloadSchema } from '@/lib/validation/telemetry';
import { verifyDeviceAuth, redactSecrets } from '@/lib/security/auth';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import { insertTelemetry } from '@/lib/supabase/db';

export async function POST(request: NextRequest) {
  try {
    // 1. Device Authentication check
    const authResult = verifyDeviceAuth(request.headers);
    if (!authResult.authorized) {
      console.warn(`[INGEST_AUTH_FAILURE] ${authResult.reason}`);
      return NextResponse.json(
        { error: 'Unauthorized', message: authResult.reason || 'Authentication failed' },
        { status: 401 }
      );
    }

    // 2. Request body size check (max 16 KB for IoT telemetry)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 16384) {
      return NextResponse.json(
        { error: 'Payload Too Large', message: 'Payload exceeds 16KB limit' },
        { status: 413 }
      );
    }

    // 3. JSON Parsing
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON', message: 'Failed to parse JSON body' },
        { status: 400 }
      );
    }

    // 4. Schema validation
    const parseResult = TelemetryPayloadSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const issueMessages = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Validation Error', details: issueMessages },
        { status: 400 }
      );
    }

    const payload = parseResult.data;

    // 5. Rate limiting per device
    const rateCheck = checkRateLimit(payload.device_id, {
      windowMs: 10000,
      maxRequests: 30, // 3 requests/sec max
    });

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Rate Limit Exceeded',
          message: 'Too many telemetry packets received. Please observe configured reporting interval.',
          retry_after_ms: rateCheck.resetInMs,
        },
        { status: 429 }
      );
    }

    // 6. Generate trusted server-side timestamp
    const authoritativeRecordedAt = new Date().toISOString();

    // 7. Persist to database
    const savedRecord = await insertTelemetry({
      ...payload,
      recorded_at: authoritativeRecordedAt,
    });

    // Redacted structured logging for telemetry ingestion
    console.log(
      JSON.stringify({
        event: 'telemetry_ingested',
        device_id: payload.device_id,
        record_id: payload.record_id || savedRecord.id,
        recorded_at: authoritativeRecordedAt,
        measured_at: payload.measured_at ?? null,
        motor_temp: payload.motor_temp_c ?? null,
        ambient_temp: payload.ambient_temp_c ?? null,
        rms_z: payload.rms_z_g ?? null,
        sensor_status: payload.sensor_status ?? null,
        wifi_rssi: payload.wifi_rssi_dbm ?? null,
        sd_card: payload.sd_card_status ?? null,
        rtc: payload.rtc_status ?? null,
        unsynced_count: payload.unsynced_records_count ?? 0,
      })
    );

    return NextResponse.json(
      {
        success: true,
        device_id: savedRecord.device_id,
        recorded_at: savedRecord.recorded_at,
        measured_at: savedRecord.measured_at ?? null,
        record_id: savedRecord.record_id ?? null,
        id: savedRecord.id,
        sensor_status: savedRecord.sensor_status ?? null,
        sd_card_status: savedRecord.sd_card_status ?? null,
        rtc_status: savedRecord.rtc_status ?? null,
      },
      {
        status: 201,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('[INGEST_ERROR]', redactSecrets({ message: errorMsg }));
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'An unexpected error occurred while processing telemetry' },
      { status: 500 }
    );
  }
}

// Telemetry ingestion is strictly POST-only
export async function GET() {
  return NextResponse.json(
    {
      error: 'Method Not Allowed',
      message: 'Telemetry ingestion endpoint accepts only HTTP POST requests with header x-device-token',
    },
    {
      status: 405,
      headers: {
        Allow: 'POST, OPTIONS',
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-device-token, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
