import { describe, it, expect, beforeEach } from 'vitest';
import { CreateCommandSchema, CommandAckSchema } from '@/lib/validation/commands';
import {
  createDeviceCommand,
  getPendingDeviceCommands,
  acknowledgeDeviceCommand,
  getDeviceCommandsHistory,
  getMockDatabaseInstance,
} from '@/lib/supabase/db';

describe('Two-Way Device Commands System', () => {
  beforeEach(() => {
    getMockDatabaseInstance().clear();
  });

  describe('CreateCommandSchema Validation', () => {
    it('accepts valid LED_TEST_SINGLE command with valid led_index', () => {
      const payload = {
        device_id: 'motor-monitor-001',
        command_type: 'LED_TEST_SINGLE',
        parameters: { led_index: 3, duration_ms: 1500 },
        expires_in_seconds: 60,
      };
      const result = CreateCommandSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects LED_TEST_SINGLE with invalid led_index (out of range 1..5)', () => {
      const payload = {
        device_id: 'motor-monitor-001',
        command_type: 'LED_TEST_SINGLE',
        parameters: { led_index: 7 }, // Invalid! Only 5 LEDs exist
      };
      const result = CreateCommandSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Invalid LED_TEST_SINGLE');
      }
    });

    it('accepts valid LED_TEST_ALL command', () => {
      const payload = {
        device_id: 'motor-monitor-001',
        command_type: 'LED_TEST_ALL',
        parameters: { step_duration_ms: 500 },
      };
      const result = CreateCommandSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('accepts valid SET_ALERT_THRESHOLDS command', () => {
      const payload = {
        device_id: 'motor-monitor-001',
        command_type: 'SET_ALERT_THRESHOLDS',
        parameters: {
          motor_temp_caution_c: 65,
          motor_temp_warning_c: 80,
          motor_temp_critical_c: 95,
          rms_caution_g: 0.15,
          rms_warning_g: 0.35,
          rms_critical_g: 0.70,
        },
      };
      const result = CreateCommandSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects malicious or unknown command types', () => {
      const payload = {
        device_id: 'motor-monitor-001',
        command_type: 'STOP_MOTOR_NOW', // Machine-control is strictly prohibited
      };
      const result = CreateCommandSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('CommandAckSchema Validation', () => {
    it('validates a successful command execution ACK with UUID', () => {
      const ack = {
        command_id: '11111111-2222-3333-4444-555555555555',
        status: 'SUCCEEDED',
        result: { test: 'passed', gpio: 4, duration_ms: 500 },
      };
      const result = CommandAckSchema.safeParse(ack);
      expect(result.success).toBe(true);
    });

    it('validates a failed execution ACK with error message', () => {
      const ack = {
        command_id: '11111111-2222-3333-4444-555555555555',
        status: 'FAILED',
        error_message: 'GPIO bus busy with sensor reading',
      };
      const result = CommandAckSchema.safeParse(ack);
      expect(result.success).toBe(true);
    });
  });

  describe('Command Lifecycle Store Operations', () => {
    it('enqueues a command, marks DELIVERED on poll, and updates on ACK', async () => {
      const deviceId = 'motor-monitor-001';

      // 1. Enqueue command
      const created = await createDeviceCommand({
        device_id: deviceId,
        command_type: 'LED_TEST_ALL',
        parameters: { step_duration_ms: 500 },
      });

      expect(created.status).toBe('QUEUED');
      expect(created.device_id).toBe(deviceId);

      // 2. ESP32 Polls pending commands
      const pending = await getPendingDeviceCommands(deviceId);
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(created.id);
      expect(pending[0].status).toBe('DELIVERED');

      // Subsequent immediate poll should return empty (already delivered)
      const secondPoll = await getPendingDeviceCommands(deviceId);
      expect(secondPoll.length).toBe(0);

      // 3. ESP32 acknowledges execution success
      const updated = await acknowledgeDeviceCommand({
        command_id: created.id,
        status: 'SUCCEEDED',
        result: { leds_pulsed: 5 },
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('SUCCEEDED');
      expect(updated?.completed_at).toBeDefined();

      // 4. Command history retrieval
      const history = await getDeviceCommandsHistory(deviceId);
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('SUCCEEDED');
    });
  });
});
