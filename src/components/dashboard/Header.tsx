'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LogOut, RefreshCw, Cpu } from 'lucide-react';

export interface HeaderProps {
  deviceId: string;
  onDeviceChange?: (newId: string) => void;
  isOnline: boolean;
  isStale: boolean;
  lastUpdated?: string | null;
  onManualRefresh?: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  deviceId,
  onDeviceChange,
  isOnline,
  isStale,
  lastUpdated,
  onManualRefresh,
  isRefreshing = false,
}) => {
  const router = useRouter();

  const handleSignOut = () => {
    // Clear any local session and navigate to /login
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_user');
      document.cookie = 'sb-auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    }
    router.push('/login');
  };

  const statusVariant = !isOnline ? 'offline' : isStale ? 'stale' : 'online';
  const statusLabel = !isOnline ? 'Offline' : isStale ? 'Stale' : 'Live Ingestion';

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-950/70 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Left: Device Selector & Status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-cyan-400" />
          <div className="relative">
            <select
              id="device-selector"
              value={deviceId}
              onChange={(e) => onDeviceChange?.(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono font-medium rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-cyan-500 focus:outline-none cursor-pointer"
            >
              <option value="motor-monitor-001">motor-monitor-001 (Bench A)</option>
              <option value="motor-monitor-002">motor-monitor-002 (Bench B)</option>
            </select>
          </div>
        </div>

        <Badge variant={statusVariant} dot>
          {statusLabel}
        </Badge>

        {lastUpdated && (
          <span className="hidden md:inline-block text-[11px] text-slate-500 font-mono">
            Synced: {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        {onManualRefresh && (
          <Button
            id="refresh-button"
            variant="outline"
            size="sm"
            onClick={onManualRefresh}
            isLoading={isRefreshing}
            aria-label="Refresh telemetry data"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        )}

        <Button
          id="sign-out-button"
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="text-slate-400 hover:text-rose-400"
          aria-label="Sign out of dashboard"
        >
          <LogOut className="w-4 h-4 mr-1.5" />
          <span className="hidden sm:inline">Sign Out</span>
        </Button>
      </div>
    </header>
  );
};
