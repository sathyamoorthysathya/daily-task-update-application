import { env } from '../config/env';

export interface AvatarSource {
  name: string;
  avatarVersion: number | null;
  providerPictureUrl?: string | null;
}

/** URL of the user's picture: uploaded avatar first, then the linked provider's picture. */
export function avatarUrl(source: AvatarSource): string | null {
  if (source.avatarVersion !== null) {
    return `${env.apiBaseUrl}/profile/avatar?v=${source.avatarVersion}`;
  }
  return source.providerPictureUrl ?? null;
}
