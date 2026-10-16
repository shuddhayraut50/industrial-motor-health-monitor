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

export interface AccelerationChartProps {
  data: TelemetryRecord[];
  height?: number;
}

export const AccelerationChart: React.FC<AccelerationChartProps> = ({
  data,
  height = 280,
}) => {
  const formattedData = data.map((d) => ({
    time: new Date(d.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ax: Number(d.ax_g),
    ay: Number(d.ay_g),
    az: Number(d.az_g),
  }));

  if (formattedData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-slate-500 text-sm italic border border-dashed border-slate-800 rounded-xl"
        style={{ height }}
      >
        No acceleration measurements recorded in selected window
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
            domain={['auto', 'auto']}
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
              `${Number(value).toFixed(4)} g (Mean)`,
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
            dataKey="ax"
            name="Mean Accel X (ax)"
            stroke="#f59e0b"
            strokeWidth={1.8}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ay"
            name="Mean Accel Y (ay)"
            stroke="#ec4899"
            strokeWidth={1.8}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="az"
            name="Mean Accel Z (az)"
            stroke="#0ea5e9"
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
