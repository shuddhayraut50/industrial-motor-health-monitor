'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/dashboard/Header';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Cpu, Shield } from 'lucide-react';
import { DeviceRecord, TelemetryRecord } from '@/lib/types/telemetry';
import { DeviceConfig, DeviceConfigAck } from '@/lib/types/config';

interface EnrichedDevice {
  device: DeviceRecord;
  latest: TelemetryRecord | null;
  config: DeviceConfig | null;
  ack: DeviceConfigAck | null;
  is_online: boolean;
  is_stale: boolean;
  age_seconds: number | null;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<EnrichedDevice[]>([]);
  const [selectedId, setSelectedId] = useState('motor-monitor-001');

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch('/api/devices', { cache: 'no-store' });
        if (res.ok && active) {
          const data = await res.json();
          setDevices(data.devices || []);
        }
      } catch (err) {
        console.error('Failed to fetch devices', err);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, []);

  const selectedDevice = devices.find((d) => d.device.device_id === selectedId) || devices[0];

  return (
    <div>
      <Header deviceId={selectedId} onDeviceChange={setSelectedId} isOnline={true} isStale={false} />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">Registered IoT Monitoring Hardware</h2>
          <p className="text-xs text-slate-400 mt-1">
            Physical device registry, current firmware revisions, and connection status.
          </p>
        </div>

        {/* Device Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {devices.map((item) => {
            const dev = item.device;
            const isSelected = dev.device_id === selectedId;
            return (
              <Card
                key={dev.device_id}
                className={`cursor-pointer transition-all ${
                  isSelected ? 'border-cyan-500/60 ring-1 ring-cyan-500/40 bg-slate-900/90' : 'hover:border-slate-700'
                }`}
                onClick={() => setSelectedId(dev.device_id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-cyan-950/70 border border-cyan-800/60 rounded-xl text-cyan-400">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-100 text-sm">{dev.display_name}</h3>
                      <p className="font-mono text-xs text-cyan-400">{dev.device_id}</p>
                    </div>
                  </div>

                  <Badge variant={!item.is_online ? 'offline' : item.is_stale ? 'stale' : 'online'} dot>
                    {!item.is_online ? 'Offline' : item.is_stale ? 'Stale' : 'Online'}
                  </Badge>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">Machine / Location</span>
                    <span className="text-slate-300 font-medium">{dev.location || 'Test Bench'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Last Seen</span>
                    <span className="text-slate-300 font-mono">
                      {dev.last_seen_at ? new Date(dev.last_seen_at).toLocaleTimeString() : 'Never'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Firmware Version</span>
                    <span className="text-slate-300 font-mono">{item.latest?.firmware_version || 'v1.0.0-esp32s3'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Configuration Version</span>
                    <span className="text-slate-300 font-mono">v{item.config?.config_version ?? 1}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Selected Device Deep-Dive */}
        {selectedDevice && (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Shield className="w-5 h-5 text-cyan-400" />
              <h3 className="text-base font-semibold text-white">
                Detailed Telemetry Profile: {selectedDevice.device.device_id}
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
              <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <span className="font-semibold text-slate-300 uppercase tracking-wider block">
                  Hardware Specifications
                </span>
                <p className="text-slate-400">
                  <strong className="text-slate-300">Microcontroller:</strong> ESP32-S3 DevKit M-1 (N16R8, Dual Core Xtensa LX7)
                </p>
                <p className="text-slate-400">
                  <strong className="text-slate-300">Accelerometer:</strong> ADXL345 (±16g range, I2C / SPI, 200 Hz continuous sampling)
                </p>
                <p className="text-slate-400">
                  <strong className="text-slate-300">Thermal Probes:</strong> 2x Waterproof DS18B20 1-Wire sensors (Motor stator + Ambient)
                </p>
              </div>

              <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <span className="font-semibold text-slate-300 uppercase tracking-wider block">
                  Latest Ingested State
                </span>
                {selectedDevice.latest ? (
                  <>
                    <p className="text-slate-400">
                      <strong className="text-slate-300">Motor Temp:</strong> {selectedDevice.latest.motor_temp_c} °C
                    </p>
                    <p className="text-slate-400">
                      <strong className="text-slate-300">Ambient Temp:</strong> {selectedDevice.latest.ambient_temp_c} °C
                    </p>
                    <p className="text-slate-400">
                      <strong className="text-slate-300">AC RMS Vibration:</strong> X: {selectedDevice.latest.rms_x_g}g | Y: {selectedDevice.latest.rms_y_g}g | Z: {selectedDevice.latest.rms_z_g}g
                    </p>
                    <p className="text-slate-400">
                      <strong className="text-slate-300">Mean Accel:</strong> {selectedDevice.latest.ax_g}g, {selectedDevice.latest.ay_g}g, {selectedDevice.latest.az_g}g
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500 italic">No telemetry packets received yet.</p>
                )}
              </div>

              <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <span className="font-semibold text-slate-300 uppercase tracking-wider block">
                  Configuration Synchronization
                </span>
                <p className="text-slate-400">
                  <strong className="text-slate-300">Configured Version:</strong> v{selectedDevice.config?.config_version ?? 1}
                </p>
                <p className="text-slate-400">
                  <strong className="text-slate-300">Acknowledged by Device:</strong> v{selectedDevice.ack?.acknowledged_config_version ?? 1}
                </p>
                <p className="text-slate-400">
                  <strong className="text-slate-300">Reporting Interval:</strong> {selectedDevice.config?.reporting_interval_ms ?? 1000} ms
                </p>
                <div className="pt-2">
                  <Badge variant={selectedDevice.ack?.status === 'acknowledged' ? 'online' : 'warning'}>
                    {selectedDevice.ack?.status === 'acknowledged' ? 'Config Synced' : 'Sync Pending'}
                  </Badge>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
