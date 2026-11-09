import { useEffect, useState } from 'react';
import { FormAlert } from '../../components/form/FormAlert';
import { errorMessage } from '../../lib/api/api-error';
import { useAuth } from '../auth/auth-context';
import { AccountSection } from './components/AccountSection';
import { ChangePasswordSection } from './components/ChangePasswordSection';
import { ConnectedAccountsSection } from './components/ConnectedAccountsSection';
import { ProfileDetailsSection } from './components/ProfileDetailsSection';
import { ProfileSummaryCard } from './components/ProfileSummaryCard';
import { profileApi } from './profile.api';
import type { Profile } from './profile.types';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profile: Profile; industries: string[] };

export function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // The API resolves "my profile" from the session; no user ID is sent.
  useEffect(() => {
    let active = true;
    Promise.all([profileApi.get(), profileApi.industries()]).then(
      ([profile, { industries }]) => active && setState({ status: 'ready', profile, industries }),
      (error: unknown) => active && setState({ status: 'error', message: errorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  function onProfileChange(profile: Profile) {
    setState((current) => (current.status === 'ready' ? { ...current, profile } : current));
    // Keep the header (name, picture) in sync.
    updateUser({ name: profile.name, avatarVersion: profile.avatarVersion });
  }

  return (
    <div className="app app--wide">
      <header className="app-header">
        <h1>Profile</h1>
        <p className="muted">Manage your personal details, password and connected accounts.</p>
      </header>

      {state.status === 'loading' && (
        <p className="muted" role="status">
          Loading your profile…
        </p>
      )}

      {state.status === 'error' && (
        <FormAlert variant="error">
          {state.message}{' '}
          <button
            type="button"
            className="button button--subtle"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </FormAlert>
      )}

      {state.status === 'ready' && (
        <main className="app-main">
          <ProfileSummaryCard
            profile={state.profile}
            providerPictureUrl={user?.providerPictureUrl ?? null}
            onChange={onProfileChange}
          />
          <ProfileDetailsSection
            profile={state.profile}
            industries={state.industries}
            onChange={onProfileChange}
          />
          <ChangePasswordSection
            email={state.profile.email}
            hasPassword={state.profile.hasPassword}
          />
          <ConnectedAccountsSection accounts={state.profile.connectedAccounts} />
          <AccountSection createdAt={state.profile.createdAt} />
        </main>
      )}
    </div>
  );
}
