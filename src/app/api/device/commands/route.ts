import { NextRequest, NextResponse } from 'next/server';
import { CreateCommandSchema } from '@/lib/validation/commands';
import { createDeviceCommand, getDeviceCommandsHistory, getDevice, calculateDeviceConnectionStatus } from '@/lib/supabase/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = CreateCommandSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { device_id, command_type, parameters, expires_in_seconds } = parseResult.data;

    // Check device status: offline commands are allowed to be queued, but we clearly indicate status
    const device = await getDevice(device_id);
    const connectionStatus = calculateDeviceConnectionStatus(device);

    const command = await createDeviceCommand(
      {
        device_id,
        command_type,
        parameters: parameters as Record<string, unknown>,
        expires_in_seconds,
      },
      'web_dashboard'
    );

    return NextResponse.json(
      {
        success: true,
        command,
        device_connection_status: connectionStatus,
        message:
          connectionStatus === 'OFFLINE'
            ? 'Command queued successfully. Device is currently OFFLINE and will receive command upon reconnection.'
            : 'Command queued and pending device delivery.',
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to create command';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('device_id') || 'motor-monitor-001';
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const commands = await getDeviceCommandsHistory(deviceId, limit);

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
    const errorMsg = err instanceof Error ? err.message : 'Failed to fetch commands';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
