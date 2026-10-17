import { z } from 'zod';

export const CommandTypeEnum = z.enum([
  'LED_TEST_ALL',
  'LED_TEST_SINGLE',
  'STATUS_REQUEST',
  'SENSOR_DIAGNOSTIC',
  'SYNC_STATUS_REQUEST',
  'SET_ALERT_THRESHOLDS',
  'SET_SAMPLE_CONFIGURATION',
]);

export const CommandStatusEnum = z.enum([
  'CREATED',
  'QUEUED',
  'DELIVERED',
  'ACKNOWLEDGED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
]);

export const LedTestSingleParamsSchema = z.object({
  led_index: z.number().int().min(1).max(5),
  duration_ms: z.number().int().min(100).max(10000).optional().default(2000),
});

export const LedTestAllParamsSchema = z.object({
  step_duration_ms: z.number().int().min(100).max(5000).optional().default(500),
});

export const AlertThresholdsSchema = z.object({
  motor_temp_caution_c: z.number().min(0).max(150).optional(),
  motor_temp_warning_c: z.number().min(0).max(150).optional(),
  motor_temp_critical_c: z.number().min(0).max(180).optional(),
  rms_caution_g: z.number().min(0).max(16).optional(),
  rms_warning_g: z.number().min(0).max(16).optional(),
  rms_critical_g: z.number().min(0).max(16).optional(),
});

export const SampleConfigSchema = z.object({
  sample_rate_hz: z.number().int().min(50).max(400).optional(),
  upload_interval_sec: z.number().int().min(1).max(60).optional(),
});

export const CreateCommandSchema = z.object({
  device_id: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'device_id must only contain alphanumeric characters, hyphens, and underscores'),
  command_type: CommandTypeEnum,
  parameters: z.record(z.string(), z.unknown()).optional().default({}),
  expires_in_seconds: z.number().int().min(10).max(86400).optional().default(300),
}).superRefine((data, ctx) => {
  if (data.command_type === 'LED_TEST_SINGLE') {
    const res = LedTestSingleParamsSchema.safeParse(data.parameters);
    if (!res.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parameters'],
        message: `Invalid LED_TEST_SINGLE parameters: ${res.error.message}`,
      });
    }
  } else if (data.command_type === 'LED_TEST_ALL') {
    const res = LedTestAllParamsSchema.safeParse(data.parameters);
    if (!res.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parameters'],
        message: `Invalid LED_TEST_ALL parameters: ${res.error.message}`,
      });
    }
  } else if (data.command_type === 'SET_ALERT_THRESHOLDS') {
    const res = AlertThresholdsSchema.safeParse(data.parameters);
    if (!res.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parameters'],
        message: `Invalid SET_ALERT_THRESHOLDS parameters: ${res.error.message}`,
      });
    }
  }
});

export const CommandAckSchema = z.object({
  command_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_\-:]+$/, 'Invalid command_id format; must be alphanumeric with hyphens or underscores'),
  status: z.enum(['ACKNOWLEDGED', 'EXECUTING', 'SUCCEEDED', 'FAILED']),
  result: z.record(z.string(), z.unknown()).optional(),
  error_message: z.string().max(512).optional(),
});
