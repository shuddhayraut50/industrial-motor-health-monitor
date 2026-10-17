import { z } from 'zod';

export const DiagnosticComponentSchema = z.enum([
  'esp32',
  'wifi',
  'api',
  'adxl345',
  'motor_temp',
  'ambient_temp',
  'sd_card',
  'rtc',
  'classifier',
  'command',
]);

export const DiagnosticSeveritySchema = z.enum(['info', 'warning', 'error', 'critical']);

export const TimestampSourceSchema = z.enum(['rtc', 'ntp', 'system']);

export const SingleDiagnosticEventSchema = z.object({
  id: z.string().min(1).max(64),
  device_id: z
    .string()
    .min(3, 'device_id must be at least 3 characters')
    .max(64, 'device_id must not exceed 64 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'device_id may only contain alphanumeric characters, hyphens, and underscores'),
  component: DiagnosticComponentSchema,
  event_code: z
    .string()
    .min(3, 'event_code must be at least 3 characters')
    .max(64, 'event_code must not exceed 64 characters')
    .regex(/^[A-Z0-9_]+$/, 'event_code must be uppercase alphanumeric with underscores'),
  severity: DiagnosticSeveritySchema,
  previous_state: z.string().max(64).nullable().optional(),
  new_state: z.string().min(1).max(64),
  event_timestamp: z.string().datetime({ offset: true }),
  timestamp_source: TimestampSourceSchema.default('system'),
  diagnostic_message: z.string().min(1).max(256),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  firmware_version: z.string().max(64).nullable().optional(),
  resolved: z.boolean().default(false),
});

export const IngestDiagnosticEventsPayloadSchema = z.union([
  SingleDiagnosticEventSchema,
  z.array(SingleDiagnosticEventSchema).min(1).max(100),
  z.object({
    events: z.array(SingleDiagnosticEventSchema).min(1).max(100),
  }),
]);

export type ValidatedDiagnosticEvent = z.infer<typeof SingleDiagnosticEventSchema>;
