import { test, expect } from '@playwright/test';

test.describe('API Security, Ingestion Validation, and Config Synchronization', () => {
  const VALID_TOKEN = process.env.DEVICE_INGEST_TOKEN || 'test_device_token_e2e_local';

  test('Case 7: Rejection of invalid payloads (physical range & non-finite numbers)', async ({ request }) => {
    // 1. Extreme temperature (>180 C)
    const tooHotRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: 'motor-monitor-001',
        motor_temp_c: 350.0,
        ambient_temp_c: 25.0,
        ax_g: 0.05,
        ay_g: -0.05,
        az_g: 0.98,
        rms_x_g: 0.01,
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
    });
    expect(tooHotRes.status()).toBe(400);
    const hotBody = await tooHotRes.json();
    expect(hotBody.error).toBe('Validation Error');

    // 2. Negative RMS vibration
    const negRmsRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: 'motor-monitor-001',
        motor_temp_c: 45.0,
        ambient_temp_c: 25.0,
        ax_g: 0.05,
        ay_g: -0.05,
        az_g: 0.98,
        rms_x_g: -0.05, // invalid negative RMS
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
    });
    expect(negRmsRes.status()).toBe(400);

    // 3. Out of scale acceleration (>16g for ADXL345)
    const outOfScaleRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: 'motor-monitor-001',
        motor_temp_c: 45.0,
        ambient_temp_c: 25.0,
        ax_g: 25.0, // > 16g
        ay_g: -0.05,
        az_g: 0.98,
        rms_x_g: 0.01,
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
    });
    expect(outOfScaleRes.status()).toBe(400);
  });

  test('Case 8: Rejection of missing or invalid device ingestion token', async ({ request }) => {
    // Missing token
    const noTokenRes = await request.post('/api/telemetry', {
      data: {
        device_id: 'motor-monitor-001',
        motor_temp_c: 35.0,
        ambient_temp_c: 25.0,
        ax_g: 0.05,
        ay_g: -0.05,
        az_g: 0.98,
        rms_x_g: 0.01,
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
    });
    expect(noTokenRes.status()).toBe(401);

    // Bad token
    const badTokenRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': 'wrong_spoofed_device_token' },
      data: {
        device_id: 'motor-monitor-001',
        motor_temp_c: 35.0,
        ambient_temp_c: 25.0,
        ax_g: 0.05,
        ay_g: -0.05,
        az_g: 0.98,
        rms_x_g: 0.01,
        rms_y_g: 0.01,
        rms_z_g: 0.01,
      },
    });
    expect(badTokenRes.status()).toBe(401);
  });

  test('Case 9: Successful ingestion with valid token & server timestamping', async ({ request }) => {
    const ingestRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: 'motor-monitor-001',
        motor_temp_c: 48.25,
        ambient_temp_c: 26.50,
        ax_g: 0.035,
        ay_g: -0.082,
        az_g: 0.965,
        rms_x_g: 0.0075,
        rms_y_g: 0.0085,
        rms_z_g: 0.0115,
        firmware_version: 'v1.0.0-esp32s3',
      },
    });

    expect(ingestRes.status()).toBe(201);
    const body = await ingestRes.json();
    expect(body.success).toBe(true);
    expect(body.device_id).toBe('motor-monitor-001');
    expect(body.recorded_at).toBeDefined();
  });

  test('Case 10: Configuration versioning, retrieval, and hardware acknowledgment', async ({ request }) => {
    // 1. Operator updates config version
    const updateRes = await request.post('/api/device/config', {
      data: {
        device_id: 'motor-monitor-001',
        reporting_interval_ms: 2000,
        enabled_fields: ['motor_temp_c', 'ambient_temp_c', 'rms_z_g'],
        configuration_json: { notes: 'Automated test config update' },
      },
    });
    expect(updateRes.status()).toBe(200);
    const updateBody = await updateRes.json();
    const newVersion = updateBody.config.config_version;
    expect(newVersion).toBeGreaterThanOrEqual(2);

    // 2. ESP32 fetches its updated configuration over HTTPS using its device token
    const fetchRes = await request.get(`/api/device/config?device_id=motor-monitor-001`, {
      headers: { 'x-device-token': VALID_TOKEN },
    });
    expect(fetchRes.status()).toBe(200);
    const fetchBody = await fetchRes.json();
    expect(fetchBody.config.reporting_interval_ms).toBe(2000);

    // 3. ESP32 acknowledges the new version
    const ackRes = await request.post('/api/device/config/ack', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: 'motor-monitor-001',
        acknowledged_config_version: newVersion,
        firmware_version: 'v1.0.0-esp32s3',
        status: 'acknowledged',
      },
    });
    expect(ackRes.status()).toBe(200);
    const ackBody = await ackRes.json();
    expect(ackBody.success).toBe(true);
    expect(ackBody.ack.acknowledged_config_version).toBe(newVersion);
  });

  test('Case 12: API method restriction and payload size limits', async ({ request }) => {
    // 1. Method Not Allowed on GET /api/telemetry
    const getRes = await request.get('/api/telemetry');
    expect(getRes.status()).toBe(405);

    // 2. Payload size excess rejection (>16KB)
    const giantPayload = {
      device_id: 'motor-monitor-001',
      motor_temp_c: 35.0,
      ambient_temp_c: 25.0,
      ax_g: 0.05,
      ay_g: -0.05,
      az_g: 0.98,
      rms_x_g: 0.01,
      rms_y_g: 0.01,
      rms_z_g: 0.01,
      extra_junk: 'A'.repeat(20000), // >16KB
    };

    const oversizedRes = await request.post('/api/telemetry', {
      headers: {
        'x-device-token': VALID_TOKEN,
        'Content-Type': 'application/json',
      },
      data: giantPayload,
    });
    expect(oversizedRes.status()).toBe(413);
  });
});
