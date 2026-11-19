/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** "false" turns off page-visit tracking. */
  readonly VITE_ANALYTICS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
