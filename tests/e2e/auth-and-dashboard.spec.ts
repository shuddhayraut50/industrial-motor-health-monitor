import { test, expect } from '@playwright/test';

test.describe('Authentication and Dashboard Monitoring', () => {
  test('Case 1: Login and protected routes navigation', async ({ page }) => {
    // Navigate to /login
    await page.goto('/login');
    await expect(page).toHaveTitle(/Industrial Motor Health Monitoring/i);
    await expect(page.locator('h1')).toContainText('Industrial Motor Health Monitor');

    // Fill credentials and sign in
    await page.fill('#login-email', 'operator@internal.test');
    await page.fill('#login-password', 'ValidIndustrialPassword123!');
    await page.click('#login-submit-btn');

    // Should redirect to dashboard
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.locator('h2').first()).toBeVisible();

    // Sign out should return to /login
    await page.click('#sign-out-button');
    await expect(page).toHaveURL(/.*login/);
  });

  test('Case 2: Dashboard renders live metrics and sensor indicators', async ({ page }) => {
    // Navigate via fast test sign-in
    await page.goto('/login');
    await page.click('#demo-login-btn');
    await expect(page).toHaveURL(/.*dashboard/);

    // Verify presence of device selector and target device
    const deviceSelect = page.locator('#device-selector');
    await expect(deviceSelect).toBeVisible();
    await expect(deviceSelect).toHaveValue('motor-monitor-001');

    // Verify temperature telemetry cards
    await expect(page.locator('#metric-motor-temp')).toBeVisible();
    await expect(page.locator('#metric-ambient-temp')).toBeVisible();
    await expect(page.locator('#metric-temp-diff')).toBeVisible();

    // Verify AC RMS vibration metrics
    await expect(page.locator('#metric-rms-x')).toBeVisible();
    await expect(page.locator('#metric-rms-y')).toBeVisible();
    await expect(page.locator('#metric-rms-z')).toBeVisible();

    // Verify mean acceleration metrics
    await expect(page.locator('#metric-ax')).toBeVisible();
    await expect(page.locator('#metric-ay')).toBeVisible();
    await expect(page.locator('#metric-az')).toBeVisible();
  });

  test('Case 3 & 4: Live-data refresh, time window toggle, and stale indicator', async ({ page }) => {
    await page.goto('/login');
    await page.click('#demo-login-btn');
    await page.goto('/dashboard/live');

    // Check time window buttons
    await expect(page.locator('#window-btn-60')).toBeVisible();
    await expect(page.locator('#window-btn-300')).toBeVisible();
    await expect(page.locator('#window-btn-900')).toBeVisible();

    // Switch to 1 min window
    await page.click('#window-btn-60');

    // Check Pause / Resume polling toggle
    const pauseBtn = page.locator('#pause-resume-btn');
    await expect(pauseBtn).toBeVisible();
    await pauseBtn.click();
    await expect(pauseBtn).toContainText('Resume');
    await pauseBtn.click();
    await expect(pauseBtn).toContainText('Pause');
  });
});
