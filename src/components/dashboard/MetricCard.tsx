import React from 'react';
import { Card } from '../ui/Card';
import { clsx } from 'clsx';

export interface MetricCardProps {
  title: string;
  value: string | number | null;
  unit?: string;
  subValue?: string;
  status?: 'normal' | 'warning' | 'alert' | 'stale';
  sensorState?: 'ready' | 'not_detected' | 'error' | 'no_data';
  icon?: React.ReactNode;
  id?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  unit,
  subValue,
  status = 'normal',
  sensorState,
  icon,
  id,
}) => {
  const isAvailable = value !== null && value !== undefined;

  const valueColors = {
    normal: 'text-slate-100',
    warning: 'text-amber-400',
    alert: 'text-rose-400',
    stale: 'text-slate-500',
  };

  const glowMapping = {
    normal: 'none' as const,
    warning: 'amber' as const,
    alert: 'rose' as const,
    stale: 'none' as const,
  };

  const renderUnavailableState = () => {
    if (sensorState === 'not_detected') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-2xl font-mono text-slate-600">--</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase bg-amber-950/80 text-amber-300 border border-amber-800/60">
            Not detected
          </span>
        </div>
      );
    }
    if (sensorState === 'error') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-2xl font-mono text-slate-600">--</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase bg-rose-950/80 text-rose-300 border border-rose-800/60">
            Sensor error
          </span>
        </div>
      );
    }
    if (sensorState === 'no_data') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-2xl font-mono text-slate-600">--</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase bg-slate-800 text-slate-400 border border-slate-700">
            No recent data
          </span>
        </div>
      );
    }
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-mono text-slate-600">--</span>
        <span className="text-xs text-slate-500 italic">No signal</span>
      </div>
    );
  };

  return (
    <Card id={id} glow={isAvailable ? glowMapping[status] : 'none'} className="flex flex-col justify-between">
      <div className="flex items-center justify-between text-slate-400 mb-2">
        <span className="text-xs uppercase font-medium tracking-wider">{title}</span>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>

      <div className="my-2">
        {isAvailable ? (
          <div className="flex items-baseline gap-1.5">
            <span className={clsx('text-3xl font-mono font-bold tracking-tight', valueColors[status])}>
              {value}
            </span>
            {unit && <span className="text-slate-400 text-sm font-sans">{unit}</span>}
          </div>
        ) : (
          renderUnavailableState()
        )}
      </div>

      {subValue && (
        <div className="text-xs text-slate-400 mt-1 flex items-center gap-1 border-t border-slate-800/80 pt-2">
          {subValue}
        </div>
      )}
    </Card>
  );
};
