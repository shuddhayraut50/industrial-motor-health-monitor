export interface TelemetryPayload {
  device_id: string;
  motor_temp_c: number;
  ambient_temp_c: number;
  ax_g: number;
  ay_g: number;
  az_g: number;
  rms_x_g: number;
  rms_y_g: number;
  rms_z_g: number;
  firmware_version?: string;
  sample_count?: number;
  acquisition_quality?: number;
}

export interface TelemetryRecord extends TelemetryPayload {
  id: number | string;
  recorded_at: string; // ISO 8601 server timestamp
  created_at?: string;
}

export interface DeviceRecord {
  id: string;
  device_id: string;
  display_name: string;
  location: string;
  enabled: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TimeWindow = '1m' | '5m' | '15m' | '60m' | '24h' | 'custom';

export interface TelemetryStats {
  sample_count: number;
  motor_temp: { min: number; max: number; avg: number };
  ambient_temp: { min: number; max: number; avg: number };
  temp_diff: { min: number; max: number; avg: number };
  rms_x: { min: number; max: number; avg: number };
  rms_y: { min: number; max: number; avg: number };
  rms_z: { min: number; max: number; avg: number };
}
