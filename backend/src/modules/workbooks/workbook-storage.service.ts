import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Env } from '../../config/env.schema.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STORAGE_KEY_PATTERN = new RegExp(`^${UUID}/${UUID}\\.xlsx$`);

export interface StoredFile {
  sizeBytes: number;
  sha256: string;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Storage key of a workbook file: derived only from UUIDs, never from user input. */
export function workbookStorageKey(userId: string, workbookId: string): string {
  return `${userId}/${workbookId}.xlsx`;
}

/**
 * Persistent local file storage for workbooks (WORKBOOK_STORAGE_DIR).
 * - Paths come only from validated "<userId>/<workbookId>.xlsx" keys and are checked to stay
 *   inside the storage root, so they cannot be used for path traversal.
 * - Writes are atomic: data goes to a temporary file, is flushed to disk, then renamed over the
 *   target, so readers never see a partially written workbook.
 */
@Injectable()
export class WorkbookStorageService implements OnModuleInit {
  private readonly logger = new Logger(WorkbookStorageService.name);
  readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = path.resolve(config.get('WORKBOOK_STORAGE_DIR', { infer: true }));
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.logger.log(`Workbook storage: ${this.root}`);
  }

  async write(key: string, data: Buffer): Promise<StoredFile> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.renameWithRetry(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return { sizeBytes: data.length, sha256: sha256Hex(data) };
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Throws if the storage directory is not writable (used by the readiness check). */
  async assertWritable(): Promise<void> {
    await access(this.root, constants.R_OK | constants.W_OK);
  }

  private resolve(key: string): string {
    if (!STORAGE_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid workbook storage key: ${key}`);
    }
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(this.root + path.sep)) {
      throw new Error('Workbook path escapes the storage root');
    }
    return resolved;
  }

  /** On Windows, a rename can briefly fail while another process (e.g. antivirus) holds the file. */
  private async renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(from, to);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
      }
    }
  }
}
