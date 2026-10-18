'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  DeviceDiagnosticEvent,
  DiagnosticComponent,
  DiagnosticSeverity,
} from '@/lib/types/events';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Filter,
  HardDrive,
  Info,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Thermometer,
  Wifi,
  Zap,
} from 'lucide-react';

interface DeviceEventsHistoryProps {
  deviceId: string;
  isOnline: boolean;
  isStale: boolean;
  lastSeenAt?: string | null;
}

export function DeviceEventsHistory({
  deviceId,
  isOnline,
  isStale,
  lastSeenAt,
}: DeviceEventsHistoryProps) {
  const [events, setEvents] = useState<DeviceDiagnosticEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<DiagnosticComponent | 'all'>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<DiagnosticSeverity | 'all'>('all');
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const [nowMs, setNowMs] = useState<number>(0);

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    setNowMs(Date.now());
    try {
      const params = new URLSearchParams({
        device_id: deviceId,
        limit: '60',
      });
      if (selectedComponent !== 'all') params.append('component', selectedComponent);
      if (selectedSeverity !== 'all') params.append('severity', selectedSeverity);
      if (unresolvedOnly) params.append('unresolved_only', 'true');

      const res = await fetch(`/api/device/events?${params.toString()}`, {
        cache: 'no-store',
      });

      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (e) {
      console.error('[EVENTS_FETCH_ERROR]', e);
    } finally {
      setIsLoading(false);
    }
  }, [deviceId, selectedComponent, selectedSeverity, unresolvedOnly]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (isMounted) await fetchEvents();
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [fetchEvents]);

  // Derive component state summary table from the latest events per component
  const componentSummaries = useMemo(() => {
    const components: DiagnosticComponent[] = [
      'esp32',
      'wifi',
      'api',
      'adxl345',
      'motor_temp',
      'ambient_temp',
      'sd_card',
      'rtc',
      'classifier',
      'command',
    ];

    return components.map((comp) => {
      const compEvents = events.filter((e) => e.component === comp);
      const latestEvent = compEvents[0] || null;
      const lastErrorEvent = compEvents.find((e) => e.severity === 'error' || e.severity === 'critical') || null;
      const lastRecoveryEvent = compEvents.find(
        (e) => e.resolved || e.event_code.endsWith('_RECOVERED') || e.event_code.endsWith('_CONNECTED') || e.event_code.endsWith('_ONLINE')
      ) || null;

      const currentState = latestEvent?.new_state || 'unknown';
      let freshness: 'fresh' | 'stale' | 'unknown' = 'unknown';

      if (latestEvent && nowMs > 0) {
        const ageMs = nowMs - new Date(latestEvent.event_timestamp).getTime();
        if (ageMs < 45000 && (isOnline || !isStale)) {
          freshness = 'fresh';
        } else if (ageMs < 300000) {
          freshness = 'stale';
        } else {
          freshness = 'unknown';
        }
      }

      // If the entire controller is offline, we mark the freshness as stale/unknown
      if (!isOnline && !isStale) {
        freshness = 'unknown';
      }

      return {
        component: comp,
        currentState,
        freshness,
        lastVerifiedTime: latestEvent?.event_timestamp || null,
        lastTransitionTime: latestEvent ? latestEvent.event_timestamp : null,
        lastError: lastErrorEvent ? `${lastErrorEvent.event_code} (${lastErrorEvent.diagnostic_message})` : null,
        recoveryTime: lastRecoveryEvent ? lastRecoveryEvent.event_timestamp : null,
      };
    });
  }, [events, isOnline, isStale, nowMs]);

  const getSeverityBadgeVariant = (severity: DiagnosticSeverity) => {
    switch (severity) {
      case 'critical':
        return 'offline';
      case 'error':
        return 'offline';
      case 'warning':
        return 'warning';
      case 'info':
      default:
        return 'info';
    }
  };

  const getComponentIcon = (comp: DiagnosticComponent) => {
    switch (comp) {
      case 'esp32':
        return <Cpu className="w-3.5 h-3.5 text-cyan-400" />;
      case 'wifi':
        return <Wifi className="w-3.5 h-3.5 text-sky-400" />;
      case 'api':
        return <Radio className="w-3.5 h-3.5 text-emerald-400" />;
      case 'adxl345':
        return <Activity className="w-3.5 h-3.5 text-indigo-400" />;
      case 'motor_temp':
      case 'ambient_temp':
        return <Thermometer className="w-3.5 h-3.5 text-rose-400" />;
      case 'sd_card':
        return <HardDrive className="w-3.5 h-3.5 text-amber-400" />;
      case 'rtc':
        return <Zap className="w-3.5 h-3.5 text-purple-400" />;
      case 'classifier':
        return <ShieldAlert className="w-3.5 h-3.5 text-yellow-400" />;
      case 'command':
        return <RotateCcw className="w-3.5 h-3.5 text-blue-400" />;
      default:
        return <Info className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const formatIsoDate = (iso?: string | null) => {
    if (!iso) return 'Never';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <Card className="p-5 border-slate-800 bg-slate-900/90 shadow-xl space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-semibold text-slate-100">
              Device Diagnostics & Component Event History
            </h3>
            <Badge variant={isOnline ? 'online' : isStale ? 'stale' : 'offline'} dot className="ml-1">
              {isOnline ? 'Live Edge Ingest' : isStale ? 'Delayed Ingest' : 'Controller Offline'}
            </Badge>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Edge-triggered transition logs and fault isolation across all 10 hardware subsystems
            {lastSeenAt ? ` • Last device contact: ${formatIsoDate(lastSeenAt)}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={fetchEvents}
            disabled={isLoading}
            className="text-xs h-8 px-2.5 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Filter className="w-3.5 h-3.5 text-cyan-400" />
          <span>Filters:</span>
        </div>

        {/* Component Filter */}
        <select
          value={selectedComponent}
          onChange={(e) => setSelectedComponent(e.target.value as DiagnosticComponent | 'all')}
          className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-md px-2.5 py-1 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
        >
          <option value="all">All Components</option>
          <option value="esp32">ESP32 Runtime</option>
          <option value="wifi">Wi-Fi Link</option>
          <option value="api">HTTPS / API</option>
          <option value="adxl345">ADXL345 Vibration</option>
          <option value="motor_temp">Motor Temp (GPIO 10)</option>
          <option value="ambient_temp">Ambient Temp (GPIO 11)</option>
          <option value="sd_card">MicroSD / Storage</option>
          <option value="rtc">DS3231 RTC</option>
          <option value="classifier">Vibration Classifier</option>
          <option value="command">Two-Way Command</option>
        </select>

        {/* Severity Filter */}
        <select
          value={selectedSeverity}
          onChange={(e) => setSelectedSeverity(e.target.value as DiagnosticSeverity | 'all')}
          className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-md px-2.5 py-1 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
        >
          <option value="all">All Severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          <option value="critical">Critical</option>
        </select>

        {/* Unresolved Only toggle */}
        <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 ml-auto">
          <input
            type="checkbox"
            checked={unresolvedOnly}
            onChange={(e) => setUnresolvedOnly(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500 h-3.5 w-3.5"
          />
          <span>Active Faults Only</span>
        </label>
      </div>

      {/* Component Status Matrix */}
      <div className="bg-slate-950/40 rounded-lg border border-slate-800/80 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Component Health & Verification Matrix
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {componentSummaries.map((item) => (
            <div
              key={item.component}
              className="p-2 rounded bg-slate-900/80 border border-slate-800 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[10px] font-mono text-slate-400 uppercase truncate">
                  {item.component}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded font-mono uppercase ${
                    item.freshness === 'fresh'
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50'
                      : item.freshness === 'stale'
                      ? 'bg-amber-950/80 text-amber-300 border border-amber-800/50'
                      : 'bg-slate-800/80 text-slate-400 border border-slate-700/50'
                  }`}
                >
                  {item.freshness}
                </span>
              </div>
              <div className="text-xs font-semibold text-slate-200 truncate">
                {item.currentState}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 truncate">
                {item.lastVerifiedTime ? `Checked: ${formatIsoDate(item.lastVerifiedTime)}` : 'No transitions'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Event Timeline List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400 font-mono px-1">
          <span>EVENT TIMELINE ({events.length} RECORDED)</span>
          <span>NEWEST FIRST</span>
        </div>

        {events.length === 0 ? (
          <div className="p-8 text-center bg-slate-950/40 rounded-lg border border-slate-800/60 text-slate-400 text-sm">
            {isLoading ? 'Loading diagnostic events...' : 'No diagnostic events found matching current criteria.'}
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((ev) => {
              const isExpanded = expandedEventId === ev.id;
              const hasDelayedSync =
                ev.server_received_at &&
                ev.event_timestamp &&
                Math.abs(new Date(ev.server_received_at).getTime() - new Date(ev.event_timestamp).getTime()) > 30000;

              return (
                <div
                  key={ev.id}
                  className="rounded-lg border border-slate-800/90 bg-slate-950/70 p-3 hover:border-slate-700 transition-colors"
                >
                  <div
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                    onClick={() => setExpandedEventId(isExpanded ? null : ev.id)}
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="p-1.5 rounded bg-slate-900 border border-slate-800">
                        {getComponentIcon(ev.component)}
                      </span>
                      <span className="font-mono text-xs font-bold text-slate-200">
                        {ev.event_code}
                      </span>
                      <Badge variant={getSeverityBadgeVariant(ev.severity)} className="text-[10px] py-0 px-2">
                        {ev.severity}
                      </Badge>

                      {/* State transition indicator */}
                      <span className="font-mono text-[11px] text-slate-400 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">
                        {ev.previous_state || 'none'} → <strong className="text-cyan-300">{ev.new_state}</strong>
                      </span>

                      {/* Resolved vs Active indicator */}
                      {ev.resolved ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40 font-mono">
                          <CheckCircle2 className="w-3 h-3" /> Resolved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40 font-mono">
                          <AlertTriangle className="w-3 h-3" /> Active
                        </span>
                      )}

                      {/* Offline delayed sync indicator */}
                      {hasDelayedSync && (
                        <span className="text-[10px] text-sky-400 bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-800/40 font-mono">
                          Buffered Sync
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto text-xs text-slate-400 font-mono">
                      <span>{formatIsoDate(ev.event_timestamp)}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-slate-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                  </div>

                  {/* Diagnostic Message */}
                  <div className="text-xs text-slate-300 mt-2 pl-2 sm:pl-8 break-words">
                    {ev.diagnostic_message}
                  </div>

                  {/* Expanded Details Drawer */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 pl-2 sm:pl-8 space-y-2 text-xs font-mono text-slate-300 break-words">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-900/80 p-2.5 rounded border border-slate-800">
                        <div>
                          <span className="text-slate-500 block text-[10px]">EVENT ID:</span>
                          <span className="text-slate-300 select-all">{ev.id}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">TIMESTAMP SOURCE:</span>
                          <span className="text-cyan-400 uppercase">{ev.timestamp_source}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">DEVICE TIMESTAMP:</span>
                          <span>{ev.event_timestamp}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">SERVER RECEIPT:</span>
                          <span>{ev.server_received_at || 'In-Memory / Synchronous'}</span>
                        </div>
                        {ev.firmware_version && (
                          <div>
                            <span className="text-slate-500 block text-[10px]">FIRMWARE VERSION:</span>
                            <span>{ev.firmware_version}</span>
                          </div>
                        )}
                      </div>

                      {ev.details && Object.keys(ev.details).length > 0 && (
                        <div className="bg-slate-900/90 p-2.5 rounded border border-slate-800">
                          <span className="text-slate-500 block text-[10px] mb-1">NUMERIC & STATE DETAILS:</span>
                          <pre className="text-[11px] text-cyan-300 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(ev.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
