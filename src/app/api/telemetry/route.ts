import { NextRequest, NextResponse } from 'next/server';
import { TelemetryPayloadSchema, TelemetryBatchPayloadSchema, ValidatedTelemetryPayload } from '@/lib/validation/telemetry';
import { verifyDeviceAuth, redactSecrets } from '@/lib/security/auth';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import { insertTelemetry, insertTelemetryBatch, pruneCloudStorageIfExceeded } from '@/lib/supabase/db';

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

    // 2. Request body size check (max 128 KB to support opportunistic batch flushes)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 131072) {
      return NextResponse.json(
        { error: 'Payload Too Large', message: 'Payload exceeds 128KB limit' },
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

    // 4. Schema validation (supports single record or batch array)
    const isArray = Array.isArray(rawBody);
    const parseResult = TelemetryBatchPayloadSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const issueMessages = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      console.warn(`[TELEMETRY_VALIDATION_ERROR]`, issueMessages);
      return NextResponse.json(
        { error: 'Validation Error', details: issueMessages },
        { status: 400 }
      );
    }

    const payloads: ValidatedTelemetryPayload[] = isArray
      ? (parseResult.data as ValidatedTelemetryPayload[])
      : [parseResult.data as ValidatedTelemetryPayload];

    const primaryDeviceId = payloads[0].device_id;

    // 5. Rate limiting per device (accommodates batches)
    const rateCheck = checkRateLimit(primaryDeviceId, {
      windowMs: 10000,
      maxRequests: 60, // accommodate batch bursts
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

    // 6. Generate server-side timestamps
    const authoritativeRecordedAt = new Date().toISOString();

    // 7. Persist to database (batch or single)
    const recordsToInsert = payloads.map((p, idx) => ({
      ...p,
      sensor_status: p.sensor_status || undefined,
      recorded_at: isArray
        ? new Date(Date.now() - (payloads.length - 1 - idx) * 1000).toISOString()
        : authoritativeRecordedAt,
    }));

    const savedRecords = await insertTelemetryBatch(recordsToInsert);
    const latestSaved = savedRecords[savedRecords.length - 1];

    // Asynchronously trigger 400 MB storage quota retention check in background
    pruneCloudStorageIfExceeded().catch(() => {});

    // Redacted structured logging for telemetry ingestion
    console.log(
      JSON.stringify({
        event: 'telemetry_ingested',
        batch_size: payloads.length,
        device_id: primaryDeviceId,
        record_id: latestSaved.record_id || latestSaved.id,
        recorded_at: latestSaved.recorded_at,
        measured_at: latestSaved.measured_at ?? null,
        motor_temp: latestSaved.motor_temp_c ?? null,
        ambient_temp: latestSaved.ambient_temp_c ?? null,
        rms_z: latestSaved.rms_z_g ?? null,
        sensor_status: latestSaved.sensor_status ?? null,
        wifi_rssi: latestSaved.wifi_rssi_dbm ?? null,
        sd_card: latestSaved.sd_card_status ?? null,
        rtc: latestSaved.rtc_status ?? null,
        unsynced_count: latestSaved.unsynced_records_count ?? 0,
      })
    );

    return NextResponse.json(
      {
        success: true,
        batch_count: savedRecords.length,
        device_id: latestSaved.device_id,
        recorded_at: latestSaved.recorded_at,
        measured_at: latestSaved.measured_at ?? null,
        record_id: latestSaved.record_id ?? null,
        id: latestSaved.id,
        sensor_status: latestSaved.sensor_status ?? null,
        sd_card_status: latestSaved.sd_card_status ?? null,
        rtc_status: latestSaved.rtc_status ?? null,
        condition_status: latestSaved.condition_status ?? null,
        condition_reason: latestSaved.condition_reason ?? null,
        storage_medium: latestSaved.storage_medium ?? null,
        storage_used_pct: latestSaved.storage_used_pct ?? null,
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
