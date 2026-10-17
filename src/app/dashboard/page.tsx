'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/dashboard/Header';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { StaleWarningBanner } from '@/components/dashboard/StaleWarningBanner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Thermometer,
  Vibrate,
  Gauge,
  Clock,
  Cpu,
  ArrowRight,
  Wifi,
  Activity,
  HardDrive,
} from 'lucide-react';
import Link from 'next/link';
import { TelemetryRecord, DeviceRecord, SensorState, SdCardState, RtcState, ConditionStatus, StorageMedium } from '@/lib/types/telemetry';
import { SimpleMotorView } from '@/components/dashboard/SimpleMotorView';
import { LedCommandCenter } from '@/components/dashboard/LedCommandCenter';

export default function DashboardPage() {
  const [deviceId, setDeviceId] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('device_id') || 'motor-monitor-001';
    }
    return 'motor-monitor-001';
  });

  const [dashboardMode, setDashboardMode] = useState<'simple' | 'technical'>(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const modeParam = urlParams.get('mode');
      if (modeParam === 'simple' || modeParam === 'technical') {
        return modeParam;
      }
      const saved = localStorage.getItem('dashboard_mode');
      if (saved === 'simple' || saved === 'technical') {
        return saved;
      }
    }
    return 'technical';
  });

  const handleModeChange = (mode: 'simple' | 'technical') => {
    setDashboardMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('dashboard_mode', mode);
    }
  };

  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [latest, setLatest] = useState<TelemetryRecord | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [isStale, setIsStale] = useState(true);
  const [ageSeconds, setAgeSeconds] = useState<number | null>(null);
  const [configVersion, setConfigVersion] = useState<number>(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [lastSuccessfulTelemetry, setLastSuccessfulTelemetry] = useState<string | null>(null);
  const [lastMeasuredAt, setLastMeasuredAt] = useState<string | null>(null);
  const [conditionStatus, setConditionStatus] = useState<ConditionStatus>('UNKNOWN');
  const [conditionReason, setConditionReason] = useState<string>('Initial evaluation pending');
  const [storageMedium, setStorageMedium] = useState<StorageMedium>('none');
  const [storageUsedPct, setStorageUsedPct] = useState<number>(0);
  const [droppedRecordsCount, setDroppedRecordsCount] = useState<number>(0);
  const [sensorHealth, setSensorHealth] = useState<{
    esp32: 'online' | 'stale' | 'offline';
    wifi: { status: 'connected' | 'offline'; rssi_dbm: number | null };
    adxl345: SensorState;
    motor_temp: SensorState;
    ambient_temp: SensorState;
    sd_card?: SdCardState;
    rtc?: { status: RtcState; synced: boolean };
    offline_queue?: { unsynced_count: number; oldest_timestamp: string | null };
  }>({
    esp32: 'offline',
    wifi: { status: 'offline', rssi_dbm: null },
    adxl345: 'no_data',
    motor_temp: 'no_data',
    ambient_temp: 'no_data',
    sd_card: 'not_initialized',
    rtc: { status: 'not_detected', synced: false },
    offline_queue: { unsynced_count: 0, oldest_timestamp: null },
  });

  const applyData = (data: {
    device: DeviceRecord | null;
    latest: TelemetryRecord | null;
    is_online: boolean;
    is_stale: boolean;
    age_seconds: number | null;
    config_version: number;
    condition_status?: ConditionStatus | null;
    condition_reason?: string | null;
    storage_diagnostics?: {
      medium?: StorageMedium;
      used_pct?: number;
      dropped_records_count?: number;
      sd_card_status?: SdCardState;
      unsynced_records_count?: number;
      oldest_unsynced_timestamp?: string | null;
    };
    sensor_health?: {
      esp32: 'online' | 'stale' | 'offline';
      wifi: { status: 'connected' | 'offline'; rssi_dbm: number | null };
      adxl345: SensorState;
      motor_temp: SensorState;
      ambient_temp: SensorState;
      sd_card?: SdCardState;
      rtc?: { status: RtcState; synced: boolean };
      offline_queue?: { unsynced_count: number; oldest_timestamp: string | null };
    };
    last_successful_telemetry?: string | null;
    last_measured_at?: string | null;
  }) => {
    setDevice(data.device);
    setLatest(data.latest);
    setIsOnline(data.is_online);
    setIsStale(data.is_stale);
    setAgeSeconds(data.age_seconds);
    setConfigVersion(data.config_version);
    setLastSynced(new Date().toISOString());
    setLastSuccessfulTelemetry(data.last_successful_telemetry || data.latest?.recorded_at || data.device?.last_seen_at || null);
    setLastMeasuredAt(data.last_measured_at || data.latest?.measured_at || data.device?.last_measured_at || null);

    setConditionStatus(data.condition_status || data.latest?.condition_status || data.device?.condition_status || 'UNKNOWN');
    setConditionReason(data.condition_reason || data.latest?.condition_reason || data.device?.condition_reason || 'Initial baseline');
    setStorageMedium(data.storage_diagnostics?.medium || data.latest?.storage_medium || data.device?.storage_medium || 'none');
    setStorageUsedPct(data.storage_diagnostics?.used_pct ?? data.latest?.storage_used_pct ?? data.device?.storage_used_pct ?? 0);
    setDroppedRecordsCount(data.storage_diagnostics?.dropped_records_count ?? data.latest?.dropped_records_count ?? data.device?.dropped_records_count ?? 0);

    if (data.sensor_health) {
      setSensorHealth(data.sensor_health);
    } else {
      setSensorHealth({
        esp32: data.is_online ? (data.is_stale ? 'stale' : 'online') : 'offline',
        wifi: data.is_online ? { status: 'connected', rssi_dbm: data.latest?.wifi_rssi_dbm ?? null } : { status: 'offline', rssi_dbm: null },
        adxl345: !data.is_online ? 'no_data' : (data.latest?.rms_z_g !== null && data.latest?.rms_z_g !== undefined ? 'ready' : 'not_detected'),
        motor_temp: !data.is_online ? 'no_data' : (data.latest?.motor_temp_c !== null && data.latest?.motor_temp_c !== undefined ? 'ready' : 'not_detected'),
        ambient_temp: !data.is_online ? 'no_data' : (data.latest?.ambient_temp_c !== null && data.latest?.ambient_temp_c !== undefined ? 'ready' : 'not_detected'),
        sd_card: data.latest?.sd_card_status ?? data.device?.sd_card_status ?? 'not_initialized',
        rtc: {
          status: data.latest?.rtc_status ?? data.device?.rtc_status ?? 'not_detected',
          synced: Boolean(data.latest?.rtc_synced),
        },
        offline_queue: {
          unsynced_count: data.latest?.unsynced_records_count ?? data.device?.unsynced_records_count ?? 0,
          oldest_timestamp: data.latest?.oldest_unsynced_timestamp ?? null,
        },
      });
    }
  };

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const res = await fetch(`/api/telemetry/live?device_id=${encodeURIComponent(deviceId)}&window=300`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        applyData(data);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data', err);
    } finally {
      if (showRefreshing) setIsRefreshing(false);
    }
  }, [deviceId]);

  useEffect(() => {
    let active = true;
    const runFetch = async () => {
      try {
        const res = await fetch(`/api/telemetry/live?device_id=${encodeURIComponent(deviceId)}&window=300`, {
          cache: 'no-store',
        });
        if (res.ok && active) {
          const data = await res.json();
          applyData(data);
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data', err);
      }
    };

    runFetch();
    const timer = setInterval(runFetch, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [deviceId]);

  // Sensor reading validity rules: ONLY display latest reading when current AND valid
  const isMotorCurrentAndValid = isOnline && !isStale && latest?.motor_temp_c !== null && latest?.motor_temp_c !== undefined && Number.isFinite(Number(latest.motor_temp_c));
  const isAmbientCurrentAndValid = isOnline && !isStale && latest?.ambient_temp_c !== null && latest?.ambient_temp_c !== undefined && Number.isFinite(Number(latest.ambient_temp_c));
  const isAdxlCurrentAndValid = isOnline && !isStale && latest?.rms_z_g !== null && latest?.rms_z_g !== undefined && Number.isFinite(Number(latest.rms_z_g));

  const motorTemp = isMotorCurrentAndValid ? Number(latest.motor_temp_c).toFixed(1) : null;
  const ambTemp = isAmbientCurrentAndValid ? Number(latest.ambient_temp_c).toFixed(1) : null;
  const tempDiff = (isMotorCurrentAndValid && isAmbientCurrentAndValid)
    ? (Number(latest.motor_temp_c) - Number(latest.ambient_temp_c)).toFixed(1)
    : null;

  const rmsX = isAdxlCurrentAndValid ? Number(latest.rms_x_g).toFixed(4) : null;
  const rmsY = isAdxlCurrentAndValid ? Number(latest.rms_y_g).toFixed(4) : null;
  const rmsZ = isAdxlCurrentAndValid ? Number(latest.rms_z_g).toFixed(4) : null;

  const ax = isAdxlCurrentAndValid ? Number(latest.ax_g).toFixed(3) : null;
  const ay = isAdxlCurrentAndValid ? Number(latest.ay_g).toFixed(3) : null;
  const az = isAdxlCurrentAndValid ? Number(latest.az_g).toFixed(3) : null;

  const sampleCount = latest?.sample_count !== null && latest?.sample_count !== undefined ? String(latest.sample_count) : null;
  const acquisitionQuality = latest?.acquisition_quality !== null && latest?.acquisition_quality !== undefined
    ? `${(Number(latest.acquisition_quality) * 100).toFixed(0)}%`
    : null;
  const i2cErrors = latest?.i2c_errors !== null && latest?.i2c_errors !== undefined ? String(latest.i2c_errors) : (isOnline ? '0' : null);
  const missedSlots = latest?.missed_sample_slots !== null && latest?.missed_sample_slots !== undefined ? String(latest.missed_sample_slots) : (isOnline ? '0' : null);

  const sdCardState: SdCardState = (sensorHealth.sd_card || latest?.sd_card_status || device?.sd_card_status || 'not_initialized') as SdCardState;
  const rtcState: RtcState = (sensorHealth.rtc?.status || latest?.rtc_status || device?.rtc_status || 'not_detected') as RtcState;
  const rtcSynced = Boolean(sensorHealth.rtc?.synced || latest?.rtc_synced);
  const unsyncedCount = sensorHealth.offline_queue?.unsynced_count ?? latest?.unsynced_records_count ?? device?.unsynced_records_count ?? 0;
  const oldestPendingTimestamp = sensorHealth.offline_queue?.oldest_timestamp ?? latest?.oldest_unsynced_timestamp ?? null;
  const measuredAt = latest?.measured_at || lastMeasuredAt || null;

  const motorSensorState: SensorState = isMotorCurrentAndValid
    ? 'ready'
    : (!isOnline || isStale)
      ? 'no_data'
      : (sensorHealth.motor_temp === 'error' ? 'error' : 'not_detected');

  const ambientSensorState: SensorState = isAmbientCurrentAndValid
    ? 'ready'
    : (!isOnline || isStale)
      ? 'no_data'
      : (sensorHealth.ambient_temp === 'error' ? 'error' : 'not_detected');

  const adxlSensorState: SensorState = isAdxlCurrentAndValid
    ? 'ready'
    : (!isOnline || isStale)
      ? 'no_data'
      : (sensorHealth.adxl345 === 'error' ? 'error' : 'not_detected');

  const tempDiffSubValue = (isMotorCurrentAndValid && isAmbientCurrentAndValid)
    ? 'Motor Temp minus Ambient Temp'
    : (!isMotorCurrentAndValid && !isAmbientCurrentAndValid)
      ? 'Both temperature probes unavailable'
      : !isAmbientCurrentAndValid
        ? 'Requires ambient probe (not detected)'
        : 'Requires motor probe (not detected)';

  const formatAge = (sec: number | null) => {
    if (sec === null) return 'No packets';
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  const getStatusBadgeVariant = (state: SensorState) => {
    switch (state) {
      case 'ready':
        return 'online';
      case 'not_detected':
        return 'warning';
      case 'error':
        return 'offline';
      case 'no_data':
      default:
        return 'neutral';
    }
  };

  const getStatusLabel = (state: SensorState) => {
    switch (state) {
      case 'ready':
        return 'Operational';
      case 'not_detected':
        return 'Not detected';
      case 'error':
        return 'Sensor Error';
      case 'no_data':
      default:
        return 'No recent data';
    }
  };

  const getSdBadgeVariant = (state: SdCardState, unsynced: number) => {
    switch (state) {
      case 'ready':
        return unsynced > 0 ? 'warning' : 'online';
      case 'full':
      case 'write_error':
      case 'missing':
        return 'offline';
      case 'not_initialized':
      default:
        return 'neutral';
    }
  };

  const getSdLabel = (state: SdCardState, unsynced: number) => {
    switch (state) {
      case 'ready':
        return unsynced > 0 ? `Buffering (${unsynced})` : 'Logging OK';
      case 'full':
        return 'Card Full';
      case 'missing':
        return 'Card Missing';
      case 'write_error':
        return 'Write Error';
      case 'not_initialized':
      default:
        return 'Not Mounted';
    }
  };

  const getRtcBadgeVariant = (state: RtcState, synced: boolean) => {
    switch (state) {
      case 'ready':
        return synced ? 'online' : 'stale';
      case 'time_lost':
        return 'warning';
      case 'invalid_time':
      case 'not_detected':
      default:
        return 'offline';
    }
  };

  const getRtcLabel = (state: RtcState, synced: boolean) => {
    switch (state) {
      case 'ready':
        return synced ? 'NTP Synced' : 'RTC Running';
      case 'time_lost':
        return 'Battery Lost';
      case 'invalid_time':
        return 'Invalid Time';
      case 'not_detected':
      default:
        return 'Not Detected';
    }
  };

  return (
    <div>
      <Header
        deviceId={deviceId}
        onDeviceChange={setDeviceId}
        isOnline={isOnline}
        isStale={isStale}
        lastUpdated={lastSynced}
        onManualRefresh={() => fetchData(true)}
        isRefreshing={isRefreshing}
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Simple / Technical View Switch */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-semibold text-slate-400">View Mode:</span>
            <div className="inline-flex rounded-lg p-1 bg-slate-950 border border-slate-800" role="tablist">
              <button
                id="view-mode-simple-btn"
                role="tab"
                aria-selected={dashboardMode === 'simple'}
                onClick={() => handleModeChange('simple')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  dashboardMode === 'simple'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Simple View (Operators)
              </button>
              <button
                id="view-mode-technical-btn"
                role="tab"
                aria-selected={dashboardMode === 'technical'}
                onClick={() => handleModeChange('technical')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  dashboardMode === 'technical'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Technical View (Engineers)
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-400 font-mono">
              Status: <strong className="text-slate-200">{conditionStatus}</strong>
            </span>
            <Link href="/dashboard/history" className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1">
              12h / 24h Trends &rarr;
            </Link>
          </div>
        </div>

        {/* Stale or Disconnected Warning Banner */}
        <StaleWarningBanner
          isOnline={isOnline}
          isStale={isStale}
          ageSeconds={ageSeconds}
          lastSeenTimestamp={lastSuccessfulTelemetry}
        />

        {dashboardMode === 'simple' ? (
          <SimpleMotorView
            conditionStatus={conditionStatus}
            conditionReason={conditionReason}
            isOnline={isOnline}
            isStale={isStale}
            motorTemp={motorTemp}
            ambientTemp={ambTemp}
            tempDiff={tempDiff}
            rmsZ={rmsZ}
            lastUpdated={lastSynced}
            storageMedium={storageMedium}
            storageUsedPct={storageUsedPct}
            droppedRecordsCount={droppedRecordsCount}
            unsyncedRecords={unsyncedCount}
            motorSensorState={motorSensorState}
            ambientSensorState={ambientSensorState}
            adxlSensorState={adxlSensorState}
          />
        ) : (
          <div className="space-y-6">
            {/* Independent Hardware & Sensor Health Status Grid */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Hardware & Sensor Health Status
                </h2>
                <span className="text-[11px] text-slate-500 font-mono">
                  Independent Sensor Isolation Active
                </span>
              </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {/* 1. ESP32 / Device Connection */}
            <Card id="status-card-esp32" className="py-3 px-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  ESP32 Controller
                </span>
                <Cpu className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="my-2">
                <Badge
                  id="badge-status-esp32"
                  variant={!isOnline ? 'offline' : isStale ? 'stale' : 'online'}
                  dot
                >
                  {!isOnline ? 'Offline' : isStale ? 'Stale' : 'Online'}
                </Badge>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block">
                {isOnline ? `${device?.display_name || 'Core 0/1 active'} (v${configVersion})` : 'Timeout exceeded'}
              </span>
            </Card>

            {/* 2. Wi-Fi Connection */}
            <Card id="status-card-wifi" className="py-3 px-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Wi-Fi Link
                </span>
                <Wifi className="w-4 h-4 text-sky-400" />
              </div>
              <div className="my-2">
                <Badge
                  id="badge-status-wifi"
                  variant={sensorHealth.wifi.status === 'connected' ? 'online' : 'offline'}
                  dot
                >
                  {sensorHealth.wifi.status === 'connected'
                    ? sensorHealth.wifi.rssi_dbm !== null
                      ? `${sensorHealth.wifi.rssi_dbm} dBm`
                      : 'Connected'
                    : 'Offline'}
                </Badge>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block">
                {sensorHealth.wifi.status === 'connected' ? 'HTTPS Ingest OK' : 'No Wi-Fi Link'}
              </span>
            </Card>

            {/* 3. ADXL345 Vibration Sensor */}
            <Card id="status-card-adxl345" className="py-3 px-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  ADXL345 Vibration
                </span>
                <Activity className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="my-2">
                <Badge
                  id="badge-status-adxl345"
                  variant={getStatusBadgeVariant(sensorHealth.adxl345)}
                  dot
                >
                  {getStatusLabel(sensorHealth.adxl345)}
                </Badge>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block">
                {sensorHealth.adxl345 === 'ready' ? 'I2C 0x53 • 200 Hz' : 'I2C Not Detected'}
              </span>
            </Card>

            {/* 4. Motor Temp Probe */}
            <Card id="status-card-motor-probe" className="py-3 px-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Motor DS18B20
                </span>
                <Thermometer className="w-4 h-4 text-rose-400" />
              </div>
              <div className="my-2">
                <Badge
                  id="badge-status-motor-probe"
                  variant={getStatusBadgeVariant(sensorHealth.motor_temp)}
                  dot
                >
                  {getStatusLabel(sensorHealth.motor_temp)}
                </Badge>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block">
                {sensorHealth.motor_temp === 'ready' ? 'Stator (GPIO 10)' : 'Missing (GPIO 10)'}
              </span>
            </Card>

            {/* 5. Ambient Temp Probe */}
            <Card id="status-card-ambient-probe" className="py-3 px-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Ambient DS18B20
                </span>
                <Thermometer className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="my-2">
                <Badge
                  id="badge-status-ambient-probe"
                  variant={getStatusBadgeVariant(sensorHealth.ambient_temp)}
                  dot
                >
                  {getStatusLabel(sensorHealth.ambient_temp)}
                </Badge>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block">
                {sensorHealth.ambient_temp === 'ready' ? 'Ambient (GPIO 11)' : 'Missing (GPIO 11)'}
              </span>
            </Card>

            {/* 6. MicroSD Offline Storage */}
            <Card id="status-card-sdcard" className="py-3 px-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  MicroSD Buffer
                </span>
                <HardDrive className="w-4 h-4 text-amber-400" />
              </div>
              <div className="my-2">
                <Badge
                  id="badge-status-sdcard"
                  variant={getSdBadgeVariant(sdCardState, unsyncedCount)}
                  dot
                >
                  {getSdLabel(sdCardState, unsyncedCount)}
                </Badge>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block">
                {sdCardState === 'ready' ? (unsyncedCount > 0 ? `${unsyncedCount} unsynced` : 'Queue Synced') : 'SPI FSPI'}
              </span>
            </Card>

            {/* 7. DS3231 RTC Clock */}
            <Card id="status-card-rtc" className="py-3 px-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  DS3231 RTC
                </span>
                <Clock className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="my-2">
                <Badge
                  id="badge-status-rtc"
                  variant={getRtcBadgeVariant(rtcState, rtcSynced)}
                  dot
                >
                  {getRtcLabel(rtcState, rtcSynced)}
                </Badge>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block">
                {rtcState === 'ready' ? (rtcSynced ? 'I2C 0x68 (NTP Valid)' : 'I2C 0x68 (Local RTC)') : 'I2C 0x68 Missing'}
              </span>
            </Card>

            {/* 8. Last Successful Telemetry */}
            <Card id="status-card-last-telemetry" className="py-3 px-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Last Telemetry
                </span>
                <Activity className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="my-2">
                <span className="text-xs font-mono font-bold text-slate-200 block truncate">
                  {lastSuccessfulTelemetry
                    ? new Date(lastSuccessfulTelemetry).toLocaleTimeString()
                    : '--:--:--'}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block">
                {formatAge(ageSeconds)}
              </span>
            </Card>
          </div>
        </div>

        {/* Section 1: Temperature Metrics */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-rose-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                Temperature Telemetry (DS18B20 Probes)
              </h2>
            </div>
            <Link
              href="/dashboard/live"
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium"
            >
              <span>View live curve</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              id="metric-motor-temp"
              title="Motor Surface Temp"
              value={motorTemp}
              unit="°C"
              subValue={
                isMotorCurrentAndValid
                  ? "Probe #1 (Submersible DS18B20 on stator)"
                  : sensorHealth.motor_temp === 'not_detected'
                    ? "Stator probe not detected on 1-Wire bus"
                    : "No recent telemetry"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={motorSensorState}
              icon={<Thermometer className="w-4 h-4 text-rose-400" />}
            />
            <MetricCard
              id="metric-ambient-temp"
              title="Ambient Room Temp"
              value={ambTemp}
              unit="°C"
              subValue={
                isAmbientCurrentAndValid
                  ? "Probe #2 (Ambient air reference)"
                  : sensorHealth.ambient_temp === 'not_detected'
                    ? "Ambient probe missing (motor monitoring unaffected)"
                    : "No recent telemetry"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={ambientSensorState}
              icon={<Thermometer className="w-4 h-4 text-cyan-400" />}
            />
            <MetricCard
              id="metric-temp-diff"
              title="Thermal Rise (ΔT)"
              value={tempDiff !== null ? `+${tempDiff}` : null}
              unit="°C"
              subValue={tempDiffSubValue}
              status={isStale ? 'stale' : 'normal'}
              sensorState={isMotorCurrentAndValid && isAmbientCurrentAndValid ? 'ready' : 'not_detected'}
              icon={<Gauge className="w-4 h-4 text-amber-400" />}
            />
          </div>
        </div>

        {/* Section 2: AC Vibration RMS */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Vibrate className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                AC Vibration RMS (ADXL345 High-Pass Filtered)
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-mono">Continuous 200 Hz RMS Summary</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              id="metric-rms-x"
              title="RMS Vibration X-Axis"
              value={rmsX}
              unit="g"
              subValue={
                isAdxlCurrentAndValid
                  ? "Radial horizontal vibration component"
                  : sensorHealth.adxl345 === 'not_detected'
                    ? "ADXL345 not detected on I2C"
                    : "No recent vibration telemetry"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={adxlSensorState}
              icon={<Vibrate className="w-4 h-4 text-sky-400" />}
            />
            <MetricCard
              id="metric-rms-y"
              title="RMS Vibration Y-Axis"
              value={rmsY}
              unit="g"
              subValue={
                isAdxlCurrentAndValid
                  ? "Radial vertical vibration component"
                  : sensorHealth.adxl345 === 'not_detected'
                    ? "ADXL345 not detected on I2C"
                    : "No recent vibration telemetry"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={adxlSensorState}
              icon={<Vibrate className="w-4 h-4 text-purple-400" />}
            />
            <MetricCard
              id="metric-rms-z"
              title="RMS Vibration Z-Axis"
              value={rmsZ}
              unit="g"
              subValue={
                isAdxlCurrentAndValid
                  ? "Axial vibration component"
                  : sensorHealth.adxl345 === 'not_detected'
                    ? "ADXL345 not detected on I2C"
                    : "No recent vibration telemetry"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={adxlSensorState}
              icon={<Vibrate className="w-4 h-4 text-emerald-400" />}
            />
          </div>
        </div>

        {/* Section 3: Mean Acceleration (Static / Tilt / Orientation) */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                Mean Acceleration (Gravity & Orientation)
              </h2>
            </div>
            <span className="text-xs text-slate-500">Distinguished from AC Vibration RMS</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              id="metric-ax"
              title="Mean Accel X (ax)"
              value={ax}
              unit="g"
              subValue={
                isAdxlCurrentAndValid
                  ? "Static tilt / DC acceleration component"
                  : "ADXL345 not detected on I2C"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={adxlSensorState}
            />
            <MetricCard
              id="metric-ay"
              title="Mean Accel Y (ay)"
              value={ay}
              unit="g"
              subValue={
                isAdxlCurrentAndValid
                  ? "Static tilt / DC acceleration component"
                  : "ADXL345 not detected on I2C"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={adxlSensorState}
            />
            <MetricCard
              id="metric-az"
              title="Mean Accel Z (az)"
              value={az}
              unit="g"
              subValue={
                isAdxlCurrentAndValid
                  ? "Static gravity reference vector (~1.0g baseline)"
                  : "ADXL345 not detected on I2C"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={adxlSensorState}
            />
          </div>
        </div>

        {/* Section 4: Sampling Diagnostics & Bus Health */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                Sampling Diagnostics & Bus Health
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-mono">200 Hz Sampling Cadence</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <MetricCard
              id="metric-sample-count"
              title="Window Sample Count"
              value={sampleCount}
              unit="samples"
              subValue={
                isOnline
                  ? "Target: ~1,000 samples per 5-sec window"
                  : "No recent telemetry"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={isOnline && !isStale && sampleCount !== null ? 'ready' : 'no_data'}
              icon={<Activity className="w-4 h-4 text-emerald-400" />}
            />
            <MetricCard
              id="metric-acquisition-quality"
              title="Acquisition Quality"
              value={acquisitionQuality}
              unit=""
              subValue={
                isOnline
                  ? "Core 0 scheduler timer completion ratio"
                  : "No recent telemetry"
              }
              status={isStale ? 'stale' : 'normal'}
              sensorState={isOnline && !isStale && acquisitionQuality !== null ? 'ready' : 'no_data'}
              icon={<Gauge className="w-4 h-4 text-cyan-400" />}
            />
            <MetricCard
              id="metric-i2c-errors"
              title="I²C Bus Errors"
              value={i2cErrors}
              unit="err"
              subValue={
                isOnline
                  ? Number(i2cErrors) === 0 ? "Clean communication with ADXL345 & DS3231" : "I2C bus retries occurred"
                  : "No recent telemetry"
              }
              status={isStale ? 'stale' : Number(i2cErrors) > 0 ? 'warning' : 'normal'}
              sensorState={isOnline && !isStale ? (Number(i2cErrors) > 0 ? 'error' : 'ready') : 'no_data'}
              icon={<Cpu className="w-4 h-4 text-rose-400" />}
            />
            <MetricCard
              id="metric-missed-slots"
              title="Missed Sample Slots"
              value={missedSlots}
              unit="slots"
              subValue={
                isOnline
                  ? Number(missedSlots) === 0 ? "Full 200 Hz cadence maintained" : "Timer scheduling delays"
                  : "No recent telemetry"
              }
              status={isStale ? 'stale' : Number(missedSlots) > 0 ? 'warning' : 'normal'}
              sensorState={isOnline && !isStale ? (Number(missedSlots) > 0 ? 'error' : 'ready') : 'no_data'}
              icon={<Clock className="w-4 h-4 text-amber-400" />}
            />
            <MetricCard
              id="metric-queue-depth"
              title="MicroSD Buffer Queue"
              value={String(unsyncedCount)}
              unit="records"
              subValue={
                sdCardState !== 'ready'
                  ? `SD Card: ${getSdLabel(sdCardState, unsyncedCount)}`
                  : unsyncedCount === 0
                    ? "All offline records synchronized"
                    : `Oldest pending: ${oldestPendingTimestamp ? new Date(oldestPendingTimestamp).toLocaleTimeString() : 'In queue'}`
              }
              status={unsyncedCount > 0 ? 'warning' : 'normal'}
              sensorState={sdCardState === 'ready' ? 'ready' : 'no_data'}
              icon={<HardDrive className="w-4 h-4 text-amber-400" />}
            />
            <MetricCard
              id="metric-measurement-time"
              title="Physical Sample Time (RTC)"
              value={measuredAt ? new Date(measuredAt).toLocaleTimeString() : '--:--:--'}
              unit=""
              subValue={
                rtcState === 'ready'
                  ? rtcSynced
                    ? "DS3231 (NTP synchronized)"
                    : "DS3231 (RTC hardware time)"
                  : "RTC not detected on I2C"
              }
              status={rtcState === 'ready' ? 'normal' : 'warning'}
              sensorState={rtcState === 'ready' ? 'ready' : 'no_data'}
              icon={<Clock className="w-4 h-4 text-indigo-400" />}
            />
          </div>
        </div>

        {/* Section 5: Interactive Two-Way Command & LED Diagnostics */}
        <LedCommandCenter deviceId={deviceId} isOnline={isOnline} />
      </div>
    )}

        {/* Footer Quick Action Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-slate-900/60 border border-slate-800 rounded-xl">
          <div className="text-xs text-slate-400">
            <p className="font-semibold text-slate-300">Continuous Sampling Architecture</p>
            <p>ESP32 samples ADXL345 at 200 Hz non-blocking, posting periodic statistical summaries over HTTPS.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/live">
              <Button variant="primary" size="sm">
                Open Real-Time Charts
              </Button>
            </Link>
            <Link href="/dashboard/history">
              <Button variant="outline" size="sm">
                Analytics & CSV Export
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
