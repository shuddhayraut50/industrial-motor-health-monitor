export type SensorState = 'ready' | 'not_detected' | 'error' | 'no_data';
export type SdCardState = 'ready' | 'missing' | 'full' | 'write_error' | 'not_initialized';
export type RtcState = 'ready' | 'not_detected' | 'invalid_time' | 'time_lost';

export type ConditionStatus = 'GOOD' | 'CHECK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
export type StorageMedium = 'sd_card' | 'flash_littlefs' | 'none' | 'error';
export type DeviceConnectionStatus = 'ONLINE' | 'STALE' | 'OFFLINE' | 'API_ERROR' | 'NEVER_CONNECTED';

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
  // Local condition classification and storage hierarchy diagnostics
  condition_status?: ConditionStatus | null;
  condition_reason?: string | null;
  storage_medium?: StorageMedium | null;
  storage_used_pct?: number | null;
  dropped_records_count?: number | null;
  // Extended hardware performance & storage bytes
  free_heap_bytes?: number | null;
  min_free_heap_bytes?: number | null;
  largest_free_block_bytes?: number | null;
  core0_stack_free_bytes?: number | null;
  sample_exec_us?: number | null;
  fast_rms_eval_us?: number | null;
  decision_to_led_us?: number | null;
  sd_write_time_ms?: number | null;
  upload_time_ms?: number | null;
  queue_overflow_count?: number | null;
  reset_reason?: string | null;
  wifi_disconnect_count?: number | null;
  uptime_seconds?: number | null;
  sd_total_bytes?: number | null;
  sd_used_bytes?: number | null;
  flash_total_bytes?: number | null;
  flash_used_bytes?: number | null;
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
  condition_status?: ConditionStatus | null;
  condition_reason?: string | null;
  storage_medium?: StorageMedium | null;
  storage_used_pct?: number | null;
  dropped_records_count?: number | null;
  free_heap_bytes?: number | null;
  min_free_heap_bytes?: number | null;
  largest_free_block_bytes?: number | null;
  core0_stack_free_bytes?: number | null;
  sample_exec_us?: number | null;
  fast_rms_eval_us?: number | null;
  decision_to_led_us?: number | null;
  sd_write_time_ms?: number | null;
  upload_time_ms?: number | null;
  queue_overflow_count?: number | null;
  reset_reason?: string | null;
  wifi_disconnect_count?: number | null;
  uptime_seconds?: number | null;
  sd_total_bytes?: number | null;
  sd_used_bytes?: number | null;
  flash_total_bytes?: number | null;
  flash_used_bytes?: number | null;
  created_at: string;
  updated_at: string;
}

export type TimeWindow = '1m' | '5m' | '15m' | '60m' | '12h' | '24h' | 'custom';

export interface TelemetryStats {
  sample_count: number;
  motor_temp: { min: number; max: number; avg: number };
  ambient_temp: { min: number; max: number; avg: number };
  temp_diff: { min: number; max: number; avg: number };
  rms_x: { min: number; max: number; avg: number };
  rms_y: { min: number; max: number; avg: number };
  rms_z: { min: number; max: number; avg: number };
}

export interface StorageBudgetBreakdown {
  cloud: {
    general_data_mb: number;
    general_data_limit_mb: number; // 400 MB
    general_data_used_pct: number;
    error_data_mb: number;
    error_data_limit_mb: number;   // 100 MB
    error_data_used_pct: number;
    total_used_mb: number;
    total_limit_mb: number;        // 500 MB
    total_used_pct: number;
  };
  edge: {
    total_ceiling_pct: number;           // 90%
    telemetry_backlog_budget_pct: number;// 85% of active storage
    error_diagnostics_budget_pct: number;// 15% of active storage
    fifo_step_deletion_active: boolean;
  };
}

export interface StoragePipelineDiagnostics {
  medium?: StorageMedium;
  used_pct?: number;
  dropped_records_count?: number;
  sd_card_status?: SdCardState;
  unsynced_records_count?: number;
  oldest_unsynced_timestamp?: string | null;
  total_supabase_records?: number;
  sd_total_bytes?: number | null;
  sd_used_bytes?: number | null;
  sd_free_bytes?: number | null;
  flash_total_bytes?: number | null;
  flash_used_bytes?: number | null;
  flash_free_bytes?: number | null;
  budget?: StorageBudgetBreakdown;
}

export interface SystemPerformanceDiagnostics {
  free_heap_bytes?: number | null;
  min_free_heap_bytes?: number | null;
  largest_free_block_bytes?: number | null;
  core0_stack_free_bytes?: number | null;
  sample_exec_us?: number | null;
  fast_rms_eval_us?: number | null;
  decision_to_led_us?: number | null;
  sd_write_time_ms?: number | null;
  upload_time_ms?: number | null;
  queue_overflow_count?: number | null;
  reset_reason?: string | null;
  wifi_disconnect_count?: number | null;
  uptime_seconds?: number | null;
}
