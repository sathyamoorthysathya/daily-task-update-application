/** Typed, normalised access to build-time environment variables. */
export const env = {
  /** API base URL without a trailing slash, e.g. `/api/v1` or `https://api.example.com/api/v1`. */
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, ''),
  /**
   * Record which pages are opened (for the admin panel). VITE_ANALYTICS=false turns it off;
   * always off in unit tests.
   */
  analyticsEnabled: import.meta.env.VITE_ANALYTICS !== 'false' && import.meta.env.MODE !== 'test',
} as const;
