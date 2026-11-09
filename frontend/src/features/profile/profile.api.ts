import { apiClient } from '../../lib/api/http-client';
import type { Profile, ProfileUpdate } from './profile.types';

export const profileApi = {
  get: () => apiClient.get<Profile>('/profile'),
  update: (changes: ProfileUpdate) => apiClient.patch<Profile>('/profile', changes),
  industries: () => apiClient.get<{ industries: string[] }>('/profile/industries'),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('avatar', file);
    return apiClient.put<Profile>('/profile/avatar', form);
  },
  removeAvatar: () => apiClient.delete<Profile>('/profile/avatar'),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post<void>('/auth/change-password', { currentPassword, newPassword }),
};
