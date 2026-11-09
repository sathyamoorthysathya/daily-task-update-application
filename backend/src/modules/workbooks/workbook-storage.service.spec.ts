import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Env } from '../../config/env.schema.js';
import {
  sha256Hex,
  WorkbookStorageService,
  workbookStorageKey,
} from './workbook-storage.service.js';

describe('WorkbookStorageService', () => {
  let root: string;
  let storage: WorkbookStorageService;
  const userId = randomUUID();

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dtu-storage-'));
    storage = new WorkbookStorageService({ get: () => root } as unknown as ConfigService<
      Env,
      true
    >);
    await storage.onModuleInit();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes atomically, reads back and reports size and checksum', async () => {
    const key = workbookStorageKey(userId, randomUUID());
    const data = Buffer.from('xlsx bytes');

    const stored = await storage.write(key, data);

    expect(stored).toEqual({ sizeBytes: data.length, sha256: sha256Hex(data) });
    expect(await storage.read(key)).toEqual(data);
    // No temporary files are left behind.
    expect(await readdir(path.join(root, userId))).toEqual([path.basename(key)]);
  });

  it('replaces an existing file', async () => {
    const key = workbookStorageKey(userId, randomUUID());
    await storage.write(key, Buffer.from('first'));
    await storage.write(key, Buffer.from('second'));

    expect((await storage.read(key)).toString()).toBe('second');
  });

  it('removes files and tolerates missing ones', async () => {
    const key = workbookStorageKey(userId, randomUUID());
    await storage.write(key, Buffer.from('x'));

    await storage.remove(key);
    await storage.remove(key);

    expect(await storage.exists(key)).toBe(false);
  });

  it.each([
    '../../etc/passwd',
    `${userId}/../../escape.xlsx`,
    `${userId}/report.xlsx`,
    `${userId}/${randomUUID()}.exe`,
    'C:/Windows/system.ini',
    `/${userId}/${randomUUID()}.xlsx`,
  ])('refuses the unsafe storage key %s', async (key) => {
    await expect(storage.write(key, Buffer.from('x'))).rejects.toThrow(
      /Invalid workbook storage key/,
    );
    await expect(storage.read(key)).rejects.toThrow(/Invalid workbook storage key/);
  });

  it('reports whether the storage root is writable', async () => {
    await expect(storage.assertWritable()).resolves.toBeUndefined();
  });
});
