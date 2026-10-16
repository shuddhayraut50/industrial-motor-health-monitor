import { test, expect } from '@playwright/test';

test.describe('Historical Analytics, CSV Export, and Mobile Layout', () => {
  test('Case 5 & 6: Historical date filtering, stats cards, and CSV export', async ({ page }) => {
    await page.goto('/login');
    await page.click('#demo-login-btn');
    await page.goto('/dashboard/history');

    // Verify date inputs exist
    const startDateInput = page.locator('#start-date');
    const endDateInput = page.locator('#end-date');
    await expect(startDateInput).toBeVisible();
    await expect(endDateInput).toBeVisible();

    // Verify Apply Filter button
    const applyBtn = page.locator('#apply-filter-btn');
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();

    // Check statistical summary cards are visible
    await expect(page.locator('text=Sample Count')).toBeVisible();
    await expect(page.locator('text=Motor Temp (Min / Max / Avg)')).toBeVisible();
    await expect(page.locator('text=RMS Vibration Z-Axis')).toBeVisible();

    // Check CSV Export button triggers file download
    const exportBtn = page.locator('#export-csv-btn');
    await expect(exportBtn).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('motor_telemetry');
    expect(download.suggestedFilename()).toContain('.csv');
  });

  test('Case 11: Responsive layout adaptivity on viewport resizing', async ({ page }) => {
    // Set to mobile viewport size
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');
    await page.click('#demo-login-btn');
    await page.goto('/dashboard');

    // Header and Metric Cards should remain visible and vertically stacked without clipping
    await expect(page.locator('#device-selector')).toBeVisible();
    await expect(page.locator('#metric-motor-temp')).toBeVisible();
    await expect(page.locator('#metric-ambient-temp')).toBeVisible();
  });
});
