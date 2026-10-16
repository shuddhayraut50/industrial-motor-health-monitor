'use client';

import React, { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled dashboard boundary error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
      <div className="p-4 bg-rose-950/60 border border-rose-800/80 rounded-2xl mb-4 text-rose-400">
        <AlertTriangle className="w-10 h-10" />
      </div>
      <h1 className="text-2xl font-bold text-white mb-2 font-mono">Telemetry Portal Error</h1>
      <p className="text-sm text-slate-400 max-w-md mb-6">
        An unexpected error occurred while rendering the motor monitoring interface.
      </p>
      <Button variant="primary" onClick={() => reset()}>
        <RefreshCw className="w-4 h-4 mr-2" />
        Retry Operation
      </Button>
    </div>
  );
}
