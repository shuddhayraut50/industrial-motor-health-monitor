import { NextRequest, NextResponse } from 'next/server';
import { IngestDiagnosticEventsPayloadSchema } from '@/lib/validation/events';
import { verifyDeviceAuth, redactSecrets } from '@/lib/security/auth';
import {
  insertDiagnosticEventsBatch,
  getDeviceDiagnosticEvents,
  getDevice,
  calculateDeviceConnectionStatus,
} from '@/lib/supabase/db';
import { getAdminClient } from '@/lib/supabase/admin';
import { DeviceDiagnosticEvent, DiagnosticComponent, DiagnosticSeverity } from '@/lib/types/events';

export async function POST(request: NextRequest) {
  try {
    // 1. Device Authentication check
    const authResult = verifyDeviceAuth(request.headers);
    if (!authResult.authorized) {
      console.warn(`[EVENT_INGEST_AUTH_FAILURE] ${authResult.reason}`);
      return NextResponse.json(
        { error: 'Unauthorized', message: authResult.reason || 'Authentication failed' },
        { status: 401 }
      );
    }

    // 2. Request body size check (max 64 KB for batch event log payloads)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 65536) {
      return NextResponse.json(
        { error: 'Payload Too Large', message: 'Payload exceeds 64KB limit' },
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
    const parseResult = IngestDiagnosticEventsPayloadSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const issueMessages = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Validation Error', details: issueMessages },
        { status: 400 }
      );
    }

    // Normalize into array of events
    const rawData = parseResult.data;
    let eventsToProcess: DeviceDiagnosticEvent[] = [];

    if (Array.isArray(rawData)) {
      eventsToProcess = rawData as DeviceDiagnosticEvent[];
    } else if ('events' in rawData && Array.isArray(rawData.events)) {
      eventsToProcess = rawData.events as DeviceDiagnosticEvent[];
    } else {
      eventsToProcess = [rawData as DeviceDiagnosticEvent];
    }

    if (eventsToProcess.length === 0) {
      return NextResponse.json(
        { error: 'Empty payload', message: 'No events provided' },
        { status: 400 }
      );
    }

    // Redact any potential secrets from details
    const sanitizedEvents: DeviceDiagnosticEvent[] = eventsToProcess.map((ev) => ({
      ...ev,
      details: ev.details ? (redactSecrets(ev.details) as Record<string, unknown>) : null,
      server_received_at: new Date().toISOString(),
    }));

    // 5. Insert events idempotently
    const { inserted, skipped } = await insertDiagnosticEventsBatch(sanitizedEvents);

    // 6. Update device's last_seen_at because authentic communication was received
    const primaryDeviceId = sanitizedEvents[0].device_id;
    const nowIso = new Date().toISOString();

    const admin = getAdminClient();
    if (admin) {
      try {
        await admin
          .from('devices')
          .update({ last_seen_at: nowIso, updated_at: nowIso })
          .eq('device_id', primaryDeviceId);
      } catch (err) {
        console.warn(`[DEVICE_LAST_SEEN_UPDATE_FAILED] ${err}`);
      }
    }

    return NextResponse.json(
      {
        success: true,
        device_id: primaryDeviceId,
        count: sanitizedEvents.length,
        inserted,
        skipped,
        server_received_at: nowIso,
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
    console.error('[EVENT_INGEST_ERROR]', redactSecrets({ message: errorMsg }));
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'An unexpected error occurred while processing diagnostic events' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('device_id') || 'motor-monitor-001';
    const component = (searchParams.get('component') || 'all') as DiagnosticComponent | 'all';
    const severity = (searchParams.get('severity') || 'all') as DiagnosticSeverity | 'all';
    const unresolvedOnly = searchParams.get('unresolved_only') === 'true';
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    const events = await getDeviceDiagnosticEvents({
      deviceId,
      component,
      severity,
      unresolvedOnly,
      limit,
      offset,
    });

    const device = await getDevice(deviceId);
    const connectionStatus = calculateDeviceConnectionStatus(device);

    return NextResponse.json(
      {
        success: true,
        device_id: deviceId,
        device_connection_status: connectionStatus,
        count: events.length,
        limit,
        offset,
        events,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to query diagnostic events';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-device-token, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
