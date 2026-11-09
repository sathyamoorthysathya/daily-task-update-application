import { type ChangeEvent, useRef, useState } from 'react';
import { Avatar } from '../../../components/Avatar';
import { FormAlert } from '../../../components/form/FormAlert';
import { errorMessage } from '../../../lib/api/api-error';
import { profileApi } from '../profile.api';
import { AVATAR_TYPES, avatarFileError, formatDate } from '../profile.schemas';
import type { Profile } from '../profile.types';

interface Props {
  profile: Profile;
  providerPictureUrl: string | null;
  onChange: (profile: Profile) => void;
}

/** Picture, name, role and membership date, with avatar upload/removal. */
export function ProfileSummaryCard({ profile, providerPictureUrl, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<Profile>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) {
      return;
    }
    const problem = avatarFileError(file);
    if (problem) {
      setError(problem);
      return;
    }
    void run(() => profileApi.uploadAvatar(file));
  }

  const headline = [profile.jobRole, profile.companyName].filter(Boolean).join(' at ');

  return (
    <section className="card profile-summary" aria-label="Profile summary">
      <div className="profile-summary-main">
        <Avatar user={{ ...profile, providerPictureUrl }} size="lg" />
        <div className="profile-summary-text">
          <h2>{profile.name}</h2>
          {headline && <p className="profile-headline">{headline}</p>}
          <p className="muted">{profile.email}</p>
          <p className="muted" data-testid="member-since">
            Member since {formatDate(profile.createdAt)}
          </p>
        </div>
      </div>

      <div className="profile-summary-actions">
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_TYPES.join(',')}
          className="visually-hidden"
          onChange={onFileSelected}
          aria-label="Upload profile picture"
          data-testid="avatar-input"
        />
        <button
          type="button"
          className="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Saving…' : profile.avatarVersion === null ? 'Upload photo' : 'Change photo'}
        </button>
        {profile.avatarVersion !== null && (
          <button
            type="button"
            className="button button--subtle"
            onClick={() => void run(profileApi.removeAvatar)}
            disabled={busy}
          >
            Remove photo
          </button>
        )}
        <p className="field-hint">JPEG, PNG or WebP, up to 2 MB.</p>
      </div>
      {error && <FormAlert variant="error">{error}</FormAlert>}
    </section>
  );
}
