import { type FormEvent, useState } from 'react';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { errorMessage } from '../../../lib/api/api-error';
import { authApi } from '../../auth/auth.api';
import { PASSWORD_HINT } from '../../auth/auth.schemas';
import { useFormErrors } from '../../auth/use-form-errors';
import { profileApi } from '../profile.api';
import { changePasswordSchema } from '../profile.schemas';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

interface Props {
  email: string;
  hasPassword: boolean;
}

export function ChangePasswordSection({ email, hasPassword }: Props) {
  const [values, setValues] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const { fieldErrors, formError, setFormError, validate, handleError, clearFieldError } =
    useFormErrors();

  const update = (field: keyof typeof EMPTY) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    clearFieldError(field);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    const parsed = validate(changePasswordSchema, values);
    if (!parsed) {
      return;
    }
    setBusy(true);
    try {
      await profileApi.changePassword(parsed.currentPassword, parsed.newPassword);
      setValues(EMPTY);
      setSuccess('Your password has been changed. Other devices have been signed out.');
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  async function sendSetPasswordLink() {
    setBusy(true);
    setSuccess(null);
    setFormError(null);
    try {
      await authApi.forgotPassword(email);
      setSuccess(`We sent a link to ${email} to set your password.`);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="password-heading">
      <h2 id="password-heading">{hasPassword ? 'Change password' : 'Password'}</h2>
      {success && <FormAlert variant="success">{success}</FormAlert>}
      {formError && <FormAlert variant="error">{formError}</FormAlert>}

      {hasPassword ? (
        <form className="form" onSubmit={(event) => void onSubmit(event)} noValidate>
          <TextField
            label="Current password"
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            value={values.currentPassword}
            onChange={update('currentPassword')}
            error={fieldErrors.currentPassword}
          />
          <TextField
            label="New password"
            type="password"
            name="newPassword"
            autoComplete="new-password"
            value={values.newPassword}
            onChange={update('newPassword')}
            hint={PASSWORD_HINT}
            error={fieldErrors.newPassword}
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
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? 'Changing…' : 'Change password'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>
            You sign in with Google, so your account has no password. To also sign in with your
            email and a password, we'll email you a secure link to set one.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => void sendSetPasswordLink()}
            disabled={busy}
          >
            Email me a link to set a password
          </button>
        </>
      )}
    </section>
  );
}
