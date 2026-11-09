import { apiClient } from '../../lib/api/http-client';
import type { AuthProviders, AuthResponse, User } from './auth.types';

export const authApi = {
  me: () => apiClient.get<User>('/auth/me'),
  providers: () => apiClient.get<AuthProviders>('/auth/providers'),
  register: (input: { name: string; email: string; password: string }) =>
    apiClient.post<AuthResponse>('/auth/register', input),
  login: (input: { email: string; password: string }) =>
    apiClient.post<AuthResponse>('/auth/login', input),
  googleNonce: () => apiClient.get<{ nonce: string }>('/auth/google/nonce'),
  google: (credential: string) => apiClient.post<AuthResponse>('/auth/google', { credential }),
  logout: () => apiClient.post<void>('/auth/logout'),
  logoutAll: () => apiClient.post<void>('/auth/logout-all'),
  forgotPassword: (email: string) =>
    apiClient.post<{ message: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    apiClient.post<void>('/auth/reset-password', { token, password }),
};
