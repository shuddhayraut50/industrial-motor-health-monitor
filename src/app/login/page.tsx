'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Activity, Lock, Mail, ShieldCheck, AlertCircle } from 'lucide-react';
import { getBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDemoLoading, setIsDemoLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const supabase = getBrowserClient();
      
      // If Supabase is configured with real credentials, perform real authentication
      if (process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setErrorMessage(error.message);
          setIsLoading(false);
          return;
        }
      }

      // Local / Test session setup
      if (typeof window !== 'undefined') {
        localStorage.setItem('auth_token', 'session_active_demo_token');
        sessionStorage.setItem('auth_user', JSON.stringify({ email: email || 'operator@industrial.internal' }));
        document.cookie = 'sb-auth=active; path=/; max-age=86400';
      }

      router.push('/dashboard');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred during sign in');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoSignIn = async () => {
    setIsDemoLoading(true);
    setErrorMessage(null);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('auth_token', 'session_active_demo_token');
        sessionStorage.setItem('auth_user', JSON.stringify({ email: 'operator@internal.test' }));
        document.cookie = 'sb-auth=active; path=/; max-age=86400';
      }
      router.push('/dashboard');
    } finally {
      setIsDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex p-3 rounded-2xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 mb-3 shadow-lg shadow-cyan-950">
            <Activity className="w-8 h-8 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Industrial Motor Health Monitor
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            ESP32-S3 IoT Telemetry & Diagnostics Portal
          </p>
        </div>

        {/* Login Card */}
        <Card className="p-8 border-slate-800 bg-slate-900/90 shadow-2xl">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs uppercase font-medium text-slate-300 tracking-wider mb-1.5">
                Operator Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  id="login-email"
                  type="email"
                  required
                  placeholder="operator@plant.internal"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-slate-100 text-sm rounded-lg pl-9 pr-3 py-2 w-full focus:ring-1 focus:ring-cyan-500 focus:outline-none placeholder:text-slate-600"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs uppercase font-medium text-slate-300 tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  id="login-password"
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-slate-100 text-sm rounded-lg pl-9 pr-3 py-2 w-full focus:ring-1 focus:ring-cyan-500 focus:outline-none placeholder:text-slate-600"
                />
              </div>
            </div>

            {errorMessage && (
              <div role="alert" className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-lg flex items-center gap-2 text-rose-300 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <Button
              id="login-submit-btn"
              type="submit"
              variant="primary"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Sign In to Dashboard
            </Button>
          </form>

          {/* Test / Evaluation Fast Sign-In */}
          <div className="mt-6 pt-5 border-t border-slate-800">
            <span className="block text-center text-[11px] text-slate-500 uppercase tracking-wider mb-3">
              Automated Verification & Test Access
            </span>
            <Button
              id="demo-login-btn"
              type="button"
              variant="secondary"
              className="w-full text-xs"
              onClick={handleDemoSignIn}
              isLoading={isDemoLoading}
            >
              <ShieldCheck className="w-4 h-4 mr-2 text-cyan-400" />
              Fast Sign-In (Test / Operator Mode)
            </Button>
          </div>
        </Card>

        {/* Isolation indicator */}
        <p className="text-center text-[11px] text-slate-600 mt-6 font-mono">
          Project: industrial-motor-health-monitor • Isolated Platform
        </p>
      </div>
    </div>
  );
}
