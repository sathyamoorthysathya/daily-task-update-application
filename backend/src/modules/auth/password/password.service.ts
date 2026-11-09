import { Injectable } from '@nestjs/common';
import { type Algorithm, hash, type Options, verify } from '@node-rs/argon2';

/** `Algorithm` is a `const enum` (not available at runtime with isolatedModules); 2 = Argon2id. */
const ARGON2ID = 2 as Algorithm;

/** OWASP Password Storage Cheat Sheet: Argon2id, m=19 MiB, t=2, p=1. */
const ARGON2_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  /** Hash of a random value, verified when a user does not exist to keep response times uniform. */
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Spends the same time as a real verification, then fails. Mitigates user enumeration by timing. */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash(`dummy-${Date.now()}`);
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
