export interface DeviceConfig {
  id?: string;
  device_id: string;
  config_version: number;
  reporting_interval_ms: number;
  enabled_fields: string[];
  configuration_json: Record<string, unknown>;
  updated_at?: string;
}

export interface DeviceConfigAck {
  id?: string;
  device_id: string;
  acknowledged_config_version: number;
  acknowledged_at?: string;
  firmware_version?: string;
  status: 'acknowledged' | 'rejected' | 'pending';
}

export interface DeviceStatusInfo {
  device: DeviceRecord;
  latest_telemetry: TelemetryRecord | null;
  latest_config: DeviceConfig | null;
  latest_ack: DeviceConfigAck | null;
  is_online: boolean;
  is_stale: boolean;
  age_seconds: number | null;
}

import { DeviceRecord, TelemetryRecord } from './telemetry';
