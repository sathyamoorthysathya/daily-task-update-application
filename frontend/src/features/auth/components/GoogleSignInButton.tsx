import { useEffect, useRef, useState } from 'react';
import { authApi } from '../auth.api';
import { loadGoogleIdentity } from '../google/google-identity';

/** Quiet automatic retries (ms) before the error is shown: covers a restarting API or a blip. */
const RETRY_DELAYS_MS = [1_000, 3_000];

interface Props {
  /** Receives the Google ID token after the user picks an account. */
  onCredential: (credential: string) => void;
  /** Change to re-initialise with a fresh nonce (nonces are single-use). */
  attempt?: number;
  /** Delays of the automatic retries; tests pass []. */
  retryDelaysMs?: readonly number[];
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Google's "G" mark (official colours), for the loading and error states. */
function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * "Continue with Google" using Google Identity Services (OpenID Connect ID token flow).
 * The backend issues a nonce that Google embeds in the ID token; the backend then verifies
 * the token's signature, issuer, audience, expiry, nonce and email verification status.
 * Renders nothing when Google sign-in is not configured on the server. A failed set-up is
 * retried quietly, then the user can try again without reloading the page.
 */
export function GoogleSignInButton({
  onCredential,
  attempt = 0,
  retryDelaysMs = RETRY_DELAYS_MS,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  const retryDelaysRef = useRef(retryDelaysMs);
  const [state, setState] = useState<'loading' | 'ready' | 'disabled' | 'error'>('loading');
  /** Incremented by "Try again". */
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    callbackRef.current = onCredential;
    retryDelaysRef.current = retryDelaysMs;
  }, [onCredential, retryDelaysMs]);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const providers = await authApi.providers();
      const clientId = providers.google.clientId;
      if (!providers.google.enabled || !clientId) {
        return 'disabled' as const;
      }
      const [gis, { nonce }] = await Promise.all([loadGoogleIdentity(), authApi.googleNonce()]);
      if (cancelled || !containerRef.current) {
        return 'loading' as const;
      }
      gis.initialize({
        client_id: clientId,
        nonce,
        ux_mode: 'popup',
        auto_select: false,
        context: 'signin',
        use_fedcm_for_button: true,
        callback: (response) => callbackRef.current(response.credential),
      });
      containerRef.current.replaceChildren();
      gis.renderButton(containerRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 320,
      });
      return 'ready' as const;
    }

    async function setupWithRetries() {
      for (let tries = 0; ; tries += 1) {
        try {
          return await setup();
        } catch (error) {
          const delay = retryDelaysRef.current[tries];
          if (cancelled || delay === undefined) {
            throw error;
          }
          await wait(delay);
        }
      }
    }

    setupWithRetries().then(
      (next) => !cancelled && setState(next),
      () => !cancelled && setState('error'),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, retry]);

  if (state === 'disabled') {
    return null;
  }

  return (
    <div className="google-signin">
      <div className="divider" role="separator">
        <span>or</span>
      </div>
      {/* Google renders its button in here (hidden by CSS while empty); kept mounted for retries. */}
      <div ref={containerRef} className="google-button" data-testid="google-button" />
      {state === 'loading' && (
        <div className="google-placeholder" role="status" aria-live="polite">
          <GoogleMark />
          <span>Loading Google sign-in…</span>
        </div>
      )}
      {state === 'error' && (
        <div className="google-unavailable" role="alert">
          <GoogleMark />
          <p>
            <strong>Google sign-in couldn’t load.</strong>
            <span>Check your connection and try again, or use your email above.</span>
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setState('loading');
              setRetry((count) => count + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
