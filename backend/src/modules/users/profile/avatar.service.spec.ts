import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { AVATAR_MAX_UPLOAD_BYTES, AvatarService, detectImageKind } from './avatar.service.js';

function image(format: 'png' | 'jpeg' | 'webp' | 'gif', width = 640, height = 480) {
  return sharp({ create: { width, height, channels: 3, background: '#3355dd' } })
    .toFormat(format)
    .toBuffer();
}

describe('AvatarService', () => {
  const service = new AvatarService();

  it.each(['png', 'jpeg', 'webp'] as const)(
    'accepts %s and stores a 256x256 WebP',
    async (format) => {
      const result = await service.process(await image(format));

      const meta = await sharp(result.data).metadata();
      expect(result.mimeType).toBe('image/webp');
      expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 });
    },
  );

  it('strips metadata such as EXIF (e.g. GPS location)', async () => {
    const withExif = await sharp(await image('jpeg'))
      .withExif({ IFD0: { Copyright: 'secret', ImageDescription: 'home address' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const result = await service.process(withExif);

    expect((await sharp(result.data).metadata()).exif).toBeUndefined();
  });

  it('rejects formats outside the allow-list by signature, whatever the file name says', async () => {
    await expect(service.process(await image('gif'))).rejects.toMatchObject({
      response: { code: 'AVATAR_INVALID_TYPE' },
    });
    await expect(
      service.process(Buffer.from('<svg onload="alert(1)"></svg>')),
    ).rejects.toMatchObject({
      response: { code: 'AVATAR_INVALID_TYPE' },
    });
  });

  it('rejects files that only pretend to be images', async () => {
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not really a png'),
    ]);

    await expect(service.process(fake)).rejects.toMatchObject({
      response: { code: 'AVATAR_INVALID_IMAGE' },
    });
  });

  it('rejects empty and oversized uploads', async () => {
    await expect(service.process(undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.process(Buffer.alloc(AVATAR_MAX_UPLOAD_BYTES + 1, 1)),
    ).rejects.toMatchObject({
      response: { code: 'AVATAR_TOO_LARGE' },
    });
  });

  it('detects image signatures', async () => {
    expect(detectImageKind(await image('png'))).toBe('png');
    expect(detectImageKind(await image('jpeg'))).toBe('jpeg');
    expect(detectImageKind(await image('webp'))).toBe('webp');
    expect(detectImageKind(Buffer.from('GIF89a'))).toBeNull();
  });
});
