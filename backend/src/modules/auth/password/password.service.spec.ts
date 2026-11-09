import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id using the OWASP-recommended parameters', async () => {
    const hash = await service.hash('Correct-horse-1');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain('Correct-horse-1');
  });

  it('uses a unique salt for every hash', async () => {
    const [a, b] = await Promise.all([service.hash('same-pass-1'), service.hash('same-pass-1')]);

    expect(a).not.toBe(b);
  });

  it('verifies the correct password and rejects others', async () => {
    const hash = await service.hash('Correct-horse-1');

    await expect(service.verify(hash, 'Correct-horse-1')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong-password-1')).resolves.toBe(false);
  });

  it('treats a malformed hash as a failed verification', async () => {
    await expect(service.verify('not-a-hash', 'whatever')).resolves.toBe(false);
  });

  it('dummy verification always fails', async () => {
    await expect(service.verifyDummy('anything')).resolves.toBe(false);
  });
});
