'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Cpu,
  History,
  Radio,
  Sliders,
  ShieldCheck,
} from 'lucide-react';
import { clsx } from 'clsx';

export const Sidebar: React.FC = () => {
  const pathname = usePathname();

  const navItems = [
    { name: 'Overview', href: '/dashboard', icon: Activity },
    { name: 'Live Monitoring', href: '/dashboard/live', icon: Radio },
    { name: 'Historical Analytics', href: '/dashboard/history', icon: History },
    { name: 'Device Details', href: '/dashboard/devices', icon: Cpu },
    { name: 'Monitoring Config', href: '/dashboard/settings', icon: Sliders },
  ];

  return (
    <aside className="w-64 bg-slate-950/90 border-r border-slate-800/80 flex flex-col justify-between p-4 flex-shrink-0 min-h-screen">
      <div>
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 py-4 mb-4 border-b border-slate-800/80">
          <div className="w-9 h-9 rounded-xl bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-white block">MOTOR HEALTH</span>
            <span className="text-[10px] text-cyan-400 font-mono tracking-wider uppercase block">Industrial IoT</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="space-y-1.5" aria-label="Main Navigation">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-medium transition-all duration-150',
                  isActive
                    ? 'bg-cyan-600/15 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                )}
              >
                <Icon className={clsx('w-4 h-4', isActive ? 'text-cyan-400' : 'text-slate-500')} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Hardware Status Card */}
        <div className="mt-8 bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-slate-400">
          <div className="flex items-center gap-2 mb-2 text-slate-300 font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Target Hardware</span>
          </div>
          <ul className="space-y-1 font-mono text-[11px] text-slate-400">
            <li>• ESP32-S3 DevKit M-1</li>
            <li>• ADXL345 (±16g, 200 Hz)</li>
            <li>• DS18B20 (Motor + Amb)</li>
          </ul>
        </div>
      </div>

      {/* Safety Notice */}
      <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-xl text-[10px] text-slate-500 leading-relaxed">
        <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1">Safety Notice</p>
        <p>Read-only health monitor prototype. Motor actuation or safety-critical commands are strictly not supported.</p>
      </div>
    </aside>
  );
};
