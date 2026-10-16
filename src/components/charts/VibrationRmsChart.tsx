'use client';

import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { TelemetryRecord } from '@/lib/types/telemetry';

export interface VibrationRmsChartProps {
  data: TelemetryRecord[];
  height?: number;
}

export const VibrationRmsChart: React.FC<VibrationRmsChartProps> = ({
  data,
  height = 280,
}) => {
  const formattedData = data.map((d) => ({
    time: new Date(d.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    rms_x: Number(d.rms_x_g),
    rms_y: Number(d.rms_y_g),
    rms_z: Number(d.rms_z_g),
  }));

  if (formattedData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-slate-500 text-sm italic border border-dashed border-slate-800 rounded-xl"
        style={{ height }}
      >
        No AC vibration RMS measurements recorded in selected window
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={formattedData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="time"
            stroke="#64748b"
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={{ stroke: '#334155' }}
          />
          <YAxis
            stroke="#64748b"
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={{ stroke: '#334155' }}
            unit=" g"
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0f172a',
              borderColor: '#334155',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#f8fafc',
            }}
            formatter={(value: unknown, name: unknown) => [
              `${Number(value).toFixed(4)} g (RMS)`,
              String(name),
            ]}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            wrapperStyle={{ paddingBottom: '10px', fontSize: '12px' }}
          />
          <Line
            type="monotone"
            dataKey="rms_x"
            name="RMS X-axis"
            stroke="#38bdf8"
            strokeWidth={1.8}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="rms_y"
            name="RMS Y-axis"
            stroke="#a855f7"
            strokeWidth={1.8}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="rms_z"
            name="RMS Z-axis"
            stroke="#10b981"
            strokeWidth={1.8}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
