import { type FormEvent, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { ApiError, errorMessage } from '../../../lib/api/api-error';
import { AuthLayout } from '../../auth/components/AuthLayout';
import { adminRedirectTarget, useAdminAuth } from '../admin-auth-context';

export function AdminLoginPage() {
  const { login, notice, clearNotice } = useAdminAuth();
  const navigate = useNavigate();
  const locationState: unknown = useLocation().state;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; password?: string; code?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = {
      username: username.trim() ? undefined : 'Enter your admin username',
      password: password ? undefined : 'Enter your password',
      code: needsCode && !/^\d{6}$/.test(code.trim()) ? 'Enter the 6-digit code' : undefined,
    };
    setErrors(nextErrors);
    setFormError(null);
    if (nextErrors.username || nextErrors.password || nextErrors.code) {
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password, needsCode ? code.trim() : undefined);
      clearNotice();
      await navigate(adminRedirectTarget(locationState), { replace: true });
    } catch (error) {
      setSubmitting(false);
      if (error instanceof ApiError && error.code === 'TWO_FACTOR_REQUIRED') {
        setNeedsCode(true);
        setTimeout(() => codeRef.current?.focus(), 0);
        return;
      }
      if (error instanceof ApiError && error.code === 'TWO_FACTOR_INVALID') {
        setCode('');
        setErrors({ code: 'That code is not valid. Enter the current code from the app.' });
        codeRef.current?.focus();
        return;
      }
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        // Back to step one: the password was wrong.
        setNeedsCode(false);
        setCode('');
      }
      setFormError(errorMessage(error));
    }
  }

  return (
    <AuthLayout
      title={needsCode ? 'Two-step verification' : 'Admin sign-in'}
      subtitle={
        needsCode
          ? 'Open your authenticator app and enter the 6-digit code for Daily Task Update Admin.'
          : 'For administrators only. Sign in with your admin username and password.'
      }
      footer={<Link to="/login">Not an administrator? Go to the app sign-in</Link>}
    >
      {notice && <FormAlert variant="info">{notice}</FormAlert>}
      {formError && <FormAlert variant="error">{formError}</FormAlert>}

      <form className="form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <div hidden={needsCode}>
          <TextField
            label="Username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={errors.username}
            maxLength={64}
            required
          />
        </div>
        <div hidden={needsCode}>
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
            maxLength={128}
            required
          />
        </div>
        {needsCode && (
          <TextField
            ref={codeRef}
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, ''))}
            error={errors.code}
            hint="The code changes every 30 seconds."
            required
          />
        )}
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? 'Signing in…' : needsCode ? 'Verify and sign in' : 'Sign in'}
        </button>
        {needsCode && (
          <button
            type="button"
            className="button button--subtle"
            onClick={() => {
              setNeedsCode(false);
              setCode('');
              setErrors({});
            }}
          >
            Use a different account
          </button>
        )}
      </form>
      <p className="admin-login-note muted">
        Every sign-in is recorded. After several wrong attempts the account is locked for a while.
      </p>
    </AuthLayout>
  );
}
