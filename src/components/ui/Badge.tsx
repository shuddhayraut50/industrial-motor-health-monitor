import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'online' | 'offline' | 'stale' | 'neutral' | 'warning' | 'info';
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  className,
  variant = 'neutral',
  dot = false,
  ...props
}) => {
  const variants = {
    online: 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60',
    offline: 'bg-rose-950/80 text-rose-400 border-rose-800/60',
    stale: 'bg-amber-950/80 text-amber-400 border-amber-800/60',
    warning: 'bg-amber-950/80 text-amber-300 border-amber-800/60',
    info: 'bg-cyan-950/80 text-cyan-300 border-cyan-800/60',
    neutral: 'bg-slate-800/80 text-slate-300 border-slate-700/60',
  };

  const dotColors = {
    online: 'bg-emerald-400',
    offline: 'bg-rose-400',
    stale: 'bg-amber-400',
    warning: 'bg-amber-400',
    info: 'bg-cyan-400',
    neutral: 'bg-slate-400',
  };

  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border tracking-wide uppercase',
          variants[variant],
          className
        )
      )}
      {...props}
    >
      {dot && (
        <span
          className={clsx(
            'w-1.5 h-1.5 rounded-full animate-pulse',
            dotColors[variant]
          )}
        />
      )}
      {children}
    </span>
  );
};
