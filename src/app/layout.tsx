import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Industrial Motor Health Monitoring Platform',
  description: 'Production-structured IoT health telemetry for ESP32-S3 motor monitoring prototype',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
