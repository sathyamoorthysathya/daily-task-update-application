// Minimal typings for Google Identity Services (https://developers.google.com/identity/gsi/web).

export interface GoogleCredentialResponse {
  /** The Google ID token (JWT), verified by the backend. */
  credential: string;
  select_by?: string;
}

interface IdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  ux_mode?: 'popup' | 'redirect';
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  context?: 'signin' | 'signup' | 'use';
  use_fedcm_for_button?: boolean;
}

interface GsiButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
}

export interface GoogleAccountsId {
  initialize: (config: IdConfiguration) => void;
  renderButton: (parent: HTMLElement, options: GsiButtonConfiguration) => void;
  disableAutoSelect: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let loading: Promise<GoogleAccountsId> | null = null;

/** Loads Google's official Identity Services client once. */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (window.google?.accounts.id) {
    return Promise.resolve(window.google.accounts.id);
  }
  loading ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts.id) {
        resolve(window.google.accounts.id);
      } else {
        reject(new Error('Google Identity Services did not initialise'));
      }
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('Failed to load Google Identity Services'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
