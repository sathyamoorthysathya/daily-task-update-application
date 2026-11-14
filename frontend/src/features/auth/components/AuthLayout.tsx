import type { ReactNode } from 'react';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Clean, centered authentication layout for Sign In, Registration, and Password Reset.
 */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="auth-page">
      <main className="auth-card">
        <div className="auth-card-header">
          <div className="auth-brand-badge">
            <span className="brand-logo" aria-hidden="true">
              DT
            </span>
            <span className="brand-name">Daily Task Update</span>
          </div>

          <h1 className="auth-card-title">{title}</h1>
          {subtitle && <p className="auth-card-subtitle">{subtitle}</p>}
        </div>

        <div className="auth-card-body">{children}</div>

        {footer && <div className="auth-footer">{footer}</div>}
      </main>
    </div>
  );
}
