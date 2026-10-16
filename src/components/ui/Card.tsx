import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: 'cyan' | 'emerald' | 'amber' | 'rose' | 'none';
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  glow = 'none',
  ...props
}) => {
  const glowClasses = {
    none: '',
    cyan: 'glow-cyan border-cyan-500/30',
    emerald: 'glow-emerald border-emerald-500/30',
    amber: 'glow-amber border-amber-500/30',
    rose: 'border-rose-500/30',
  };

  return (
    <div
      className={twMerge(
        clsx(
          'bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl p-5 transition-all duration-200 shadow-lg',
          glowClasses[glow],
          className
        )
      )}
      {...props}
    >
      {children}
    </div>
  );
};
