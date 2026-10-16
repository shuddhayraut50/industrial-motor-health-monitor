import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl mb-4 text-cyan-400">
        <AlertCircle className="w-10 h-10" />
      </div>
      <h1 className="text-3xl font-bold text-white mb-2 font-mono">404 - Page Not Found</h1>
      <p className="text-sm text-slate-400 max-w-md mb-6">
        The requested monitoring resource or route does not exist in the Industrial Motor Health Monitoring platform.
      </p>
      <Link href="/dashboard">
        <Button variant="primary">Return to Dashboard</Button>
      </Link>
    </div>
  );
}
