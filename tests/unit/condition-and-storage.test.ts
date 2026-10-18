import { describe, it, expect } from 'vitest';
import { TelemetryPayloadSchema, TelemetryBatchPayloadSchema } from '@/lib/validation/telemetry';
import { getStorageBudgetStatus } from '@/lib/supabase/db';

describe('Condition Classification and Storage Hierarchy Validation', () => {
  const basePayload = {
    device_id: 'motor-monitor-001',
    motor_temp_c: 44.5,
    ambient_temp_c: 28.0,
    ax_g: 0.01,
    ay_g: -0.02,
    az_g: 0.98,
    rms_x_g: 0.015,
    rms_y_g: 0.018,
    rms_z_g: 0.022,
  };

  it('validates rule-based condition status values (GOOD, CHECK, WARNING, CRITICAL, UNKNOWN)', () => {
    const statuses = ['GOOD', 'CHECK', 'WARNING', 'CRITICAL', 'UNKNOWN'] as const;
    for (const status of statuses) {
      const res = TelemetryPayloadSchema.safeParse({
        ...basePayload,
        condition_status: status,
        condition_reason: `Evaluated as ${status}`,
      });
      expect(res.success).toBe(true);
    }
  });

  it('rejects unsupported condition classification strings', () => {
    const res = TelemetryPayloadSchema.safeParse({
      ...basePayload,
      condition_status: 'PERFECT', // Not permitted
    });
    expect(res.success).toBe(false);
  });

  it('validates storage hierarchy fields with MicroSD medium', () => {
    const res = TelemetryPayloadSchema.safeParse({
      ...basePayload,
      storage_medium: 'sd_card',
      storage_used_pct: 42.5,
      dropped_records_count: 0,
      unsynced_records_count: 0,
    });
    expect(res.success).toBe(true);
  });

  it('validates flash fallback medium when SD is unavailable', () => {
    const res = TelemetryPayloadSchema.safeParse({
      ...basePayload,
      storage_medium: 'flash_littlefs',
      storage_used_pct: 78.2,
      dropped_records_count: 0,
      unsynced_records_count: 14,
    });
    expect(res.success).toBe(true);
  });

  it('validates dropped records and alerts when storage ceiling reaches 90%', () => {
    const res = TelemetryPayloadSchema.safeParse({
      ...basePayload,
      storage_medium: 'flash_littlefs',
      storage_used_pct: 91.5, // Exceeds 90% storage ceiling
      dropped_records_count: 5, // Records dropped according to retention policy
      unsynced_records_count: 120,
    });
    expect(res.success).toBe(true);
  });

  it('rejects negative storage utilization percentage', () => {
    const res = TelemetryPayloadSchema.safeParse({
      ...basePayload,
      storage_used_pct: -5,
    });
    expect(res.success).toBe(false);
  });

  it('validates batch telemetry payloads for opportunistic offline sync', () => {
    const batch = [
      { ...basePayload, record_id: 'rec-001', motor_temp_c: 44.5 },
      { ...basePayload, record_id: 'rec-002', motor_temp_c: 45.1 },
      { ...basePayload, record_id: 'rec-003', motor_temp_c: 45.8 },
    ];
    const res = TelemetryBatchPayloadSchema.safeParse(batch);
    expect(res.success).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
    expect((res.data as unknown[]).length).toBe(3);
  });

  it('validates 500 MB cloud quota partitioning (400 MB general / 100 MB error logs)', async () => {
    const budget = await getStorageBudgetStatus();
    expect(budget.cloud.general_data_limit_mb).toBe(400);
    expect(budget.cloud.error_data_limit_mb).toBe(100);
    expect(budget.cloud.total_limit_mb).toBe(500);
    expect(budget.edge.total_ceiling_pct).toBe(90);
    expect(budget.edge.telemetry_backlog_budget_pct).toBe(85);
    expect(budget.edge.error_diagnostics_budget_pct).toBe(15);
    expect(budget.edge.fifo_step_deletion_active).toBe(true);
  });
});
