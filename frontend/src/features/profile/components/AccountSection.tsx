import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { formatDate } from '../profile.schemas';

export function AccountSection({ createdAt }: { createdAt: string }) {
  const { logout, logoutAll } = useAuth();
  const [busy, setBusy] = useState(false);

  // Signing out clears the user; ProtectedRoute then redirects to the sign-in page.
  function signOut(everywhere: boolean) {
    setBusy(true);
    (everywhere ? logoutAll() : logout()).catch(() => undefined);
  }

  return (
    <section className="card" aria-labelledby="account-heading">
      <h2 id="account-heading">Account</h2>
      <dl className="details">
        <dt>Account created</dt>
        <dd>{formatDate(createdAt)}</dd>
      </dl>
      <div className="form-actions">
        <button type="button" className="button" onClick={() => signOut(false)} disabled={busy}>
          Log out
        </button>
        <button type="button" className="button" onClick={() => signOut(true)} disabled={busy}>
          Log out of all devices
        </button>
      </div>
    </section>
  );
}
