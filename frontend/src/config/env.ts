/** Typed, normalised access to build-time environment variables. */
export const env = {
  /** API base URL without a trailing slash, e.g. `/api` or `https://api.example.com/api`. */
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, ''),
} as const;
