'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ConditionStatus, SensorState, StorageMedium } from '@/lib/types/telemetry';
import {
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
  Thermometer,
  Activity,
  HardDrive,
  ArrowRight,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';

interface SimpleMotorViewProps {
  conditionStatus: ConditionStatus;
  conditionReason: string;
  isOnline: boolean;
  isStale: boolean;
  motorTemp: string | null;
  ambientTemp: string | null;
  tempDiff: string | null;
  rmsZ: string | null;
  lastUpdated: string | null;
  storageMedium: StorageMedium;
  storageUsedPct?: number;
  droppedRecordsCount?: number;
  unsyncedRecords: number;
  motorSensorState: SensorState;
  ambientSensorState: SensorState;
  adxlSensorState: SensorState;
}

export function SimpleMotorView({
  conditionStatus,
  conditionReason,
  isOnline,
  isStale,
  motorTemp,
  ambientTemp,
  tempDiff,
  rmsZ,
  lastUpdated,
  storageMedium,
  storageUsedPct = 0,
  droppedRecordsCount = 0,
  unsyncedRecords,
  motorSensorState,
  ambientSensorState,
  adxlSensorState,
}: SimpleMotorViewProps) {
  // Determine effective operator condition: if offline or stale or sensors missing, never falsely show GOOD
  const isHealthyDisplayAllowed =
    isOnline &&
    !isStale &&
    motorSensorState === 'ready' &&
    adxlSensorState === 'ready';
  const effectiveCondition: ConditionStatus =
    !isHealthyDisplayAllowed && conditionStatus === 'GOOD'
      ? 'UNKNOWN'
      : conditionStatus;

  const getConditionBannerConfig = () => {
    switch (effectiveCondition) {
      case 'GOOD':
        return {
          title: 'MOTOR HEALTHY — NORMAL OPERATION',
          sub: 'Vibration and thermal rise are well within configured safe operational limits.',
          color: 'text-emerald-400',
          bg: 'bg-emerald-950/40 border-emerald-500/40',
          badgeVariant: 'online' as const,
          icon: <CheckCircle className="w-9 h-9 text-emerald-400" />,
          action: 'Continue normal monitoring. Routine monthly physical inspection recommended.',
        };
      case 'CHECK':
        return {
          title: 'CAUTION — OPERATIONAL CHECK ADVISED',
          sub: conditionReason || 'Slight elevation in vibration or temperature detected above nominal baseline.',
          color: 'text-amber-400',
          bg: 'bg-amber-950/40 border-amber-500/40',
          badgeVariant: 'warning' as const,
          icon: <AlertTriangle className="w-9 h-9 text-amber-400" />,
          action: 'Schedule inspection within 7 days. Verify mechanical mountings and lubrication levels.',
        };
      case 'WARNING':
        return {
          title: 'WARNING — ELEVATED ANOMALY DETECTED',
          sub: conditionReason || 'Vibration or thermal rise has exceeded recommended warning threshold.',
          color: 'text-orange-400',
          bg: 'bg-orange-950/40 border-orange-500/40',
          badgeVariant: 'warning' as const,
          icon: <AlertTriangle className="w-9 h-9 text-orange-400" />,
          action: 'Immediate maintenance review required. Check shaft alignment, bearing noise, and load balance.',
        };
      case 'CRITICAL':
        return {
          title: 'CRITICAL ALARM — URGENT ACTION REQUIRED',
          sub: conditionReason || 'Dangerous vibration or stator overheating threshold reached!',
          color: 'text-rose-400',
          bg: 'bg-rose-950/60 border-rose-500/60 animate-pulse',
          badgeVariant: 'offline' as const,
          icon: <AlertOctagon className="w-9 h-9 text-rose-400" />,
          action: 'ALERT OPERATOR IMMEDIATELY: Halt motor operation or reduce load to prevent catastrophic mechanical failure.',
        };
      case 'UNKNOWN':
      default:
        return {
          title: !isOnline ? 'DEVICE OFFLINE — UNABLE TO EVALUATE' : 'CONDITION UNKNOWN / INSUFFICIENT DATA',
          sub: !isOnline
            ? 'Communication with the ESP32 monitor has timed out. Motor condition cannot be verified.'
            : isStale
              ? 'Telemetry data is stale. Waiting for fresh telemetry packet.'
              : conditionReason || 'Awaiting initial sensor data or sensor probe disconnect detected.',
          color: 'text-slate-300',
          bg: 'bg-slate-900/60 border-slate-700/60',
          badgeVariant: 'neutral' as const,
          icon: <HelpCircle className="w-9 h-9 text-slate-400" />,
          action: 'Check physical ESP32 power, Wi-Fi connectivity, and sensor wire attachments.',
        };
    }
  };

  const banner = getConditionBannerConfig();

  const getVibrationDescription = () => {
    if (!rmsZ || adxlSensorState !== 'ready') return 'Sensor Not Available';
    const val = parseFloat(rmsZ);
    if (val < 0.05) return 'Very Smooth / Nominal';
    if (val < 0.15) return 'Normal Operating Vibration';
    if (val < 0.35) return 'Moderate Vibration (Monitor)';
    return 'Severe Vibration (Check Coupling)';
  };

  const isDelayedData = unsyncedRecords > 0;

  return (
    <div className="space-y-6">
      {/* 1. Large High-Visibility Condition Banner */}
      <div className={`p-6 rounded-2xl border ${banner.bg} shadow-lg transition-all`}>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-slate-950/40 border border-white/5">
              {banner.icon}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-lg md:text-xl font-bold tracking-tight ${banner.color}`}>
                  {banner.title}
                </span>
                <Badge variant={banner.badgeVariant}>{effectiveCondition}</Badge>
              </div>
              <p className="text-sm text-slate-300 max-w-2xl">{banner.sub}</p>
            </div>
          </div>
          <div className="text-left md:text-right shrink-0">
            <span className="text-xs text-slate-400 uppercase tracking-wider block">Communication Status</span>
            <span className="font-mono text-xs font-semibold text-slate-200">
              {!isOnline ? '🔴 Device Offline' : isStale ? '🟡 Stale (>25s)' : '🟢 Active Real-Time'}
            </span>
            {isDelayedData && (
              <span className="text-[11px] text-amber-400 block mt-0.5">
                ⏳ Buffering ({unsyncedRecords} unsynced)
              </span>
            )}
          </div>
        </div>

        {/* Action Callout */}
        <div className="mt-4 pt-4 border-t border-white/10 flex items-start gap-2.5 text-xs text-slate-300">
          <Wrench className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
          <div>
            <strong className="text-cyan-300">Recommended Next Action: </strong>
            <span>{banner.action}</span>
          </div>
        </div>
      </div>

      {/* 2. Key Operator Metric Cards (No engineering jargon) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Motor Temp */}
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-semibold text-slate-400">Motor Casing Temp</span>
              <Thermometer className="w-5 h-5 text-rose-400" />
            </div>
            <div className="my-2">
              <span className="text-3xl font-bold font-mono text-slate-100">
                {motorTemp ? `${motorTemp} °C` : '--'}
              </span>
            </div>
          </div>
          <span className="text-xs text-slate-400">
            {motorSensorState === 'ready'
              ? 'Probe attached to motor casing'
              : 'Probe disconnected / missing'}
          </span>
        </Card>

        {/* Ambient Room Temp */}
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-semibold text-slate-400">Ambient Room Temp</span>
              <Thermometer className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="my-2">
              <span className="text-3xl font-bold font-mono text-slate-100">
                {ambientTemp ? `${ambientTemp} °C` : '--'}
              </span>
            </div>
          </div>
          <span className="text-xs text-slate-400">
            {ambientSensorState === 'ready'
              ? (tempDiff !== null ? `Thermal Rise: +${tempDiff} °C above room` : 'Ambient reference OK')
              : 'Ambient probe not detected (Motor monitoring unaffected)'}
          </span>
        </Card>

        {/* Vibration Status */}
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-semibold text-slate-400">Vibration Level</span>
              <Activity className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="my-2">
              <span className="text-xl font-bold text-slate-100 block truncate">
                {getVibrationDescription()}
              </span>
              <span className="text-xs font-mono text-slate-400">
                {rmsZ ? `Z-Axis RMS: ${rmsZ} g` : 'No reading'}
              </span>
            </div>
          </div>
          <span className="text-xs text-slate-400">
            {adxlSensorState === 'ready' ? 'Continuous 200 Hz sampling' : 'Vibration sensor unavailable'}
          </span>
        </Card>

        {/* Last Observation & Storage */}
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-semibold text-slate-400">Data Synchronization</span>
              <HardDrive className="w-5 h-5 text-amber-400" />
            </div>
            <div className="my-2">
              <span className="text-lg font-bold font-mono text-slate-100 block">
                {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '--:--:--'}
              </span>
              <span className="text-xs text-slate-400">
                {storageMedium === 'sd_card'
                  ? `MicroSD Storage (${storageUsedPct}% used)`
                  : storageMedium === 'flash_littlefs'
                    ? `Flash Fallback (${storageUsedPct}% used)`
                    : 'Storage Inactive'}
              </span>
            </div>
          </div>
          <span className="text-xs text-slate-400">
            {droppedRecordsCount > 0
              ? `⚠️ ${droppedRecordsCount} records dropped (90% ceiling reached)`
              : unsyncedRecords > 0
                ? `${unsyncedRecords} records queued locally`
                : 'All records synchronized'}
          </span>
        </Card>
      </div>

      {/* 3. Non-Technical Operator Guide Card */}
      <Card className="p-5 border-slate-800 bg-slate-900/40">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0" />
            <div className="text-xs text-slate-400">
              <span className="font-semibold text-slate-200 block">Need deep diagnostics, FFT, or raw sensor telemetry?</span>
              <span>Switch to Technical Mode using the toggle in the top bar to inspect GPIO pin levels, I²C error counters, and command queue histories.</span>
            </div>
          </div>
          <Link href="/dashboard/history" className="shrink-0">
            <span className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1">
              View 12h / 24h Trends <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </Link>
        </div>
      </Card>
    </div>
  );
}
