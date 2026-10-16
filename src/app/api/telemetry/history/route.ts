import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalTelemetry, computeStats } from '@/lib/supabase/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('device_id') || 'motor-monitor-001';
    const startDate = searchParams.get('start') || undefined;
    const endDate = searchParams.get('end') || undefined;
    const limit = parseInt(searchParams.get('limit') || '500', 10);
    const format = searchParams.get('format'); // 'csv' or 'json'

    const records = await getHistoricalTelemetry(deviceId, startDate, endDate, Math.min(limit, 5000));
    const stats = computeStats(records);

    if (format === 'csv') {
      const headers = [
        'id',
        'device_id',
        'recorded_at',
        'motor_temp_c',
        'ambient_temp_c',
        'temp_diff_c',
        'ax_g',
        'ay_g',
        'az_g',
        'rms_x_g',
        'rms_y_g',
        'rms_z_g',
        'firmware_version',
      ];

      const csvRows = [headers.join(',')];

      for (const r of records) {
        const diff = (Number(r.motor_temp_c) - Number(r.ambient_temp_c)).toFixed(2);
        csvRows.push(
          [
            r.id,
            `"${r.device_id}"`,
            `"${r.recorded_at}"`,
            r.motor_temp_c,
            r.ambient_temp_c,
            diff,
            r.ax_g,
            r.ay_g,
            r.az_g,
            r.rms_x_g,
            r.rms_y_g,
            r.rms_z_g,
            `"${r.firmware_version || 'unknown'}"`,
          ].join(',')
        );
      }

      const csvContent = csvRows.join('\r\n');
      const filename = `motor_telemetry_${deviceId}_${Date.now()}.csv`;

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json({
      device_id: deviceId,
      start_date: startDate ?? null,
      end_date: endDate ?? null,
      sample_count: records.length,
      stats,
      records,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to query historical telemetry';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
