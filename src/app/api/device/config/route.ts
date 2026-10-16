import { NextRequest, NextResponse } from 'next/server';
import { getDeviceConfig, updateDeviceConfig, getLatestDeviceAck } from '@/lib/supabase/db';
import { DeviceConfigUpdateSchema } from '@/lib/validation/config';
import { verifyDeviceAuth } from '@/lib/security/auth';

// ESP32 or Dashboard fetches current device configuration
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('device_id');

    if (!deviceId) {
      return NextResponse.json({ error: 'device_id query parameter is required' }, { status: 400 });
    }

    // If caller is an ESP32 hardware device (indicated by presence of token header), authenticate it
    const tokenHeader = request.headers.get('x-device-token') || request.headers.get('authorization');
    if (tokenHeader) {
      const authResult = verifyDeviceAuth(request.headers);
      if (!authResult.authorized) {
        return NextResponse.json({ error: 'Unauthorized', message: authResult.reason }, { status: 401 });
      }
    }

    const [config, latestAck] = await Promise.all([
      getDeviceConfig(deviceId),
      getLatestDeviceAck(deviceId),
    ]);

    if (!config) {
      return NextResponse.json({ error: 'Configuration not found for device' }, { status: 404 });
    }

    const isPending = (latestAck?.acknowledged_config_version ?? 0) < config.config_version;

    return NextResponse.json({
      config,
      latest_ack: latestAck,
      is_pending: isPending,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to retrieve device configuration';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

// Authenticated user updates safe monitoring configuration
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = DeviceConfigUpdateSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation Error', details: parseResult.error.issues.map((i) => i.message) },
        { status: 400 }
      );
    }

    const { device_id, reporting_interval_ms, enabled_fields, configuration_json } = parseResult.data;

    // Safety guardrail: reject any motor control, actuation, relay, or safety-critical commands
    const forbiddenKeys = ['actuate', 'relay', 'motor_speed', 'start_motor', 'stop_motor', 'throttle', 'voltage_control'];
    for (const key of Object.keys(configuration_json || {})) {
      if (forbiddenKeys.includes(key.toLowerCase())) {
        return NextResponse.json(
          {
            error: 'Forbidden Configuration',
            message: `Key "${key}" is forbidden. Motor actuation or safety-critical commands are strictly not supported.`,
          },
          { status: 403 }
        );
      }
    }

    const newConfig = await updateDeviceConfig(
      device_id,
      reporting_interval_ms,
      enabled_fields,
      configuration_json
    );

    return NextResponse.json({
      success: true,
      message: 'Monitoring configuration version updated successfully',
      config: newConfig,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to update device configuration';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
