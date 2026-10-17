export type SensorState = 'ready' | 'not_detected' | 'error' | 'no_data';
export type SdCardState = 'ready' | 'missing' | 'full' | 'write_error' | 'not_initialized';
export type RtcState = 'ready' | 'not_detected' | 'invalid_time' | 'time_lost';

export interface SensorStatusMap {
  adxl345?: SensorState;
  motor_temp?: SensorState;
  ambient_temp?: SensorState;
}

export interface TelemetryPayload {
  device_id: string;
  record_id?: string | null;
  measured_at?: string | null; // ISO 8601 physical measurement timestamp from DS3231 RTC
  motor_temp_c?: number | null;
  ambient_temp_c?: number | null;
  ax_g?: number | null;
  ay_g?: number | null;
  az_g?: number | null;
  rms_x_g?: number | null;
  rms_y_g?: number | null;
  rms_z_g?: number | null;
  firmware_version?: string;
  sample_count?: number | null;
  acquisition_quality?: number | null;
  wifi_rssi_dbm?: number | null;
  sensor_status?: SensorStatusMap;
  i2c_errors?: number | null;
  missed_sample_slots?: number | null;
  sd_card_status?: SdCardState | null;
  unsynced_records_count?: number | null;
  oldest_unsynced_timestamp?: string | null;
  rtc_status?: RtcState | null;
  rtc_synced?: boolean | null;
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
  wifi_rssi_dbm?: number | null;
  sensor_status?: SensorStatusMap;
  sd_card_status?: SdCardState | null;
  rtc_status?: RtcState | null;
  unsynced_records_count?: number | null;
  last_measured_at?: string | null;
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
