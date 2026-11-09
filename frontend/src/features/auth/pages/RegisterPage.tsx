import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { useAuth } from '../auth-context';
import { PASSWORD_HINT, registerSchema } from '../auth.schemas';
import { AuthLayout } from '../components/AuthLayout';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { useFormErrors } from '../use-form-errors';

export function RegisterPage() {
  const { register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [submitting, setSubmitting] = useState(false);
  const [googleAttempt, setGoogleAttempt] = useState(0);
  const { fieldErrors, formError, validate, handleError, reset } = useFormErrors();

  const update = (field: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = validate(registerSchema, values);
    if (!parsed) {
      return;
    }
    setSubmitting(true);
    try {
      await register(parsed.name, parsed.email, parsed.password);
      await navigate('/dashboard', { replace: true });
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
      await navigate('/dashboard', { replace: true });
    } catch (error) {
      handleError(error);
      setSubmitting(false);
      setGoogleAttempt((n) => n + 1);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start tracking your daily work in minutes."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      {formError && <FormAlert variant="error">{formError}</FormAlert>}

      <form className="form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextField
          label="Name"
          name="name"
          autoComplete="name"
          value={values.name}
          onChange={update('name')}
          error={fieldErrors.name}
        />
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={values.email}
          onChange={update('email')}
          error={fieldErrors.email}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          value={values.password}
          onChange={update('password')}
          hint={PASSWORD_HINT}
          error={fieldErrors.password}
        />
        <TextField
          label="Confirm password"
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={update('confirmPassword')}
          error={fieldErrors.confirmPassword}
        />
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <GoogleSignInButton
        onCredential={(c) => void onGoogleCredential(c)}
        attempt={googleAttempt}
      />
    </AuthLayout>
  );
}
