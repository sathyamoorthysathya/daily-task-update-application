import { formatDate } from '../profile.schemas';
import type { ConnectedAccount } from '../profile.types';

function providerLabel(provider: string): string {
  return provider === 'google' ? 'Google' : provider;
}

export function ConnectedAccountsSection({ accounts }: { accounts: ConnectedAccount[] }) {
  const google = accounts.find((account) => account.provider === 'google');

  return (
    <section className="card" aria-labelledby="connected-heading">
      <h2 id="connected-heading">Connected accounts</h2>
      {accounts.length === 0 && (
        <p className="muted" data-testid="no-connected-accounts">
          No Google account is connected. Use “Continue with Google” on the sign-in page with the
          same email address to connect one.
        </p>
      )}
      <ul className="connected-list">
        {accounts.map((account) => (
          <li key={`${account.provider}-${account.connectedAt}`} className="connected-item">
            {account.pictureUrl && (
              <img
                className="connected-picture"
                src={account.pictureUrl}
                alt=""
                referrerPolicy="no-referrer"
              />
            )}
            <div>
              <p className="connected-title">
                {providerLabel(account.provider)}{' '}
                <span className="status-badge status-badge--up">Connected</span>
              </p>
              <dl className="details details--compact">
                {account.name && (
                  <>
                    <dt>Name</dt>
                    <dd>{account.name}</dd>
                  </>
                )}
                {account.email && (
                  <>
                    <dt>Email</dt>
                    <dd>{account.email}</dd>
                  </>
                )}
                <dt>Connected</dt>
                <dd>{formatDate(account.connectedAt)}</dd>
                <dt>Last sign-in</dt>
                <dd>{formatDate(account.lastLoginAt)}</dd>
              </dl>
            </div>
          </li>
        ))}
      </ul>
      {google && (
        <p className="field-hint">
          Your Google account is used only to sign you in. We never see your Google password.
        </p>
      )}
    </section>
  );
}
