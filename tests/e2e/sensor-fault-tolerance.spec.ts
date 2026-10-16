import { test, expect } from '@playwright/test';

test.describe('Independent Sensor Health & Fault-Tolerant Telemetry E2E', () => {
  const VALID_TOKEN = process.env.DEVICE_INGEST_TOKEN || 'test_device_token_e2e_local';
  const TEST_DEVICE_ID = 'motor-monitor-001';

  test('Hardware Scenario 1: Both temperature probes and ADXL345 operational', async ({ request, page }) => {
    // 1. Ingest telemetry where all sensors are working
    const ingestRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: TEST_DEVICE_ID,
        motor_temp_c: 45.2,
        ambient_temp_c: 26.1,
        ax_g: 0.04,
        ay_g: -0.08,
        az_g: 0.96,
        rms_x_g: 0.012,
        rms_y_g: 0.014,
        rms_z_g: 0.018,
        sample_count: 200,
        firmware_version: '1.1.0',
        wifi_rssi_dbm: -58,
        sensor_status: {
          adxl345: 'ready',
          motor_temp: 'ready',
          ambient_temp: 'ready',
        },
      },
    });
    expect(ingestRes.status()).toBe(201);

    // 2. Query live telemetry API
    const liveRes = await request.get(`/api/telemetry/live?device_id=${TEST_DEVICE_ID}`);
    expect(liveRes.status()).toBe(200);
    const liveBody = await liveRes.json();
    expect(liveBody.is_online).toBe(true);
    expect(liveBody.sensor_health.esp32).toBe('online');
    expect(liveBody.sensor_health.motor_temp).toBe('ready');
    expect(liveBody.sensor_health.ambient_temp).toBe('ready');
    expect(liveBody.sensor_health.adxl345).toBe('ready');
    expect(liveBody.sensor_health.wifi.status).toBe('connected');

    // 3. Verify Dashboard display
    await page.goto('/login');
    await page.click('#demo-login-btn');
    await page.goto('/dashboard');

    await expect(page.locator('#status-card-esp32')).toBeVisible();
    await expect(page.locator('#badge-status-esp32')).toContainText(/Online|Streaming/i);
    await expect(page.locator('#badge-status-motor-probe')).toContainText(/Operational/i);
    await expect(page.locator('#badge-status-ambient-probe')).toContainText(/Operational/i);
    await expect(page.locator('#badge-status-adxl345')).toContainText(/Operational/i);

    // Metric cards show actual values
    await expect(page.locator('#metric-motor-temp')).toContainText('45.2');
    await expect(page.locator('#metric-ambient-temp')).toContainText('26.1');
    await expect(page.locator('#metric-temp-diff')).toContainText('+19.1');
    await expect(page.locator('#metric-rms-z')).toContainText('0.0180');
  });

  test('Hardware Scenario 2: Only motor probe connected (ambient probe disconnected)', async ({ request, page }) => {
    // Ingest telemetry with ambient_temp_c null and ambient_temp marked not_detected
    const ingestRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: TEST_DEVICE_ID,
        motor_temp_c: 48.6,
        ambient_temp_c: null, // Ambient probe physically missing
        ax_g: 0.03,
        ay_g: -0.06,
        az_g: 0.97,
        rms_x_g: 0.015,
        rms_y_g: 0.017,
        rms_z_g: 0.021,
        sample_count: 200,
        wifi_rssi_dbm: -61,
        sensor_status: {
          adxl345: 'ready',
          motor_temp: 'ready',
          ambient_temp: 'not_detected',
        },
      },
    });
    expect(ingestRes.status()).toBe(201);

    // Verify API returns partial data without synthetic ambient temp
    const liveRes = await request.get(`/api/telemetry/live?device_id=${TEST_DEVICE_ID}`);
    const liveBody = await liveRes.json();
    expect(liveBody.is_online).toBe(true);
    expect(liveBody.sensor_health.motor_temp).toBe('ready');
    expect(liveBody.sensor_health.ambient_temp).toBe('not_detected');
    expect(liveBody.latest.ambient_temp_c).toBeNull();
    expect(liveBody.latest.motor_temp_c).toBe(48.6);

    // Verify Dashboard UI handles missing ambient probe gracefully
    await page.goto('/login');
    await page.click('#demo-login-btn');
    await page.goto('/dashboard');

    await expect(page.locator('#badge-status-motor-probe')).toContainText(/Operational/i);
    await expect(page.locator('#badge-status-ambient-probe')).toContainText(/Not detected/i);

    // Motor temp displays current value, ambient temp displays Not detected badge
    await expect(page.locator('#metric-motor-temp')).toContainText('48.6');
    await expect(page.locator('#metric-ambient-temp')).toContainText(/Not detected/i);
    // Thermal rise is suppressed because ambient is missing
    await expect(page.locator('#metric-temp-diff')).toContainText(/--|Requires ambient probe/i);
    // ADXL vibration continues working
    await expect(page.locator('#metric-rms-z')).toContainText('0.0210');
  });

  test('Hardware Scenario 3: Only ambient probe connected (motor probe disconnected)', async ({ request, page }) => {
    // Ingest telemetry with motor_temp_c null
    const ingestRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: TEST_DEVICE_ID,
        motor_temp_c: null,
        ambient_temp_c: 24.8,
        ax_g: 0.02,
        ay_g: -0.04,
        az_g: 0.98,
        rms_x_g: 0.010,
        rms_y_g: 0.011,
        rms_z_g: 0.012,
        sample_count: 200,
        wifi_rssi_dbm: -59,
        sensor_status: {
          adxl345: 'ready',
          motor_temp: 'not_detected',
          ambient_temp: 'ready',
        },
      },
    });
    expect(ingestRes.status()).toBe(201);

    const liveRes = await request.get(`/api/telemetry/live?device_id=${TEST_DEVICE_ID}`);
    const liveBody = await liveRes.json();
    expect(liveBody.sensor_health.motor_temp).toBe('not_detected');
    expect(liveBody.sensor_health.ambient_temp).toBe('ready');

    await page.goto('/login');
    await page.click('#demo-login-btn');
    await page.goto('/dashboard');

    await expect(page.locator('#badge-status-motor-probe')).toContainText(/Not detected/i);
    await expect(page.locator('#badge-status-ambient-probe')).toContainText(/Operational/i);
    await expect(page.locator('#metric-ambient-temp')).toContainText('24.8');
    await expect(page.locator('#metric-motor-temp')).toContainText(/Not detected/i);
  });

  test('Hardware Scenario 4: Both temperature probes disconnected', async ({ request, page }) => {
    // Ingest telemetry with both temperature probes null
    const ingestRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: TEST_DEVICE_ID,
        motor_temp_c: null,
        ambient_temp_c: null,
        ax_g: 0.05,
        ay_g: -0.07,
        az_g: 0.95,
        rms_x_g: 0.025,
        rms_y_g: 0.027,
        rms_z_g: 0.032,
        sample_count: 200,
        wifi_rssi_dbm: -60,
        sensor_status: {
          adxl345: 'ready',
          motor_temp: 'not_detected',
          ambient_temp: 'not_detected',
        },
      },
    });
    expect(ingestRes.status()).toBe(201);

    const liveRes = await request.get(`/api/telemetry/live?device_id=${TEST_DEVICE_ID}`);
    const liveBody = await liveRes.json();
    expect(liveBody.sensor_health.motor_temp).toBe('not_detected');
    expect(liveBody.sensor_health.ambient_temp).toBe('not_detected');
    expect(liveBody.sensor_health.adxl345).toBe('ready');

    await page.goto('/login');
    await page.click('#demo-login-btn');
    await page.goto('/dashboard');

    await expect(page.locator('#badge-status-motor-probe')).toContainText(/Not detected/i);
    await expect(page.locator('#badge-status-ambient-probe')).toContainText(/Not detected/i);
    // Vibration still updates and displays
    await expect(page.locator('#metric-rms-z')).toContainText('0.0320');
  });

  test('Hardware Scenario 5: ADXL345 accelerometer unavailable', async ({ request, page }) => {
    // Ingest telemetry with vibration metrics null
    const ingestRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: TEST_DEVICE_ID,
        motor_temp_c: 42.0,
        ambient_temp_c: 25.0,
        ax_g: null,
        ay_g: null,
        az_g: null,
        rms_x_g: null,
        rms_y_g: null,
        rms_z_g: null,
        sample_count: 0,
        wifi_rssi_dbm: -63,
        sensor_status: {
          adxl345: 'not_detected',
          motor_temp: 'ready',
          ambient_temp: 'ready',
        },
      },
    });
    expect(ingestRes.status()).toBe(201);

    const liveRes = await request.get(`/api/telemetry/live?device_id=${TEST_DEVICE_ID}`);
    const liveBody = await liveRes.json();
    expect(liveBody.sensor_health.adxl345).toBe('not_detected');
    expect(liveBody.sensor_health.motor_temp).toBe('ready');
    expect(liveBody.sensor_health.ambient_temp).toBe('ready');

    await page.goto('/login');
    await page.click('#demo-login-btn');
    await page.goto('/dashboard');

    await expect(page.locator('#badge-status-adxl345')).toContainText(/Not detected/i);
    // Temperature continues working
    await expect(page.locator('#metric-motor-temp')).toContainText('42.0');
    await expect(page.locator('#metric-ambient-temp')).toContainText('25.0');
    // ADXL metric cards display Not detected status
    await expect(page.locator('#metric-rms-z')).toContainText(/Not detected/i);
  });

  test('Hardware Scenario 6: Heartbeat packet when all external sensors fail', async ({ request, page }) => {
    // ESP32 sends telemetry even with 0 sensors connected
    const heartbeatRes = await request.post('/api/telemetry', {
      headers: { 'x-device-token': VALID_TOKEN },
      data: {
        device_id: TEST_DEVICE_ID,
        motor_temp_c: null,
        ambient_temp_c: null,
        ax_g: null,
        ay_g: null,
        az_g: null,
        rms_x_g: null,
        rms_y_g: null,
        rms_z_g: null,
        sample_count: 0,
        firmware_version: '1.1.0',
        wifi_rssi_dbm: -55,
        sensor_status: {
          adxl345: 'not_detected',
          motor_temp: 'not_detected',
          ambient_temp: 'not_detected',
        },
      },
    });
    expect(heartbeatRes.status()).toBe(201);

    const liveRes = await request.get(`/api/telemetry/live?device_id=${TEST_DEVICE_ID}`);
    const liveBody = await liveRes.json();
    // Device is ONLINE even though all sensors failed!
    expect(liveBody.is_online).toBe(true);
    expect(liveBody.sensor_health.esp32).toBe('online');
    expect(liveBody.sensor_health.adxl345).toBe('not_detected');
    expect(liveBody.sensor_health.motor_temp).toBe('not_detected');
    expect(liveBody.sensor_health.ambient_temp).toBe('not_detected');
    expect(liveBody.sensor_health.wifi.status).toBe('connected');

    await page.goto('/login');
    await page.click('#demo-login-btn');
    await page.goto('/dashboard');

    // ESP32 card is Online
    await expect(page.locator('#badge-status-esp32')).toContainText(/Online|Streaming/i);
    // All sensors show Not detected
    await expect(page.locator('#badge-status-adxl345')).toContainText(/Not detected/i);
    await expect(page.locator('#badge-status-motor-probe')).toContainText(/Not detected/i);
    await expect(page.locator('#badge-status-ambient-probe')).toContainText(/Not detected/i);
  });

  test('Hardware Scenario 7: Device offline state when packet timeout exceeded', async ({ request, page }) => {
    // Query a device that has never reported or has reported long ago
    const offlineDeviceId = 'motor-offline-test-999';
    const liveRes = await request.get(`/api/telemetry/live?device_id=${offlineDeviceId}`);
    expect(liveRes.status()).toBe(200);
    const liveBody = await liveRes.json();

    // Device must be marked offline, not online
    expect(liveBody.is_online).toBe(false);
    expect(liveBody.sensor_health.esp32).toBe('offline');
    expect(liveBody.sensor_health.wifi.status).toBe('offline');
    expect(liveBody.sensor_health.motor_temp).toBe('no_data');
    expect(liveBody.sensor_health.ambient_temp).toBe('no_data');
    expect(liveBody.sensor_health.adxl345).toBe('no_data');

    await page.goto('/login');
    await page.click('#demo-login-btn');
    // Navigate with device query param
    await page.goto(`/dashboard?device_id=${offlineDeviceId}`);

    await expect(page.locator('#badge-status-esp32')).toContainText(/Offline|No signal/i);
    await expect(page.locator('#badge-status-wifi')).toContainText(/Offline|Disconnected/i);
  });
});

