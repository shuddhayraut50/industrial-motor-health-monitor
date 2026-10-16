'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/dashboard/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Sliders, ShieldAlert, RefreshCw, Key } from 'lucide-react';
import { DeviceConfig, DeviceConfigAck } from '@/lib/types/config';

export default function SettingsPage() {
  const [deviceId, setDeviceId] = useState('motor-monitor-001');
  const [intervalMs, setIntervalMs] = useState(1000);
  const [enabledFields, setEnabledFields] = useState<string[]>([
    'motor_temp_c',
    'ambient_temp_c',
    'ax_g',
    'ay_g',
    'az_g',
    'rms_x_g',
    'rms_y_g',
    'rms_z_g',
  ]);
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [latestAck, setLatestAck] = useState<DeviceConfigAck | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const availableFields = [
    { id: 'motor_temp_c', label: 'Motor Temperature (°C)' },
    { id: 'ambient_temp_c', label: 'Ambient Temperature (°C)' },
    { id: 'ax_g', label: 'Mean Accel X (g)' },
    { id: 'ay_g', label: 'Mean Accel Y (g)' },
    { id: 'az_g', label: 'Mean Accel Z (g)' },
    { id: 'rms_x_g', label: 'AC Vibration RMS X (g)' },
    { id: 'rms_y_g', label: 'AC Vibration RMS Y (g)' },
    { id: 'rms_z_g', label: 'AC Vibration RMS Z (g)' },
  ];

  const fetchConfig = async () => {
    try {
      const res = await fetch(`/api/device/config?device_id=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setLatestAck(data.latest_ack);
        setIsPending(data.is_pending);
        if (data.config) {
          setIntervalMs(data.config.reporting_interval_ms);
          setEnabledFields(data.config.enabled_fields || []);
        }
      }
    } catch (err) {
      console.error('Failed to load device config:', err);
    }
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch(`/api/device/config?device_id=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
        if (res.ok && active) {
          const data = await res.json();
          setConfig(data.config);
          setLatestAck(data.latest_ack);
          setIsPending(data.is_pending);
          if (data.config) {
            setIntervalMs(data.config.reporting_interval_ms);
            setEnabledFields(data.config.enabled_fields || []);
          }
        }
      } catch (err) {
        console.error('Failed to load device config:', err);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [deviceId]);

  const toggleField = (fieldId: string) => {
    if (enabledFields.includes(fieldId)) {
      if (enabledFields.length > 1) {
        setEnabledFields(enabledFields.filter((f) => f !== fieldId));
      }
    } else {
      setEnabledFields([...enabledFields, fieldId]);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch('/api/device/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          reporting_interval_ms: Number(intervalMs),
          enabled_fields: enabledFields,
          configuration_json: {
            updated_by: 'dashboard_operator',
            adxl345_filter: 'high_pass_enabled',
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setIsPending(true);
        setSaveMessage('New configuration version deployed! Waiting for ESP32 acknowledgment.');
      } else {
        const errData = await res.json();
        setSaveMessage(`Error: ${errData.message || 'Failed to update config'}`);
      }
    } catch {
      setSaveMessage('Network error updating configuration');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <Header deviceId={deviceId} onDeviceChange={setDeviceId} isOnline={true} isStale={false} />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Safety Disclaimer Banner */}
        <div className="p-4 bg-rose-950/40 border border-rose-800/60 rounded-xl flex items-start gap-3 text-rose-200">
          <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs">
            <h4 className="font-semibold text-rose-100 uppercase tracking-wide">
              Mandatory Industrial Safety Disclaimer
            </h4>
            <p className="mt-1 text-rose-300/90 leading-relaxed">
              This system is strictly a <strong>passive, read-only health monitor</strong>. Remote motor actuation, relay switching, start/stop commands, or machine speed control are strictly prohibited and not supported in this architecture. All configuration parameters here are non-actuating monitoring settings only (e.g. telemetry rate, enabled metrics).
            </p>
          </div>
        </div>

        {/* Remote Configuration Form */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-5 h-5 text-cyan-400" />
              <div>
                <h3 className="text-base font-semibold text-white">Monitoring Telemetry Configuration</h3>
                <p className="text-xs text-slate-400">Settings will be pulled by ESP32-S3 upon next sync check</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-400">
                Active Ver: <strong className="text-cyan-400">v{config?.config_version ?? 1}</strong>
                {latestAck && (
                  <span className="ml-1 text-slate-500">
                    (Ack: v{latestAck.acknowledged_config_version})
                  </span>
                )}
              </span>
              <Badge variant={isPending ? 'warning' : 'online'}>
                {isPending ? 'Sync Pending' : 'Hardware Acknowledged'}
              </Badge>
            </div>
          </div>

          <form onSubmit={handleSaveConfig} className="space-y-6">
            <div>
              <label htmlFor="reporting-interval" className="block text-xs uppercase font-semibold text-slate-300 tracking-wider mb-2">
                HTTPS Telemetry Reporting Interval (ms)
              </label>
              <select
                id="reporting-interval"
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 w-full max-w-xs focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              >
                <option value={500}>500 ms (2.0 Hz high frequency)</option>
                <option value={1000}>1000 ms (1.0 Hz standard default)</option>
                <option value={2000}>2000 ms (0.5 Hz reduced bandwidth)</option>
                <option value={5000}>5000 ms (0.2 Hz low bandwidth)</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Internal 200 Hz sensor sampling is continuous and unaffected by this network reporting interval.
              </p>
            </div>

            <div>
              <span className="block text-xs uppercase font-semibold text-slate-300 tracking-wider mb-2">
                Enabled Telemetry Channels
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {availableFields.map((field) => {
                  const isChecked = enabledFields.includes(field.id);
                  return (
                    <label
                      key={field.id}
                      className={`flex items-center gap-2.5 p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-slate-800/80 border-cyan-500/50 text-cyan-200'
                          : 'bg-slate-950/60 border-slate-800 text-slate-500'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleField(field.id)}
                        className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                      />
                      <span>{field.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {saveMessage && (
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs text-cyan-300 font-mono">
                {saveMessage}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button id="save-config-btn" type="submit" variant="primary" isLoading={isSaving}>
                Save & Deploy New Version
              </Button>
              <Button type="button" variant="outline" onClick={fetchConfig}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                Reload
              </Button>
            </div>
          </form>
        </Card>

        {/* Security & Token Rotation Guide */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Key className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-semibold text-slate-200">Device Ingestion Security & Rotation</h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            The ESP32-S3 communicates securely over HTTPS using the dedicated device ingestion token header (<code>x-device-token</code>).
            To rotate the secret:
          </p>
          <ol className="list-decimal list-inside text-xs text-slate-400 space-y-1.5 mt-2 font-mono">
            <li>Generate a new 32+ character random hex token.</li>
            <li>Update <code>DEVICE_INGEST_TOKEN</code> in Vercel project environment variables.</li>
            <li>Flash the new token into the ESP32 firmware <code>DEVICE_TOKEN</code> definition.</li>
            <li>Verify incoming packets reflect the new timestamp in the dashboard.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
