import React from 'react';
import { Sidebar } from '@/components/dashboard/Sidebar';

export const metadata = {
  title: 'Industrial Motor Health Monitoring Platform',
  description: 'Real-time temperature and vibration health telemetry for ESP32-S3 industrial motor monitoring prototype',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-950 text-slate-100 overflow-x-hidden">
      {/* Sidebar navigation */}
      <Sidebar />

      {/* Main content body */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
