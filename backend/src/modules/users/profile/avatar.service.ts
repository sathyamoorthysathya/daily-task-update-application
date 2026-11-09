import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';

/** Largest upload accepted (before processing). */
export const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE_PX = 256;
export const AVATAR_MIME_TYPE = 'image/webp';

export interface ProcessedAvatar {
  data: Buffer;
  mimeType: typeof AVATAR_MIME_TYPE;
}

type ImageKind = 'jpeg' | 'png' | 'webp';

/** Identifies the format from the file signature; the client-supplied MIME type is not trusted. */
export function detectImageKind(buffer: Buffer): ImageKind | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Validates and normalises profile pictures: only JPEG/PNG/WebP, decoded and re-encoded as a
 * 256x256 WebP. Re-encoding strips metadata (EXIF, GPS location) and any non-image payload.
 */
@Injectable()
export class AvatarService {
  async process(buffer: Buffer | undefined): Promise<ProcessedAvatar> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException({
        code: 'AVATAR_REQUIRED',
        message: 'Choose an image to upload.',
      });
    }
    if (buffer.length > AVATAR_MAX_UPLOAD_BYTES) {
      throw new BadRequestException({
        code: 'AVATAR_TOO_LARGE',
        message: 'The image must be 2 MB or smaller.',
      });
    }
    if (!detectImageKind(buffer)) {
      throw new BadRequestException({
        code: 'AVATAR_INVALID_TYPE',
        message: 'Upload a JPEG, PNG or WebP image.',
      });
    }

    try {
      const data = await sharp(buffer, { limitInputPixels: 25_000_000, failOn: 'error' })
        .rotate() // honour EXIF orientation before it is stripped
        .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: 'cover', position: 'attention' })
        .webp({ quality: 85 })
        .toBuffer();
      return { data, mimeType: AVATAR_MIME_TYPE };
    } catch {
      throw new BadRequestException({
        code: 'AVATAR_INVALID_IMAGE',
        message: 'The image could not be processed. Try a different file.',
      });
    }
  }
}
