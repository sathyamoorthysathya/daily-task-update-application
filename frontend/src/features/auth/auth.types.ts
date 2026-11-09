export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  hasPassword: boolean;
  providers: string[];
  /** Version of the uploaded avatar, or null when none is uploaded. */
  avatarVersion: number | null;
  /** Picture from a linked provider (Google), used when no avatar is uploaded. */
  providerPictureUrl: string | null;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
}

export interface AuthProviders {
  google: { enabled: boolean; clientId?: string };
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
