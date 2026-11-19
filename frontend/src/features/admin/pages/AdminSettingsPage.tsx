import { type FormEvent, useState } from 'react';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { ApiError, errorMessage } from '../../../lib/api/api-error';
import { useAdminAuth } from '../admin-auth-context';
import { adminApi } from '../admin.api';
import { AdminHeader, LoadError, Pill } from '../components/AdminUi';
import { TotpQrCode } from '../components/TotpQrCode';
import { formatDate, formatDateTime, timeAgo } from '../format';
import { useAdminData } from '../use-admin-data';

type Feedback = { tone: 'success' | 'error'; text: string } | null;

/** Same rules as the server (shown before sending). */
function passwordProblem(password: string, username: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password))
    return 'Use upper-case and lower-case letters';
  if (!/\d/.test(password)) return 'Add at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Add at least one symbol (for example ! # - _)';
  if (password.toLowerCase().includes(username.toLowerCase()))
    return 'Do not include your username';
  return null;
}

function ChangePasswordCard({ username }: { username: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!current) found.currentPassword = 'Enter your current password';
    const problem = passwordProblem(next, username);
    if (problem) found.newPassword = problem;
    else if (next !== repeat) found.repeat = 'The passwords do not match';
    setErrors(found);
    setFeedback(null);
    if (Object.keys(found).length > 0) {
      return;
    }
    setBusy(true);
    try {
      await adminApi.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      setFeedback({
        tone: 'success',
        text: 'Password changed. Your other admin sessions were signed out.',
      });
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        setFeedback({ tone: 'error', text: errorMessage(error) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="password-heading">
      <h2 id="password-heading">Change password</h2>
      <p className="muted admin-card-note">
        At least 12 characters with upper- and lower-case letters, a number and a symbol.
      </p>
      {feedback && <FormAlert variant={feedback.tone}>{feedback.text}</FormAlert>}
      <form className="form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          hidden
          readOnly
        />
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          error={errors.currentPassword}
          maxLength={128}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          error={errors.newPassword}
          maxLength={128}
        />
        <TextField
          label="Repeat the new password"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          error={errors.repeat}
          maxLength={128}
        />
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}

/** Groups of 4 characters, easier to type into an authenticator app. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

function TwoStepCard() {
  const { admin, refresh } = useAdminAuth();
  const [step, setStep] = useState<'idle' | 'password' | 'scan' | 'disable'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  if (!admin) {
    return null;
  }

  function reset(next: typeof step = 'idle') {
    setStep(next);
    setPassword('');
    setCode('');
    setErrors({});
  }

  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setErrors({});
    setFeedback(null);
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        setFeedback({ tone: 'error', text: errorMessage(error) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="two-step" aria-labelledby="two-step-heading">
      <div className="card-header">
        <h2 id="two-step-heading">Two-step verification</h2>
        {admin.twoFactorEnabled ? <Pill tone="good">On</Pill> : <Pill tone="warn">Off</Pill>}
      </div>
      <p className="muted admin-card-note">
        Signing in then also needs a 6-digit code from an authenticator app on your phone (Google
        Authenticator, Microsoft Authenticator, 1Password…), so a stolen password alone cannot open
        the admin panel.
      </p>
      {feedback && <FormAlert variant={feedback.tone}>{feedback.text}</FormAlert>}

      {!admin.twoFactorEnabled && step === 'idle' && (
        <button type="button" className="button button--primary" onClick={() => reset('password')}>
          Turn on two-step verification
        </button>
      )}

      {step === 'password' && (
        <form
          className="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void attempt(async () => {
              setSetup(await adminApi.startTwoFactor(password));
              setPassword('');
              setStep('scan');
            });
          }}
        >
          <TextField
            label="Confirm your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
            maxLength={128}
          />
          <div className="form-actions">
            <button type="button" className="button" onClick={() => reset()}>
              Cancel
            </button>
            <button type="submit" className="button button--primary" disabled={busy || !password}>
              Continue
            </button>
          </div>
        </form>
      )}

      {step === 'scan' && setup && (
        <form
          className="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void attempt(async () => {
              await adminApi.enableTwoFactor(code.trim());
              await refresh();
              setSetup(null);
              reset();
              setFeedback({ tone: 'success', text: 'Two-step verification is on.' });
            });
          }}
        >
          <ol className="admin-steps">
            <li>
              Scan this QR code with your authenticator app:
              <TotpQrCode uri={setup.otpauthUri} />
            </li>
            <li>
              Can’t scan it? Choose <strong>Enter a setup key</strong> in the app (or{' '}
              <a href={setup.otpauthUri}>open this link on your phone</a>). Account:{' '}
              <strong>Daily Task Update Admin ({admin.username})</strong>, key (time based):
              <code className="admin-secret" aria-label="Setup key">
                {grouped(setup.secret)}
              </code>
              <button
                type="button"
                className="button button--subtle"
                onClick={() => void navigator.clipboard?.writeText(setup.secret)}
              >
                Copy key
              </button>
            </li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <TextField
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, ''))}
            error={errors.code}
          />
          <div className="form-actions">
            <button type="button" className="button" onClick={() => reset()}>
              Cancel
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={busy || code.trim().length < 6}
            >
              Turn on
            </button>
          </div>
        </form>
      )}

      {admin.twoFactorEnabled && step === 'idle' && (
        <button type="button" className="button button--danger" onClick={() => reset('disable')}>
          Turn off two-step verification
        </button>
      )}

      {step === 'disable' && (
        <form
          className="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void attempt(async () => {
              await adminApi.disableTwoFactor(password, code.trim());
              await refresh();
              reset();
              setFeedback({ tone: 'success', text: 'Two-step verification is off.' });
            });
          }}
        >
          <FormAlert variant="info">
            Without two-step verification, your password alone opens the admin panel.
          </FormAlert>
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
            maxLength={128}
          />
          <TextField
            label="Current 6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, ''))}
            error={errors.code}
          />
          <div className="form-actions">
            <button type="button" className="button" onClick={() => reset()}>
              Cancel
            </button>
            <button type="submit" className="button button--danger-solid" disabled={busy}>
              Turn off
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function SessionsCard() {
  const { state, reload } = useAdminData(() => adminApi.sessions(), []);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const sessions = state.data?.sessions ?? [];
  const others = sessions.filter((session) => !session.current).length;

  async function signOutOthers() {
    setFeedback(null);
    try {
      const { revoked } = await adminApi.revokeOtherSessions();
      setFeedback({ tone: 'success', text: `${revoked} other session(s) signed out.` });
      reload();
    } catch (error) {
      setFeedback({ tone: 'error', text: errorMessage(error) });
    }
  }

  return (
    <section className="card" aria-labelledby="sessions-heading">
      <div className="card-header">
        <h2 id="sessions-heading">Your admin sessions</h2>
        <button
          type="button"
          className="button"
          disabled={others === 0}
          onClick={() => void signOutOthers()}
        >
          Sign out other sessions
        </button>
      </div>
      {feedback && <FormAlert variant={feedback.tone}>{feedback.text}</FormAlert>}
      {state.status === 'error' && <LoadError message={state.message} onRetry={reload} />}
      <ul className="admin-list">
        {sessions.map((session) => (
          <li key={session.id}>
            <span className="admin-list-main">
              <strong>
                {session.browser} on {session.os}{' '}
                {session.current && <Pill tone="good">This browser</Pill>}
              </strong>
              <span className="muted">
                {session.ip ?? 'Unknown address'} · signed in {formatDateTime(session.createdAt)}
              </span>
            </span>
            <span className="muted nowrap">Active {timeAgo(session.lastSeenAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AdminsCard() {
  const { state, reload } = useAdminData(() => adminApi.admins(), []);
  return (
    <section className="card" aria-labelledby="admins-heading">
      <h2 id="admins-heading">Administrators</h2>
      <p className="muted admin-card-note">
        Administrators are added on the server:{' '}
        <code>npm run admin -- create &lt;username&gt;</code> (see the README).
      </p>
      {state.status === 'error' && <LoadError message={state.message} onRetry={reload} />}
      <ul className="admin-list">
        {(state.data?.admins ?? []).map((account) => (
          <li key={account.username}>
            <span className="admin-list-main">
              <strong>
                {account.displayName} <span className="muted">@{account.username}</span>
              </strong>
              <span className="muted">
                Added {formatDate(account.createdAt)} · last sign-in {timeAgo(account.lastLoginAt)}
              </span>
            </span>
            <span className="admin-methods">
              {account.locked && <Pill tone="bad">Locked</Pill>}
              {account.twoFactorEnabled ? (
                <Pill tone="good">2-step on</Pill>
              ) : (
                <Pill tone="warn">2-step off</Pill>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AdminSettingsPage() {
  const { admin } = useAdminAuth();
  if (!admin) {
    return null;
  }
  return (
    <div className="app app--wide app--admin">
      <AdminHeader eyebrow="Admin panel" title="Admin settings" />
      <section className="card admin-account" aria-labelledby="account-heading">
        <h2 id="account-heading">Your admin account</h2>
        <dl className="admin-dl">
          <div>
            <dt>Username</dt>
            <dd>@{admin.username}</dd>
          </div>
          <div>
            <dt>Name</dt>
            <dd>{admin.displayName}</dd>
          </div>
          <div>
            <dt>Password changed</dt>
            <dd>{formatDateTime(admin.passwordChangedAt)}</dd>
          </div>
          <div>
            <dt>Previous sign-in</dt>
            <dd>
              {admin.previousSignIn
                ? `${formatDateTime(admin.previousSignIn.at)} · ${admin.previousSignIn.browser} on ${admin.previousSignIn.os} · ${admin.previousSignIn.ip ?? 'unknown address'}`
                : 'This is your first sign-in.'}
            </dd>
          </div>
          <div>
            <dt>This session</dt>
            <dd>
              Ends after {admin.session.idleTimeoutMinutes} minutes without activity, and at the
              latest {formatDateTime(admin.session.expiresAt)}.
            </dd>
          </div>
        </dl>
        {admin.previousSignIn && (
          <p className="muted admin-card-note">
            Don’t recognise the previous sign-in? Change your password and sign out the other
            sessions.
          </p>
        )}
      </section>
      <div className="admin-grid">
        <TwoStepCard />
        <ChangePasswordCard username={admin.username} />
        <SessionsCard />
        <AdminsCard />
      </div>
    </div>
  );
}
