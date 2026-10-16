'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/dashboard/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TemperatureChart } from '@/components/charts/TemperatureChart';
import { VibrationRmsChart } from '@/components/charts/VibrationRmsChart';
import { TelemetryRecord, TelemetryStats } from '@/lib/types/telemetry';
import { Download, Filter, Calendar, BarChart2, Table as TableIcon } from 'lucide-react';

export default function HistoryPage() {
  const [deviceId, setDeviceId] = useState('motor-monitor-001');
  const [metricTab, setMetricTab] = useState<'both' | 'temperature' | 'vibration'>('both');
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [records, setRecords] = useState<TelemetryRecord[]>([]);
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const startIso = startDate ? new Date(startDate).toISOString() : '';
      const endIso = endDate ? new Date(endDate).toISOString() : '';
      const res = await fetch(
        `/api/telemetry/history?device_id=${encodeURIComponent(deviceId)}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=1000`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
        setStats(data.stats || null);
        setCurrentPage(1);
      }
    } catch (err) {
      console.error('Failed to fetch historical telemetry:', err);
    } finally {
      setIsLoading(false);
    }
  }, [deviceId, startDate, endDate]);

  useEffect(() => {
    let active = true;
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 16);
    const defaultEnd = now.toISOString().slice(0, 16);

    const s = startDate || defaultStart;
    const e = endDate || defaultEnd;

    if (!startDate) setStartDate(defaultStart);
    if (!endDate) setEndDate(defaultEnd);

    const run = async () => {
      try {
        const startIso = new Date(s).toISOString();
        const endIso = new Date(e).toISOString();
        const res = await fetch(
          `/api/telemetry/history?device_id=${encodeURIComponent(deviceId)}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=1000`,
          { cache: 'no-store' }
        );
        if (res.ok && active) {
          const data = await res.json();
          setRecords(data.records || []);
          setStats(data.stats || null);
          setCurrentPage(1);
        }
      } catch (err) {
        console.error('Failed to fetch historical telemetry:', err);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [deviceId, startDate, endDate]);

  const handleExportCsv = () => {
    const startIso = startDate ? new Date(startDate).toISOString() : '';
    const endIso = endDate ? new Date(endDate).toISOString() : '';
    const url = `/api/telemetry/history?device_id=${encodeURIComponent(deviceId)}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&format=csv`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `motor_telemetry_${deviceId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Pagination
  const totalPages = Math.ceil(records.length / pageSize) || 1;
  const paginatedRecords = records.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      <Header deviceId={deviceId} onDeviceChange={setDeviceId} isOnline={true} isStale={false} />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Date Filter & Export Bar */}
        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Time Range:</span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="start-date" className="text-slate-400">From:</label>
              <input
                id="start-date"
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="end-date" className="text-slate-400">To:</label>
              <input
                id="end-date"
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>

            <Button
              id="apply-filter-btn"
              variant="secondary"
              size="sm"
              onClick={fetchHistory}
              isLoading={isLoading}
            >
              <Filter className="w-3.5 h-3.5 mr-1" />
              Apply Filter
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <a
              id="export-csv-btn"
              href={`/api/telemetry/history?device_id=${encodeURIComponent(deviceId)}&start=${encodeURIComponent(startDate ? new Date(startDate).toISOString() : '')}&end=${encodeURIComponent(endDate ? new Date(endDate).toISOString() : '')}&format=csv`}
              download={`motor_telemetry_${deviceId}.csv`}
              className="inline-flex items-center justify-center font-medium rounded-lg text-xs px-3 py-1.5 gap-1.5 bg-transparent hover:bg-slate-800/60 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5 mr-1 text-cyan-400" />
              Export CSV
            </a>
          </div>
        </div>

        {/* Statistical Aggregate Cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-4">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Sample Count</span>
              <span className="text-2xl font-mono font-bold text-slate-100 block mt-1">
                {stats.sample_count}
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">Valid Ingested Packets</span>
            </Card>

            <Card className="p-4">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Motor Temp (Min / Max / Avg)</span>
              <span className="text-lg font-mono font-bold text-rose-400 block mt-1">
                {stats.motor_temp.avg} °C
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Min: {stats.motor_temp.min} °C | Max: {stats.motor_temp.max} °C
              </span>
            </Card>

            <Card className="p-4">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Thermal Delta ΔT Avg</span>
              <span className="text-lg font-mono font-bold text-amber-400 block mt-1">
                +{stats.temp_diff.avg} °C
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Peak ΔT: +{stats.temp_diff.max} °C
              </span>
            </Card>

            <Card className="p-4">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">RMS Vibration Z-Axis</span>
              <span className="text-lg font-mono font-bold text-emerald-400 block mt-1">
                {stats.rms_z.avg} g
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Max RMS: {stats.rms_z.max} g
              </span>
            </Card>
          </div>
        )}

        {/* Metric Mode Filter Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setMetricTab('both')}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
              metricTab === 'both' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Metrics
          </button>
          <button
            onClick={() => setMetricTab('temperature')}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
              metricTab === 'temperature' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Temperature Only
          </button>
          <button
            onClick={() => setMetricTab('vibration')}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
              metricTab === 'vibration' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Vibration RMS Only
          </button>
        </div>

        {/* Historical Charts */}
        {(metricTab === 'both' || metricTab === 'temperature') && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-rose-400" />
                <h3 className="text-sm font-semibold text-slate-200">Historical Temperature Trend (°C)</h3>
              </div>
              <span className="text-xs text-slate-500 font-mono">{records.length} records</span>
            </div>
            <TemperatureChart data={records} height={260} />
          </Card>
        )}

        {(metricTab === 'both' || metricTab === 'vibration') && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-200">Historical AC RMS Vibration (g)</h3>
              </div>
              <span className="text-xs text-slate-500 font-mono">X, Y, Z Axes in g</span>
            </div>
            <VibrationRmsChart data={records} height={260} />
          </Card>
        )}

        {/* Historical Telemetry Data Table */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TableIcon className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-200">Persisted Records Log</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Page {currentPage} of {totalPages}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Timestamp (UTC)</th>
                  <th className="py-2.5 px-3">Motor (°C)</th>
                  <th className="py-2.5 px-3">Ambient (°C)</th>
                  <th className="py-2.5 px-3">ΔT (°C)</th>
                  <th className="py-2.5 px-3">RMS X (g)</th>
                  <th className="py-2.5 px-3">RMS Y (g)</th>
                  <th className="py-2.5 px-3">RMS Z (g)</th>
                  <th className="py-2.5 px-3">Ax (g)</th>
                  <th className="py-2.5 px-3">Ay (g)</th>
                  <th className="py-2.5 px-3">Az (g)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {paginatedRecords.length > 0 ? (
                  paginatedRecords.map((r) => {
                    const diff = (Number(r.motor_temp_c) - Number(r.ambient_temp_c)).toFixed(2);
                    return (
                      <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2 px-3 text-slate-300">
                          {new Date(r.recorded_at).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-rose-400">{r.motor_temp_c}</td>
                        <td className="py-2 px-3 text-cyan-400">{r.ambient_temp_c}</td>
                        <td className="py-2 px-3 text-amber-400">+{diff}</td>
                        <td className="py-2 px-3 text-sky-400">{r.rms_x_g}</td>
                        <td className="py-2 px-3 text-purple-400">{r.rms_y_g}</td>
                        <td className="py-2 px-3 text-emerald-400">{r.rms_z_g}</td>
                        <td className="py-2 px-3 text-slate-400">{r.ax_g}</td>
                        <td className="py-2 px-3 text-slate-400">{r.ay_g}</td>
                        <td className="py-2 px-3 text-slate-400">{r.az_g}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500 italic">
                      No historical records found for this period. Try expanding your date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-xs text-slate-400">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
