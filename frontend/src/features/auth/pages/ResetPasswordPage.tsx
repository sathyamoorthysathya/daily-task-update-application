import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { ApiError } from '../../../lib/api/api-error';
import { authApi } from '../auth.api';
import { PASSWORD_RESET_NOTICE } from '../auth-messages';
import { PASSWORD_HINT, resetPasswordSchema } from '../auth.schemas';
import { AuthLayout } from '../components/AuthLayout';
import { useFormErrors } from '../use-form-errors';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Keep the token in memory and remove it from the address bar/history.
  const [token] = useState(() => searchParams.get('token') ?? '');
  const [values, setValues] = useState({ password: '', confirmPassword: '' });
  const [submitting, setSubmitting] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(token === '');
  const { fieldErrors, formError, validate, handleError } = useFormErrors();

  useEffect(() => {
    if (searchParams.has('token')) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = validate(resetPasswordSchema, values);
    if (!parsed) {
      return;
    }
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, parsed.password);
      await navigate('/login', { replace: true, state: { notice: PASSWORD_RESET_NOTICE } });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RESET_TOKEN_INVALID') {
        setLinkInvalid(true);
      } else {
        handleError(error);
      }
      setSubmitting(false);
    }
  }

  const update = (field: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Enter a new secure password to restore access to your account."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      {linkInvalid ? (
        <FormAlert variant="error">
          This password reset link is invalid or has expired.{' '}
          <Link to="/forgot-password">Request a new link</Link>.
        </FormAlert>
      ) : (
        <>
          {formError && <FormAlert variant="error">{formError}</FormAlert>}
          <form className="form" onSubmit={(event) => void onSubmit(event)} noValidate>
            <TextField
              label="New password"
              type="password"
              name="password"
              autoComplete="new-password"
              value={values.password}
              onChange={update('password')}
              hint={PASSWORD_HINT}
              error={fieldErrors.password}
            />
            <TextField
              label="Confirm new password"
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={update('confirmPassword')}
              error={fieldErrors.confirmPassword}
            />
            <button type="submit" className="button button--primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Reset password'}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
