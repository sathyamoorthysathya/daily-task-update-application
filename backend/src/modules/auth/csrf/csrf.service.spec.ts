import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import { CsrfService } from './csrf.service.js';

function createService(secret: string) {
  const config = { get: () => secret } as unknown as ConfigService<Env, true>;
  return new CsrfService(config);
}

describe('CsrfService', () => {
  const service = createService('a'.repeat(32));

  it('accepts a matching, correctly signed cookie/header pair', () => {
    const token = service.generate();

    expect(service.verify(token, token)).toBe(true);
  });

  it('rejects a missing header or cookie', () => {
    const token = service.generate();

    expect(service.verify(token, undefined)).toBe(false);
    expect(service.verify(undefined, token)).toBe(false);
  });

  it('rejects a header that does not match the cookie', () => {
    expect(service.verify(service.generate(), service.generate())).toBe(false);
  });

  it('rejects tokens signed with another secret (cookie injection)', () => {
    const forged = createService('b'.repeat(32)).generate();

    expect(service.verify(forged, forged)).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(service.verify('abc', 'abc')).toBe(false);
    expect(service.verify('a.b.c', 'a.b.c')).toBe(false);
  });
});
