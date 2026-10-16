import crypto from 'crypto';

/**
 * Validates a device token using a constant-time comparison to prevent timing attacks.
 * @param providedToken Token supplied by the device in headers
 * @param expectedToken Trusted token stored in environment variables or database
 */
export function timingSafeCompare(providedToken?: string | null, expectedToken?: string | null): boolean {
  if (!providedToken || !expectedToken) {
    return false;
  }

  // Hash both inputs using SHA-256 so both buffers always have identical length (32 bytes),
  // preventing length leakage when using timingSafeEqual.
  const providedHash = crypto.createHash('sha256').update(providedToken).digest();
  const expectedHash = crypto.createHash('sha256').update(expectedToken).digest();

  return crypto.timingSafeEqual(providedHash, expectedHash);
}

/**
 * Extracts and verifies the device ingestion token from HTTP request headers.
 * Supports 'x-device-token' or standard 'Authorization: Bearer <token>'
 */
export function verifyDeviceAuth(headers: Headers): { authorized: boolean; reason?: string } {
  const tokenHeader = headers.get('x-device-token');
  const authHeader = headers.get('authorization');

  let extractedToken: string | null = null;

  if (tokenHeader) {
    extractedToken = tokenHeader.trim();
  } else if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    extractedToken = authHeader.substring(7).trim();
  }

  if (!extractedToken) {
    return { authorized: false, reason: 'Missing device authentication token header' };
  }

  const configuredToken = process.env.DEVICE_INGEST_TOKEN;
  if (!configuredToken) {
    // If running in development without a configured token, fail safe
    return { authorized: false, reason: 'Server device ingestion token is unconfigured' };
  }

  const isValid = timingSafeCompare(extractedToken, configuredToken);
  if (!isValid) {
    return { authorized: false, reason: 'Invalid or unauthorized device token' };
  }

  return { authorized: true };
}

/**
 * Deeply redacts sensitive keys from objects before logging
 */
export function redactSecrets<T>(data: T): T {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSecrets(item)) as unknown as T;
  }

  const SENSITIVE_KEYS = new Set([
    'token',
    'device_token',
    'x-device-token',
    'authorization',
    'password',
    'secret',
    'supabase_secret_key',
    'key',
    'apikey',
  ]);

  const copy: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      copy[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      copy[key] = redactSecrets(val);
    } else {
      copy[key] = val;
    }
  }

  return copy as T;
}
