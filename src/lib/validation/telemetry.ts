import { z } from 'zod';

export const TelemetryPayloadSchema = z.object({
  device_id: z
    .string()
    .min(3, 'device_id must be at least 3 characters')
    .max(64, 'device_id must not exceed 64 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'device_id may only contain alphanumeric characters, hyphens, and underscores'),
  
  // Physical temperature ranges: industrial sensor bounds (null if probe not detected)
  motor_temp_c: z
    .number()
    .refine((val) => Number.isFinite(val), 'motor_temp_c must be a finite number')
    .refine((val) => val >= -40 && val <= 180, 'motor_temp_c out of realistic physical range (-40°C to 180°C)')
    .nullable()
    .optional(),

  ambient_temp_c: z
    .number()
    .refine((val) => Number.isFinite(val), 'ambient_temp_c must be a finite number')
    .refine((val) => val >= -40 && val <= 85, 'ambient_temp_c out of realistic physical range (-40°C to 85°C)')
    .nullable()
    .optional(),

  // Accelerations in g (ADXL345 ±16g range, null if sensor not detected)
  ax_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'ax_g must be a finite number')
    .refine((val) => val >= -16 && val <= 16, 'ax_g out of ADXL345 accelerometer range (±16g)')
    .nullable()
    .optional(),

  ay_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'ay_g must be a finite number')
    .refine((val) => val >= -16 && val <= 16, 'ay_g out of ADXL345 accelerometer range (±16g)')
    .nullable()
    .optional(),

  az_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'az_g must be a finite number')
    .refine((val) => val >= -16 && val <= 16, 'az_g out of ADXL345 accelerometer range (±16g)')
    .nullable()
    .optional(),

  // AC RMS vibration values (must be non-negative, null if sensor not detected)
  rms_x_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'rms_x_g must be a finite number')
    .refine((val) => val >= 0 && val <= 16, 'rms_x_g must be positive and within ±16g scale')
    .nullable()
    .optional(),

  rms_y_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'rms_y_g must be a finite number')
    .refine((val) => val >= 0 && val <= 16, 'rms_y_g must be positive and within ±16g scale')
    .nullable()
    .optional(),

  rms_z_g: z
    .number()
    .refine((val) => Number.isFinite(val), 'rms_z_g must be a finite number')
    .refine((val) => val >= 0 && val <= 16, 'rms_z_g must be positive and within ±16g scale')
    .nullable()
    .optional(),

  firmware_version: z
    .string()
    .max(64)
    .optional(),

  sample_count: z
    .number()
    .int()
    .min(0)
    .max(100000)
    .nullable()
    .optional(),

  acquisition_quality: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional(),

  wifi_rssi_dbm: z
    .number()
    .int()
    .min(-140)
    .max(0)
    .nullable()
    .optional(),

  sensor_status: z
    .object({
      adxl345: z.enum(['ready', 'not_detected', 'error', 'no_data']).optional(),
      motor_temp: z.enum(['ready', 'not_detected', 'error', 'no_data']).optional(),
      ambient_temp: z.enum(['ready', 'not_detected', 'error', 'no_data']).optional(),
    })
    .optional(),

  i2c_errors: z
    .number()
    .int()
    .min(0)
    .max(100000)
    .nullable()
    .optional(),

  missed_sample_slots: z
    .number()
    .int()
    .min(0)
    .max(100000)
    .nullable()
    .optional(),

  record_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_\-:]+$/, 'record_id contains invalid characters')
    .nullable()
    .optional(),

  measured_at: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),

  sd_card_status: z
    .enum(['ready', 'missing', 'full', 'write_error', 'not_initialized'])
    .nullable()
    .optional(),

  unsynced_records_count: z
    .number()
    .int()
    .min(0)
    .max(1000000)
    .nullable()
    .optional(),

  oldest_unsynced_timestamp: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),

  rtc_status: z
    .enum(['ready', 'not_detected', 'invalid_time', 'time_lost'])
    .nullable()
    .optional(),

  rtc_synced: z
    .boolean()
    .nullable()
    .optional(),

  condition_status: z
    .enum(['GOOD', 'CHECK', 'WARNING', 'CRITICAL', 'UNKNOWN'])
    .nullable()
    .optional(),

  condition_reason: z
    .string()
    .max(256)
    .nullable()
    .optional(),

  storage_medium: z
    .enum(['sd_card', 'flash_littlefs', 'none', 'error'])
    .nullable()
    .optional(),

  storage_used_pct: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional(),

  dropped_records_count: z
    .number()
    .int()
    .min(0)
    .max(10000000)
    .nullable()
    .optional(),
});

export type ValidatedTelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;

