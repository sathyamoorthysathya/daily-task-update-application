import type { ReactNode } from 'react';

interface FormAlertProps {
  variant: 'error' | 'success' | 'info';
  children: ReactNode;
}

export function FormAlert({ variant, children }: FormAlertProps) {
  return (
    <div className={`alert alert--${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
