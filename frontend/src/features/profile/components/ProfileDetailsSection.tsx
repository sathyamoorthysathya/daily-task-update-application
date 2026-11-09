import { type FormEvent, useState } from 'react';
import { FormAlert } from '../../../components/form/FormAlert';
import { SelectField } from '../../../components/form/SelectField';
import { TextField } from '../../../components/form/TextField';
import { useFormErrors } from '../../auth/use-form-errors';
import { profileApi } from '../profile.api';
import {
  MAX_YEARS_OF_EXPERIENCE,
  type ProfileFormValues,
  profileFormSchema,
  toFormValues,
  toProfileUpdate,
} from '../profile.schemas';
import type { Profile } from '../profile.types';

interface Props {
  profile: Profile;
  industries: readonly string[];
  onChange: (profile: Profile) => void;
}

function Detail({ label, value }: { label: string; value: string | number | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value === null || value === '' ? <span className="muted">Not set</span> : value}</dd>
    </>
  );
}

/** Personal and professional details: read-only view with an edit form. */
export function ProfileDetailsSection({ profile, industries, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<ProfileFormValues>(() => toFormValues(profile));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { fieldErrors, formError, validate, handleError, reset, clearFieldError } = useFormErrors();

  const update = (field: keyof ProfileFormValues) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    clearFieldError(field);
  };

  function startEditing() {
    setValues(toFormValues(profile));
    reset();
    setSaved(false);
    setEditing(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = validate(profileFormSchema, values);
    if (!parsed) {
      return;
    }
    setSaving(true);
    try {
      onChange(await profileApi.update(toProfileUpdate(parsed)));
      setEditing(false);
      setSaved(true);
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="details-heading">
      <div className="card-header">
        <h2 id="details-heading">Personal & professional details</h2>
        {!editing && (
          <button type="button" className="button" onClick={startEditing}>
            Edit profile
          </button>
        )}
      </div>

      {saved && !editing && <FormAlert variant="success">Your profile has been updated.</FormAlert>}

      {editing ? (
        <form className="form form--grid" onSubmit={(event) => void onSubmit(event)} noValidate>
          {formError && <FormAlert variant="error">{formError}</FormAlert>}
          <TextField
            label="Full name"
            name="name"
            autoComplete="name"
            value={values.name}
            onChange={update('name')}
            error={fieldErrors.name}
          />
          <TextField
            label="Email address"
            type="email"
            name="email"
            value={profile.email}
            readOnly
            hint="Your sign-in email can't be changed here."
          />
          <TextField
            label="Phone number"
            type="tel"
            name="phone"
            autoComplete="tel"
            placeholder="+1 555 123 4567"
            value={values.phone}
            onChange={update('phone')}
            error={fieldErrors.phone}
          />
          <TextField
            label="Company name"
            name="companyName"
            autoComplete="organization"
            value={values.companyName}
            onChange={update('companyName')}
            error={fieldErrors.companyName}
          />
          <TextField
            label="Job role"
            name="jobRole"
            autoComplete="organization-title"
            value={values.jobRole}
            onChange={update('jobRole')}
            error={fieldErrors.jobRole}
          />
          <SelectField
            label="Industry"
            name="industry"
            options={industries}
            placeholder="Select an industry"
            value={values.industry}
            onChange={update('industry')}
            error={fieldErrors.industry}
          />
          <TextField
            label="Years of experience"
            type="number"
            name="yearsOfExperience"
            inputMode="numeric"
            min={0}
            max={MAX_YEARS_OF_EXPERIENCE}
            step={1}
            value={values.yearsOfExperience}
            onChange={update('yearsOfExperience')}
            error={fieldErrors.yearsOfExperience}
          />
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="details" data-testid="profile-details">
          <Detail label="Full name" value={profile.name} />
          <dt>Email address</dt>
          <dd>
            {profile.email}{' '}
            <span
              className={`status-badge status-badge--${profile.emailVerified ? 'up' : 'checking'}`}
            >
              {profile.emailVerified ? 'Verified' : 'Not verified'}
            </span>
          </dd>
          <Detail label="Phone number" value={profile.phone} />
          <Detail label="Company name" value={profile.companyName} />
          <Detail label="Job role" value={profile.jobRole} />
          <Detail label="Industry" value={profile.industry} />
          <Detail label="Years of experience" value={profile.yearsOfExperience} />
        </dl>
      )}
    </section>
  );
}
