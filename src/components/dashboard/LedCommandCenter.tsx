'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DeviceCommandRecord } from '@/lib/types/commands';
import { Lightbulb, Play, RotateCcw, AlertTriangle, CheckCircle2, Clock, XCircle, ShieldCheck } from 'lucide-react';

interface LedCommandCenterProps {
  deviceId: string;
  isOnline: boolean;
}

export function LedCommandCenter({ deviceId, isOnline }: LedCommandCenterProps) {
  const [activeCommand, setActiveCommand] = useState<DeviceCommandRecord | null>(null);
  const [commandHistory, setCommandHistory] = useState<DeviceCommandRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchCommandHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/device/commands?device_id=${encodeURIComponent(deviceId)}&limit=6`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setCommandHistory(data.commands || []);
        // If there's an active command being tracked, update it
        if (activeCommand) {
          const updated = (data.commands || []).find((c: DeviceCommandRecord) => c.id === activeCommand.id);
          if (updated) setActiveCommand(updated);
        }
      }
    } catch (e) {
      console.error('Failed to fetch command history', e);
    }
  }, [deviceId, activeCommand]);

  // Poll active command status
  useEffect(() => {
    let isMounted = true;
    const poll = async () => {
      if (isMounted) {
        await fetchCommandHistory();
      }
    };
    const initialTimer = setTimeout(poll, 0);
    const interval = setInterval(poll, 2500);
    return () => {
      isMounted = false;
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [fetchCommandHistory]);

  const sendCommand = async (commandType: string, parameters: Record<string, unknown> = {}) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/device/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          command_type: commandType,
          parameters,
          expires_in_seconds: 60,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch command');
      }

      setActiveCommand(data.command);
      fetchCommandHistory();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Command dispatch failed');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SUCCEEDED':
        return <Badge variant="online"><CheckCircle2 className="w-3 h-3 mr-1" /> Succeeded</Badge>;
      case 'EXECUTING':
      case 'ACKNOWLEDGED':
        return <Badge variant="warning"><RotateCcw className="w-3 h-3 mr-1 animate-spin" /> {status}</Badge>;
      case 'DELIVERED':
        return <Badge variant="neutral"><Clock className="w-3 h-3 mr-1" /> Delivered</Badge>;
      case 'QUEUED':
        return <Badge variant="neutral"><Clock className="w-3 h-3 mr-1" /> Queued</Badge>;
      case 'FAILED':
      case 'EXPIRED':
        return <Badge variant="offline"><XCircle className="w-3 h-3 mr-1" /> {status}</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  const testLeds = [
    { index: 1, gpio: 4, name: 'LED 1', desc: 'Vibration RMS Severity 1 / Normal' },
    { index: 2, gpio: 5, name: 'LED 2', desc: 'Vibration RMS Severity 2 / Caution' },
    { index: 3, gpio: 6, name: 'LED 3', desc: 'Vibration RMS Severity 3 / Warning' },
    { index: 4, gpio: 7, name: 'LED 4', desc: 'Vibration RMS Severity 4 / Critical' },
    { index: 5, gpio: 16, name: 'LED 5', desc: 'Fault / Flash Storage Fallback' },
  ];

  return (
    <Card className="p-5 space-y-5 border-slate-800 bg-slate-900/60">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Two-Way Command & LED Diagnostics</h3>
            <p className="text-xs text-slate-400">Trigger authorized test routines on physical ESP32-S3 GPIOs</p>
          </div>
        </div>
        {!isOnline && (
          <span className="text-[11px] text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2.5 py-1 rounded-md flex items-center gap-1 font-mono">
            <AlertTriangle className="w-3 h-3" /> Device Offline (Commands Queue for Reconnect)
          </span>
        )}
      </div>

      {errorMessage && (
        <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-xs text-rose-300">
          <strong>Error:</strong> {errorMessage}
        </div>
      )}

      {/* Sequential Test Routine & Quick Action */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-slate-950/60 border border-slate-800/90 rounded-xl space-y-3">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
            Sequential Full Chaser Test
          </span>
          <p className="text-xs text-slate-400">
            Sequentially illuminates LED 1 through 5 in safe 500 ms intervals while non-blocking 200 Hz vibration sampling continues uninterrupted.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              id="btn-test-all-leds"
              variant="primary"
              size="sm"
              disabled={isLoading}
              onClick={() => sendCommand('LED_TEST_ALL', { step_duration_ms: 500 })}
            >
              <Play className="w-3.5 h-3.5 mr-1" /> Run All 5 LEDs Chaser
            </Button>
            <Button
              id="btn-sensor-diagnostic"
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => sendCommand('SENSOR_DIAGNOSTIC')}
            >
              Sensor Diagnostics
            </Button>
          </div>
        </div>

        {/* Status Indication LEDs Reference */}
        <div className="p-4 bg-slate-950/60 border border-slate-800/90 rounded-xl space-y-2 text-xs">
          <span className="font-semibold text-slate-300 uppercase tracking-wider block">
            Dedicated Status LEDs (GPIO 17 & 18)
          </span>
          <div className="space-y-1.5 text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
              <span><strong className="text-emerald-400 font-mono">Green LED (GPIO 18):</strong> Normal operation, recent telemetry fresh (&le;25s), no active high alarms.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" />
              <span><strong className="text-rose-400 font-mono">Red LED (GPIO 17):</strong> Active high-priority condition, sensor failure, or critical threshold breach.</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
              <span><strong className="text-slate-400">Both Off:</strong> Device powered off or in unconfigured state. Never assume healthy when unlit.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Individual LED Test Buttons */}
      <div className="space-y-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
          Individual Test LEDs (GPIOs 4, 5, 6, 7, 16)
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
          {testLeds.map((led) => (
            <div key={led.index} className="p-3 bg-slate-950/40 border border-slate-800 rounded-lg flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">{led.name}</span>
                  <span className="text-[10px] font-mono text-cyan-400">GPIO {led.gpio}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-tight">{led.desc}</p>
              </div>
              <Button
                id={`btn-test-led-${led.index}`}
                variant="secondary"
                size="sm"
                className="mt-3 w-full text-xs"
                disabled={isLoading}
                onClick={() => sendCommand('LED_TEST_SINGLE', { led_index: led.index, duration_ms: 2000 })}
              >
                Pulse 2.0s
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Mandatory Physical Verification Notice */}
      <div className="p-3 bg-cyan-950/30 border border-cyan-800/40 rounded-lg text-xs text-cyan-300 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
        <div>
          <span className="font-semibold block text-cyan-200">Hardware Verification Clarification:</span>
          <span>
            Firmware acknowledgement proves the command was securely validated and the GPIO state was asserted. It does NOT prove the physical LED diode is illuminating unless verified by physical eye inspection or electrical feedback circuitry.
          </span>
        </div>
      </div>

      {/* Command Queue & Acknowledged History */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Command Execution & Acknowledgement History
          </span>
          <span className="text-[11px] text-slate-500 font-mono">Real-Time Two-Way Telemetry</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-2 px-3">Command ID</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Parameters</th>
                <th className="py-2 px-3">Dispatched</th>
                <th className="py-2 px-3">Completed / Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {commandHistory.length > 0 ? (
                commandHistory.map((cmd) => (
                  <tr key={cmd.id} className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-slate-300 truncate max-w-[120px]">{cmd.id}</td>
                    <td className="py-2 px-3 text-cyan-400 font-semibold">{cmd.command_type}</td>
                    <td className="py-2 px-3">{getStatusBadge(cmd.status)}</td>
                    <td className="py-2 px-3 text-slate-400 truncate max-w-[150px]">
                      {JSON.stringify(cmd.parameters)}
                    </td>
                    <td className="py-2 px-3 text-slate-400">
                      {new Date(cmd.created_at).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3 text-slate-300 truncate max-w-[180px]">
                      {cmd.result ? JSON.stringify(cmd.result) : (cmd.error_message || '--')}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500 italic">
                    No recent commands dispatched to this device.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
