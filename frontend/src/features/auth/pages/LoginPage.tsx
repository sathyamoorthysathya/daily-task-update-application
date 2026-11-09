import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { useAuth } from '../auth-context';
import { loginSchema } from '../auth.schemas';
import { AuthLayout } from '../components/AuthLayout';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { useFormErrors } from '../use-form-errors';

interface LocationState {
  from?: string;
  notice?: string;
}

/** Only same-app paths are allowed as post-login destinations (no open redirects). */
function safeRedirect(from: string | undefined): string {
  return from?.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
}

export function LoginPage() {
  const { login, loginWithGoogle, notice, clearNotice } = useAuth();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as LocationState;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleAttempt, setGoogleAttempt] = useState(0);
  const { fieldErrors, formError, validate, handleError, reset } = useFormErrors();

  const destination = safeRedirect(state.from);
  const banner = state.notice ?? notice;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const values = validate(loginSchema, { email, password });
    if (!values) {
      return;
    }
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      clearNotice();
      await navigate(destination, { replace: true });
    } catch (error) {
      handleError(error);
      setSubmitting(false);
    }
  }

  async function onGoogleCredential(credential: string) {
    reset();
    setSubmitting(true);
    try {
      await loginWithGoogle(credential);
      clearNotice();
      await navigate(destination, { replace: true });
    } catch (error) {
      handleError(error);
      setSubmitting(false);
      setGoogleAttempt((n) => n + 1); // fresh nonce for the next try
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back! Sign in to see your daily tasks."
      footer={
        <>
          New here? <Link to="/register">Create an account</Link>
        </>
      }
    >
      {banner && <FormAlert variant="info">{banner}</FormAlert>}
      {formError && <FormAlert variant="error">{formError}</FormAlert>}

      <form className="form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />
        <div className="form-row">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <GoogleSignInButton
        onCredential={(c) => void onGoogleCredential(c)}
        attempt={googleAttempt}
      />
    </AuthLayout>
  );
}
