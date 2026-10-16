import { z } from 'zod';

export const TelemetryPayloadSchema = z.object({
  device_id: z
    .string()
    .min(3, 'device_id must be at least 3 characters')
    .max(64, 'device_id must not exceed 64 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'device_id may only contain alphanumeric characters, hyphens, and underscores'),
  
  // Physical temperature ranges: industrial sensor bounds
  motor_temp_c: z
    .number()
    .refine((val) => Number.isFinite(val), 'motor_temp_c must be a finite number')
    .refine((val) => val >= -40 && val <= 180, 'motor_temp_c out of realistic physical range (-40°C to 180°C)'),

  ambient_temp_c: z
    .number()
    .refine((val) => Number.isFinite(val), 'ambient_temp_c must be a finite number')
    .refine((val) => val >= -40 && val <= 85, 'ambient_temp_c out of realistic physical range (-40°C to 85°C)'),

  // Accelerations in g (ADXL345 ±16g range)
  ax_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'ax_g must be a finite number')
    .refine((val) => val >= -16 && val <= 16, 'ax_g out of ADXL345 accelerometer range (±16g)'),

  ay_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'ay_g must be a finite number')
    .refine((val) => val >= -16 && val <= 16, 'ay_g out of ADXL345 accelerometer range (±16g)'),

  az_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'az_g must be a finite number')
    .refine((val) => val >= -16 && val <= 16, 'az_g out of ADXL345 accelerometer range (±16g)'),

  // AC RMS vibration values (must be non-negative)
  rms_x_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'rms_x_g must be a finite number')
    .refine((val) => val >= 0 && val <= 16, 'rms_x_g must be positive and within ±16g scale'),

  rms_y_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'rms_y_g must be a finite number')
    .refine((val) => val >= 0 && val <= 16, 'rms_y_g must be positive and within ±16g scale'),

  rms_z_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'rms_z_g must be a finite number')
    .refine((val) => val >= 0 && val <= 16, 'rms_z_g must be positive and within ±16g scale'),

  firmware_version: z
    .string()
    .max(64)
    .optional(),

  sample_count: z
    .number()
    .int()
    .min(1)
    .max(100000)
    .optional(),

  acquisition_quality: z
    .number()
    .min(0)
    .max(1)
    .optional(),
});

export type ValidatedTelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;
