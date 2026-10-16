import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { timingSafeCompare, verifyDeviceAuth, redactSecrets } from '../../src/lib/security/auth';

describe('Security and Authentication', () => {
  const originalEnv = process.env.DEVICE_INGEST_TOKEN;

  beforeEach(() => {
    process.env.DEVICE_INGEST_TOKEN = 'test_secret_token_1234567890abcdef';
  });

  afterEach(() => {
    process.env.DEVICE_INGEST_TOKEN = originalEnv;
  });

  it('timingSafeCompare correctly matches equal tokens', () => {
    expect(timingSafeCompare('secret-key-1', 'secret-key-1')).toBe(true);
  });

  it('timingSafeCompare rejects mismatched tokens of same length', () => {
    expect(timingSafeCompare('secret-key-1', 'secret-key-2')).toBe(false);
  });

  it('timingSafeCompare rejects tokens of different lengths without throwing', () => {
    expect(timingSafeCompare('short', 'much-longer-secret-token')).toBe(false);
    expect(timingSafeCompare(undefined, 'secret')).toBe(false);
    expect(timingSafeCompare('', 'secret')).toBe(false);
  });

  it('verifyDeviceAuth approves valid x-device-token header', () => {
    const headers = new Headers({
      'x-device-token': 'test_secret_token_1234567890abcdef',
    });

    const result = verifyDeviceAuth(headers);
    expect(result.authorized).toBe(true);
  });

  it('verifyDeviceAuth approves valid Authorization Bearer header', () => {
    const headers = new Headers({
      authorization: 'Bearer test_secret_token_1234567890abcdef',
    });

    const result = verifyDeviceAuth(headers);
    expect(result.authorized).toBe(true);
  });

  it('verifyDeviceAuth rejects missing or incorrect tokens', () => {
    const missingHeaders = new Headers();
    expect(verifyDeviceAuth(missingHeaders).authorized).toBe(false);

    const wrongHeaders = new Headers({
      'x-device-token': 'wrong-token',
    });
    expect(verifyDeviceAuth(wrongHeaders).authorized).toBe(false);
  });

  it('redactSecrets sanitizes sensitive credential fields from logs', () => {
    const data = {
      device_id: 'motor-monitor-001',
      device_token: 'super_secret_value',
      headers: {
        authorization: 'Bearer secret_token',
        'x-device-token': 'another_secret',
      },
      motor_temp_c: 42.5,
    };

    const redacted = redactSecrets(data);
    expect(redacted.device_id).toBe('motor-monitor-001');
    expect(redacted.device_token).toBe('[REDACTED]');
    expect(redacted.headers.authorization).toBe('[REDACTED]');
    expect(redacted.headers['x-device-token']).toBe('[REDACTED]');
    expect(redacted.motor_temp_c).toBe(42.5);
  });
});
