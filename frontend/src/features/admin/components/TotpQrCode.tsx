import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * QR code of the otpauth:// set-up link, for scanning with an authenticator app. Always dark
 * modules on white (with the standard 4-module quiet zone), also in dark mode, so phone
 * cameras can read it. Drawn in the browser: the secret never goes to another service.
 */
export function TotpQrCode({ uri }: { uri: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(uri, { ecc: 'M', border: 4 });
    // One path: each horizontal run of dark modules is one rectangle.
    const parts: string[] = [];
    qr.data.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (!row[x]) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < row.length && row[x]) {
          x += 1;
        }
        parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
      }
    });
    return { size: qr.size, path: parts.join('') };
  }, [uri]);

  return (
    <svg
      className="admin-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code for setting up two-step verification"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
