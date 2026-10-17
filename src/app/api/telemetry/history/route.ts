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
        'record_id',
        'device_id',
        'measured_at',
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
        'sample_count',
        'acquisition_quality',
        'i2c_errors',
        'missed_sample_slots',
        'sd_card_status',
        'rtc_status',
        'firmware_version',
      ];

      const csvRows = [headers.join(',')];

      for (const r of records) {
        const hasBothTemps =
          r.motor_temp_c !== null &&
          r.motor_temp_c !== undefined &&
          r.ambient_temp_c !== null &&
          r.ambient_temp_c !== undefined;
        const diff = hasBothTemps
          ? (Number(r.motor_temp_c) - Number(r.ambient_temp_c)).toFixed(2)
          : '';

        csvRows.push(
          [
            r.id,
            `"${r.record_id || ''}"`,
            `"${r.device_id}"`,
            `"${r.measured_at || r.recorded_at}"`,
            `"${r.recorded_at}"`,
            r.motor_temp_c ?? '',
            r.ambient_temp_c ?? '',
            diff,
            r.ax_g ?? '',
            r.ay_g ?? '',
            r.az_g ?? '',
            r.rms_x_g ?? '',
            r.rms_y_g ?? '',
            r.rms_z_g ?? '',
            r.sample_count ?? '',
            r.acquisition_quality ?? '',
            r.i2c_errors ?? 0,
            r.missed_sample_slots ?? 0,
            `"${r.sd_card_status || 'not_initialized'}"`,
            `"${r.rtc_status || 'not_detected'}"`,
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
