import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';

export interface StaleWarningBannerProps {
  isStale: boolean;
  isOnline: boolean;
  ageSeconds: number | null;
  lastSeenTimestamp?: string | null;
}

export const StaleWarningBanner: React.FC<StaleWarningBannerProps> = ({
  isStale,
  isOnline,
  ageSeconds,
  lastSeenTimestamp,
}) => {
  if (isOnline && !isStale) {
    return null;
  }

  const formatAge = (sec: number | null) => {
    if (sec === null) return 'unknown';
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  };

  return (
    <div
      role="alert"
      id="stale-warning-banner"
      className="bg-amber-950/60 border border-amber-600/50 rounded-xl p-4 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-200"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-amber-900/60 rounded-lg text-amber-400">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-semibold text-sm text-amber-100">
            {!isOnline ? 'Device Offline / Disconnected' : 'Telemetry Feed Stale'}
          </h4>
          <p className="text-xs text-amber-300/80">
            Newest data packet is {formatAge(ageSeconds)} old. Displaying last known reading. Do not rely on stale numbers for live decisions.
          </p>
        </div>
      </div>

      {lastSeenTimestamp && (
        <div className="flex items-center gap-1.5 text-xs text-amber-300 font-mono bg-amber-900/40 px-3 py-1.5 rounded-lg border border-amber-800/60 self-stretch sm:self-auto justify-center">
          <Clock className="w-3.5 h-3.5" />
          <span>Last Seen: {new Date(lastSeenTimestamp).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
};
