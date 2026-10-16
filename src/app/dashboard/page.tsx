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
  Radio,
  Clock,
  Cpu,
  Layers,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { TelemetryRecord, DeviceRecord } from '@/lib/types/telemetry';

export default function DashboardPage() {
  const [deviceId, setDeviceId] = useState('motor-monitor-001');
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [latest, setLatest] = useState<TelemetryRecord | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [isStale, setIsStale] = useState(true);
  const [ageSeconds, setAgeSeconds] = useState<number | null>(null);
  const [configVersion, setConfigVersion] = useState<number>(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const res = await fetch(`/api/telemetry/live?device_id=${encodeURIComponent(deviceId)}&window=300`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setDevice(data.device);
        setLatest(data.latest);
        setIsOnline(data.is_online);
        setIsStale(data.is_stale);
        setAgeSeconds(data.age_seconds);
        setConfigVersion(data.config_version);
        setLastSynced(new Date().toISOString());
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
          setDevice(data.device);
          setLatest(data.latest);
          setIsOnline(data.is_online);
          setIsStale(data.is_stale);
          setAgeSeconds(data.age_seconds);
          setConfigVersion(data.config_version);
          setLastSynced(new Date().toISOString());
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

  const motorTemp = latest ? Number(latest.motor_temp_c).toFixed(1) : null;
  const ambTemp = latest ? Number(latest.ambient_temp_c).toFixed(1) : null;
  const tempDiff = latest
    ? (Number(latest.motor_temp_c) - Number(latest.ambient_temp_c)).toFixed(1)
    : null;

  const rmsX = latest ? Number(latest.rms_x_g).toFixed(4) : null;
  const rmsY = latest ? Number(latest.rms_y_g).toFixed(4) : null;
  const rmsZ = latest ? Number(latest.rms_z_g).toFixed(4) : null;

  const ax = latest ? Number(latest.ax_g).toFixed(3) : null;
  const ay = latest ? Number(latest.ay_g).toFixed(3) : null;
  const az = latest ? Number(latest.az_g).toFixed(3) : null;

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
        {/* Stale or Disconnected Warning Banner */}
        <StaleWarningBanner
          isOnline={isOnline}
          isStale={isStale}
          ageSeconds={ageSeconds}
          lastSeenTimestamp={latest?.recorded_at}
        />

        {/* Top Status & Summary Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="flex items-center gap-4 py-4">
            <div className="p-3 bg-cyan-950/60 text-cyan-400 border border-cyan-800/60 rounded-xl">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Target Device</span>
              <span className="text-sm font-mono font-bold text-slate-200 block">{deviceId}</span>
              <span className="text-[11px] text-slate-500">{device?.display_name || 'ESP32-S3 DevKit'}</span>
            </div>
          </Card>

          <Card className="flex items-center gap-4 py-4">
            <div className="p-3 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Connection State</span>
              <div className="mt-0.5">
                <Badge variant={!isOnline ? 'offline' : isStale ? 'stale' : 'online'} dot>
                  {!isOnline ? 'Disconnected' : isStale ? 'Stale' : 'Streaming'}
                </Badge>
              </div>
              <span className="text-[11px] text-slate-500 mt-1 block">
                {ageSeconds !== null ? `${ageSeconds}s since last packet` : 'No packets'}
              </span>
            </div>
          </Card>

          <Card className="flex items-center gap-4 py-4">
            <div className="p-3 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Firmware / Config</span>
              <span className="text-sm font-mono font-medium text-slate-200 block">
                {latest?.firmware_version || 'v1.0.0-esp32s3'}
              </span>
              <span className="text-[11px] text-slate-500">Config Ver: v{configVersion}</span>
            </div>
          </Card>

          <Card className="flex items-center gap-4 py-4">
            <div className="p-3 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Authoritative Time</span>
              <span className="text-sm font-mono font-bold text-slate-200 block">
                {latest ? new Date(latest.recorded_at).toLocaleTimeString() : '--:--:--'}
              </span>
              <span className="text-[11px] text-slate-500">Server Ingestion Time</span>
            </div>
          </Card>
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
              subValue="Probe #1 (Submersible DS18B20 on stator)"
              status={isStale ? 'stale' : 'normal'}
              icon={<Thermometer className="w-4 h-4 text-rose-400" />}
            />
            <MetricCard
              id="metric-ambient-temp"
              title="Ambient Room Temp"
              value={ambTemp}
              unit="°C"
              subValue="Probe #2 (Ambient air reference)"
              status={isStale ? 'stale' : 'normal'}
              icon={<Thermometer className="w-4 h-4 text-cyan-400" />}
            />
            <MetricCard
              id="metric-temp-diff"
              title="Thermal Rise (ΔT)"
              value={tempDiff !== null ? `+${tempDiff}` : null}
              unit="°C"
              subValue="Motor Temp minus Ambient Temp"
              status={isStale ? 'stale' : 'normal'}
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
              subValue="Radial horizontal vibration component"
              status={isStale ? 'stale' : 'normal'}
              icon={<Vibrate className="w-4 h-4 text-sky-400" />}
            />
            <MetricCard
              id="metric-rms-y"
              title="RMS Vibration Y-Axis"
              value={rmsY}
              unit="g"
              subValue="Radial vertical vibration component"
              status={isStale ? 'stale' : 'normal'}
              icon={<Vibrate className="w-4 h-4 text-purple-400" />}
            />
            <MetricCard
              id="metric-rms-z"
              title="RMS Vibration Z-Axis"
              value={rmsZ}
              unit="g"
              subValue="Axial vibration component"
              status={isStale ? 'stale' : 'normal'}
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
              subValue="Static tilt / DC acceleration component"
              status={isStale ? 'stale' : 'normal'}
            />
            <MetricCard
              id="metric-ay"
              title="Mean Accel Y (ay)"
              value={ay}
              unit="g"
              subValue="Static tilt / DC acceleration component"
              status={isStale ? 'stale' : 'normal'}
            />
            <MetricCard
              id="metric-az"
              title="Mean Accel Z (az)"
              value={az}
              unit="g"
              subValue="Static gravity reference vector (~1.0g baseline)"
              status={isStale ? 'stale' : 'normal'}
            />
          </div>
        </div>

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
