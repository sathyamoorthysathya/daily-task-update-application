import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { authApi } from '../auth.api';
import { forgotPasswordSchema } from '../auth.schemas';
import { AuthLayout } from '../components/AuthLayout';
import { useFormErrors } from '../use-form-errors';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const { fieldErrors, formError, validate, handleError } = useFormErrors();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const values = validate(forgotPasswordSchema, { email });
    if (!values) {
      return;
    }
    setSubmitting(true);
    try {
      const { message } = await authApi.forgotPassword(values.email);
      setSentMessage(message);
    } catch (error) {
      handleError(error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a link to choose a new one."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      {sentMessage ? (
        <FormAlert variant="success">
          {sentMessage} The link expires soon, so use it promptly.
        </FormAlert>
      ) : (
        <>
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
            <button type="submit" className="button button--primary" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
