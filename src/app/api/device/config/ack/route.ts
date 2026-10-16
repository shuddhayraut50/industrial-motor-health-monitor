import { NextRequest, NextResponse } from 'next/server';
import { acknowledgeDeviceConfig } from '@/lib/supabase/db';
import { DeviceConfigAckSchema } from '@/lib/validation/config';
import { verifyDeviceAuth } from '@/lib/security/auth';

export async function POST(request: NextRequest) {
  try {
    // 1. Device authentication required for hardware acknowledgment
    const authResult = verifyDeviceAuth(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: 'Unauthorized', message: authResult.reason }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = DeviceConfigAckSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation Error', details: parseResult.error.issues.map((i) => i.message) },
        { status: 400 }
      );
    }

    const { device_id, acknowledged_config_version, firmware_version } = parseResult.data;

    const ack = await acknowledgeDeviceConfig(
      device_id,
      acknowledged_config_version,
      firmware_version
    );

    return NextResponse.json({
      success: true,
      message: 'Configuration version acknowledged by device',
      ack,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to record device configuration acknowledgment';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
