import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * Encrypts small secrets stored in the database (administrators' TOTP secrets) with
 * AES-256-GCM, so a copy of the database alone does not reveal them. The key is derived
 * (HKDF-SHA256) from a server secret; changing that secret makes stored values unreadable
 * (administrators then set up two-step verification again, see `npm run admin -- reset`).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(serverSecret: string, purpose: string) {
    this.key = Buffer.from(
      hkdfSync('sha256', serverSecret, 'daily-task-update', `secret-box:${purpose}`, 32),
    );
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** Throws when the value was tampered with or sealed with another key. */
  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || data === undefined) {
      throw new Error('Unsupported sealed value');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
