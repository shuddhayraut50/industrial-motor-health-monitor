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

export interface TemperatureChartProps {
  data: TelemetryRecord[];
  height?: number;
}

export const TemperatureChart: React.FC<TemperatureChartProps> = ({
  data,
  height = 280,
}) => {
  const formattedData = data.map((d) => {
    const hasMotor = d.motor_temp_c !== null && d.motor_temp_c !== undefined && Number.isFinite(Number(d.motor_temp_c));
    const hasAmb = d.ambient_temp_c !== null && d.ambient_temp_c !== undefined && Number.isFinite(Number(d.ambient_temp_c));
    return {
      time: new Date(d.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      motor_temp: hasMotor ? Number(d.motor_temp_c) : null,
      ambient_temp: hasAmb ? Number(d.ambient_temp_c) : null,
      diff: hasMotor && hasAmb ? Number((Number(d.motor_temp_c) - Number(d.ambient_temp_c)).toFixed(2)) : null,
    };
  });

  if (formattedData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-slate-500 text-sm italic border border-dashed border-slate-800 rounded-xl"
        style={{ height }}
      >
        No temperature measurements recorded in selected window
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
            unit="°C"
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
            formatter={(value: unknown, name: unknown) => {
              if (name === 'motor_temp') return [`${Number(value).toFixed(2)} °C`, 'Motor Temp'];
              if (name === 'ambient_temp') return [`${Number(value).toFixed(2)} °C`, 'Ambient Temp'];
              return [String(value), String(name)];
            }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            wrapperStyle={{ paddingBottom: '10px', fontSize: '12px' }}
          />
          <Line
            type="monotone"
            dataKey="motor_temp"
            name="Motor Temp"
            stroke="#f43f5e"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ambient_temp"
            name="Ambient Temp"
            stroke="#06b6d4"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
