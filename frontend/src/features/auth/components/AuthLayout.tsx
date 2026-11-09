import type { ReactNode } from 'react';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="auth-page">
      <main className="auth-card card">
        <p className="brand">Daily Task Update</p>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </main>
      {footer && <p className="auth-footer">{footer}</p>}
    </div>
  );
}
