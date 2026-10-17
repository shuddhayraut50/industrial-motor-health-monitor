export type DiagnosticComponent =
  | 'esp32'
  | 'wifi'
  | 'api'
  | 'adxl345'
  | 'motor_temp'
  | 'ambient_temp'
  | 'sd_card'
  | 'rtc'
  | 'classifier'
  | 'command';

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';

export type TimestampSource = 'rtc' | 'ntp' | 'system';

export interface DeviceDiagnosticEvent {
  id: string; // UUIDv4
  device_id: string;
  component: DiagnosticComponent;
  event_code: string;
  severity: DiagnosticSeverity;
  previous_state: string | null;
  new_state: string;
  event_timestamp: string; // ISO 8601 string from device
  timestamp_source: TimestampSource;
  diagnostic_message: string;
  details?: Record<string, unknown> | null;
  firmware_version?: string | null;
  resolved: boolean;
  server_received_at?: string; // ISO 8601 server receipt timestamp
}

export interface IngestDiagnosticEventsRequest {
  events: DeviceDiagnosticEvent[];
}

export interface DiagnosticEventsFilter {
  deviceId: string;
  component?: DiagnosticComponent | 'all';
  severity?: DiagnosticSeverity | 'all';
  unresolvedOnly?: boolean;
  limit?: number;
  offset?: number;
}
