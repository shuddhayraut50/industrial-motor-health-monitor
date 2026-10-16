import { z } from 'zod';

export const DeviceConfigUpdateSchema = z.object({
  device_id: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  
  // Safe reporting intervals (minimum 100ms, maximum 60,000ms = 1 minute)
  reporting_interval_ms: z
    .number()
    .int()
    .min(100, 'Minimum safe reporting interval is 100ms')
    .max(60000, 'Maximum reporting interval is 60,000ms'),

  enabled_fields: z
    .array(z.string())
    .min(1, 'At least one telemetry field must be enabled'),

  configuration_json: z
    .record(z.string(), z.unknown())
    .default({}),
});

export const DeviceConfigAckSchema = z.object({
  device_id: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  acknowledged_config_version: z
    .number()
    .int()
    .min(1),
  firmware_version: z
    .string()
    .max(64)
    .optional(),
  status: z
    .enum(['acknowledged', 'rejected', 'pending'])
    .default('acknowledged'),
});

export type ValidatedDeviceConfigUpdate = z.infer<typeof DeviceConfigUpdateSchema>;
export type ValidatedDeviceConfigAck = z.infer<typeof DeviceConfigAckSchema>;
