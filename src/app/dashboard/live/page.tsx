'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/dashboard/Header';
import { StaleWarningBanner } from '@/components/dashboard/StaleWarningBanner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TemperatureChart } from '@/components/charts/TemperatureChart';
import { VibrationRmsChart } from '@/components/charts/VibrationRmsChart';
import { AccelerationChart } from '@/components/charts/AccelerationChart';
import { TelemetryRecord } from '@/lib/types/telemetry';
import { Play, Pause, Thermometer, Vibrate, Gauge, Clock } from 'lucide-react';

export default function LiveMonitoringPage() {
  const [deviceId, setDeviceId] = useState('motor-monitor-001');
  const [windowSec, setWindowSec] = useState<number>(300); // default 5m
  const [records, setRecords] = useState<TelemetryRecord[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const [isStale, setIsStale] = useState(true);
  const [ageSeconds, setAgeSeconds] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const windowOptions = [
    { label: '1 Min', value: 60 },
    { label: '5 Min', value: 300 },
    { label: '15 Min', value: 900 },
    { label: '60 Min', value: 3600 },
  ];

  const fetchLiveData = useCallback(async (showIndicator = false) => {
    if (showIndicator) setIsRefreshing(true);
    try {
      const res = await fetch(
        `/api/telemetry/live?device_id=${encodeURIComponent(deviceId)}&window=${windowSec}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
        setIsOnline(data.is_online);
        setIsStale(data.is_stale);
        setAgeSeconds(data.age_seconds);
        setLastSynced(new Date().toISOString());
      }
    } catch (err) {
      console.error('Failed to query live telemetry:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [deviceId, windowSec]);

  useEffect(() => {
    let active = true;
    const runPoll = async () => {
      try {
        const res = await fetch(
          `/api/telemetry/live?device_id=${encodeURIComponent(deviceId)}&window=${windowSec}`,
          { cache: 'no-store' }
        );
        if (res.ok && active) {
          const data = await res.json();
          setRecords(data.records || []);
          setIsOnline(data.is_online);
          setIsStale(data.is_stale);
          setAgeSeconds(data.age_seconds);
          setLastSynced(new Date().toISOString());
        }
      } catch (err) {
        console.error('Failed to query live telemetry:', err);
      }
    };

    runPoll();
    if (isPaused) return;

    const interval = setInterval(runPoll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [deviceId, windowSec, isPaused]);

  const latestRecord = records.length > 0 ? records[records.length - 1] : null;

  return (
    <div>
      <Header
        deviceId={deviceId}
        onDeviceChange={setDeviceId}
        isOnline={isOnline}
        isStale={isStale}
        lastUpdated={lastSynced}
        onManualRefresh={() => fetchLiveData(true)}
        isRefreshing={isRefreshing}
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Warning banner if feed has stopped or gone stale */}
        <StaleWarningBanner
          isOnline={isOnline}
          isStale={isStale}
          ageSeconds={ageSeconds}
          lastSeenTimestamp={latestRecord?.recorded_at}
        />

        {/* Live Controls Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-slate-900/80 border border-slate-800 rounded-xl">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase font-medium text-slate-400">Time Window:</span>
            <div className="flex items-center gap-1.5" role="group" aria-label="Time window selection">
              {windowOptions.map((opt) => (
                <button
                  key={opt.value}
                  id={`window-btn-${opt.value}`}
                  onClick={() => setWindowSec(opt.value)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                    windowSec === opt.value
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Age of newest measurement */}
            <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                Signal Age: {ageSeconds !== null ? `${ageSeconds}s` : 'none'}
              </span>
            </div>

            {/* Polling Pause/Resume Toggle */}
            <Button
              id="pause-resume-btn"
              variant={isPaused ? 'outline' : 'secondary'}
              size="sm"
              onClick={() => setIsPaused(!isPaused)}
            >
              {isPaused ? (
                <>
                  <Play className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                  <span>Resume (3s)</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5 mr-1 text-amber-400" />
                  <span>Pause Polling</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Chart 1: Dual Temperature Trace */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Thermometer className="w-5 h-5 text-rose-400" />
              <div>
                <h3 className="text-sm font-semibold text-slate-200">
                  Temperature Trends (Dual DS18B20 Probes)
                </h3>
                <p className="text-xs text-slate-400">
                  Motor casing surface vs ambient room temperature in °C
                </p>
              </div>
            </div>
            {latestRecord && (
              <div className="text-right">
                <span className="text-xs text-slate-400 block">Latest Motor Temp</span>
                <span className="text-base font-mono font-bold text-rose-400">
                  {latestRecord.motor_temp_c} °C
                </span>
              </div>
            )}
          </div>
          <TemperatureChart data={records} height={300} />
        </Card>

        {/* Chart 2: AC Vibration RMS */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Vibrate className="w-5 h-5 text-cyan-400" />
              <div>
                <h3 className="text-sm font-semibold text-slate-200">
                  AC Vibration RMS (X, Y, Z Axes in g)
                </h3>
                <p className="text-xs text-slate-400">
                  ADXL345 dynamic AC RMS vibration computed continuously over 200 Hz samples
                </p>
              </div>
            </div>
            {latestRecord && (
              <div className="flex items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-slate-500 block">RMS X</span>
                  <span className="text-sky-400 font-bold">{latestRecord.rms_x_g} g</span>
                </div>
                <div>
                  <span className="text-slate-500 block">RMS Y</span>
                  <span className="text-purple-400 font-bold">{latestRecord.rms_y_g} g</span>
                </div>
                <div>
                  <span className="text-slate-500 block">RMS Z</span>
                  <span className="text-emerald-400 font-bold">{latestRecord.rms_z_g} g</span>
                </div>
              </div>
            )}
          </div>
          <VibrationRmsChart data={records} height={300} />
        </Card>

        {/* Chart 3: Mean Accelerations */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold text-slate-200">
                  Mean Acceleration Vector (ax, ay, az in g)
                </h3>
                <p className="text-xs text-slate-400">
                  Static tilt, orientation, and DC acceleration components in g
                </p>
              </div>
            </div>
            {latestRecord && (
              <div className="flex items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-slate-500 block">Ax</span>
                  <span className="text-amber-400 font-bold">{latestRecord.ax_g} g</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Ay</span>
                  <span className="text-pink-400 font-bold">{latestRecord.ay_g} g</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Az</span>
                  <span className="text-cyan-400 font-bold">{latestRecord.az_g} g</span>
                </div>
              </div>
            )}
          </div>
          <AccelerationChart data={records} height={280} />
        </Card>
      </div>
    </div>
  );
}
