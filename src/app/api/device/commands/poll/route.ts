import { NextRequest, NextResponse } from 'next/server';
import { verifyDeviceAuth } from '@/lib/security/auth';
import { getPendingDeviceCommands } from '@/lib/supabase/db';

async function handlePoll(request: NextRequest) {
  // 1. Authenticate device request
  const auth = verifyDeviceAuth(request.headers);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: 'Unauthorized', reason: auth.reason },
      { status: 401 }
    );
  }

  try {
    let deviceId = 'motor-monitor-001';
    try {
      const body = await request.json();
      if (body && typeof body.device_id === 'string') {
        deviceId = body.device_id;
      }
    } catch {
      // Body empty or not JSON, check URL query param
      const { searchParams } = new URL(request.url);
      deviceId = searchParams.get('device_id') || deviceId;
    }

    const commands = await getPendingDeviceCommands(deviceId);

    return NextResponse.json(
      {
        device_id: deviceId,
        commands,
        count: commands.length,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to poll commands';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handlePoll(request);
}

export async function GET(request: NextRequest) {
  return handlePoll(request);
}
