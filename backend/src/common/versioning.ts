/**
 * API version. Routes are served under `/<API_PREFIX>/v<API_VERSION>/...`
 * (e.g. `POST /api/v1/auth/login`); a future breaking change can add `v2` alongside.
 */
export const API_VERSION = '1';

/** Path of the versioned API, e.g. `/api/v1`. */
export const versionedApiPath = (apiPrefix: string) => `/${apiPrefix}/v${API_VERSION}`;
