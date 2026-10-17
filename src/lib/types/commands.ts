export type CommandType =
  | 'LED_TEST_ALL'
  | 'LED_TEST_SINGLE'
  | 'STATUS_REQUEST'
  | 'SENSOR_DIAGNOSTIC'
  | 'SYNC_STATUS_REQUEST'
  | 'SET_ALERT_THRESHOLDS'
  | 'SET_SAMPLE_CONFIGURATION';

export type CommandStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'DELIVERED'
  | 'ACKNOWLEDGED'
  | 'EXECUTING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'EXPIRED';

export interface LedTestSingleParams {
  led_index: number; // 1 to 5
  duration_ms?: number; // e.g., 2000 ms
}

export interface LedTestAllParams {
  step_duration_ms?: number; // e.g., 500 ms per LED
}

export interface AlertThresholds {
  motor_temp_caution_c: number;
  motor_temp_warning_c: number;
  motor_temp_critical_c: number;
  rms_caution_g: number;
  rms_warning_g: number;
  rms_critical_g: number;
}

export interface SetSampleConfigParams {
  sample_rate_hz?: number;
  upload_interval_sec?: number;
}

export interface DeviceCommandRecord {
  id: string;
  device_id: string;
  command_type: CommandType;
  parameters: Record<string, unknown>;
  status: CommandStatus;
  requested_by: string;
  created_at: string;
  expires_at: string;
  delivered_at?: string | null;
  acknowledged_at?: string | null;
  completed_at?: string | null;
  result?: Record<string, unknown> | null;
  error_message?: string | null;
}

export interface CreateCommandRequest {
  device_id: string;
  command_type: CommandType;
  parameters?: Record<string, unknown>;
  expires_in_seconds?: number;
}

export interface CommandAckRequest {
  command_id: string;
  status: 'ACKNOWLEDGED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED';
  result?: Record<string, unknown>;
  error_message?: string;
}
