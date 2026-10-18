'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Cpu,
  History,
  Radio,
  Sliders,
  ShieldCheck,
  Menu,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = [
    { name: 'Overview', href: '/dashboard', icon: Activity },
    { name: 'Live Monitoring', href: '/dashboard/live', icon: Radio },
    { name: 'Historical Analytics', href: '/dashboard/history', icon: History },
    { name: 'Device Details', href: '/dashboard/devices', icon: Cpu },
    { name: 'Monitoring Config', href: '/dashboard/settings', icon: Sliders },
  ];

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <>
      {/* =========================================================================
          MOBILE TOP BAR (Visible only on screens < md)
         ========================================================================= */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-slate-950/95 border-b border-slate-800/80 sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <span className="font-bold text-xs tracking-tight text-white block">MOTOR HEALTH</span>
            <span className="text-[9px] text-cyan-400 font-mono tracking-wider uppercase block">Industrial IoT</span>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleMobileMenu}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          aria-label={isMobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
          aria-expanded={isMobileMenuOpen}
        >
          {isMobileMenuOpen ? <X className="w-5 h-5 text-rose-400" /> : <Menu className="w-5 h-5 text-cyan-400" />}
        </button>
      </div>

      {/* MOBILE DRAWER / OVERLAY */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-slate-950/95 backdrop-blur-md pt-16 px-4 pb-6 flex flex-col justify-between overflow-y-auto">
          <div>
            <nav className="space-y-2 mt-2" aria-label="Mobile Navigation">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMobileMenu}
                    className={clsx(
                      'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all min-h-[44px]',
                      isActive
                        ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-slate-900/80 border border-transparent'
                    )}
                  >
                    <Icon className={clsx('w-5 h-5', isActive ? 'text-cyan-400' : 'text-slate-400')} />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-6 bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-400">
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

          <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-xl text-[11px] text-slate-500 leading-relaxed mt-6">
            <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1">Safety Notice</p>
            <p>Read-only health monitor prototype. Motor actuation or safety-critical commands are strictly not supported.</p>
          </div>
        </div>
      )}

      {/* =========================================================================
          DESKTOP SIDEBAR (Visible on screens >= md)
         ========================================================================= */}
      <aside className="hidden md:flex w-64 bg-slate-950/90 border-r border-slate-800/80 flex-col justify-between p-4 flex-shrink-0 min-h-screen">
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
          <nav className="space-y-1.5" aria-label="Main Desktop Navigation">
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
    </>
  );
};
