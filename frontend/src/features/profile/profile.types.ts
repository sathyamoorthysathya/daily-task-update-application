export interface ConnectedAccount {
  provider: string;
  email: string | null;
  name: string | null;
  pictureUrl: string | null;
  connectedAt: string;
  lastLoginAt: string;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  hasPassword: boolean;
  phone: string | null;
  companyName: string | null;
  jobRole: string | null;
  industry: string | null;
  yearsOfExperience: number | null;
  avatarVersion: number | null;
  connectedAccounts: ConnectedAccount[];
  createdAt: string;
  updatedAt: string;
}

/** PATCH /profile body: omitted = unchanged, null = cleared. */
export interface ProfileUpdate {
  name?: string;
  phone?: string | null;
  companyName?: string | null;
  jobRole?: string | null;
  industry?: string | null;
  yearsOfExperience?: number | null;
}
