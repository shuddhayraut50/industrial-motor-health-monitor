import { NextRequest, NextResponse } from 'next/server';
import { verifyDeviceAuth } from '@/lib/security/auth';
import { CommandAckSchema } from '@/lib/validation/commands';
import { acknowledgeDeviceCommand } from '@/lib/supabase/db';

export async function POST(request: NextRequest) {
  // 1. Authenticate device request
  const auth = verifyDeviceAuth(request.headers);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: 'Unauthorized', reason: auth.reason },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const parseResult = CommandAckSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const command = await acknowledgeDeviceCommand(parseResult.data);
    if (!command) {
      return NextResponse.json(
        { error: 'Command not found or already completed' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      command,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to acknowledge command';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
