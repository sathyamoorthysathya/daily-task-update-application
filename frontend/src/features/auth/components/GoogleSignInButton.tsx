import { useEffect, useRef, useState } from 'react';
import { authApi } from '../auth.api';
import { loadGoogleIdentity } from '../google/google-identity';

interface Props {
  /** Receives the Google ID token after the user picks an account. */
  onCredential: (credential: string) => void;
  /** Change to re-initialise with a fresh nonce (nonces are single-use). */
  attempt?: number;
}

/**
 * "Continue with Google" using Google Identity Services (OpenID Connect ID token flow).
 * The backend issues a nonce that Google embeds in the ID token; the backend then verifies
 * the token's signature, issuer, audience, expiry, nonce and email verification status.
 * Renders nothing when Google sign-in is not configured on the server.
 */
export function GoogleSignInButton({ onCredential, attempt = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  const [state, setState] = useState<'loading' | 'ready' | 'disabled' | 'error'>('loading');

  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

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

    setup().then(
      (next) => !cancelled && setState(next),
      () => !cancelled && setState('error'),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state === 'disabled') {
    return null;
  }

  return (
    <div className="google-signin">
      <div className="divider" role="separator">
        <span>or</span>
      </div>
      <div ref={containerRef} className="google-button" data-testid="google-button" />
      {state === 'error' && (
        <p className="field-error" role="alert">
          Google sign-in is unavailable right now. Please try again later.
        </p>
      )}
    </div>
  );
}
