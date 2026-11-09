import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../common/monitoring/audit.service.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AvatarService } from './avatar.service.js';
import type { ProfileDto } from './dto/profile.dto.js';
import type { UpdateProfileInput } from './profile.schemas.js';

const profileInclude = {
  profile: true,
  avatar: { select: { updatedAt: true } },
  accounts: {
    select: {
      provider: true,
      email: true,
      name: true,
      pictureUrl: true,
      createdAt: true,
      lastLoginAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.UserInclude;

type UserWithProfile = Prisma.UserGetPayload<{ include: typeof profileInclude }>;

function toProfileDto(user: UserWithProfile): ProfileDto {
  const profile = user.profile;
  const updatedAt = Math.max(user.updatedAt.getTime(), profile?.updatedAt.getTime() ?? 0);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    hasPassword: user.passwordHash !== null,
    phone: profile?.phone ?? null,
    companyName: profile?.companyName ?? null,
    jobRole: profile?.jobRole ?? null,
    industry: profile?.industry ?? null,
    yearsOfExperience: profile?.yearsOfExperience ?? null,
    avatarVersion: user.avatar ? user.avatar.updatedAt.getTime() : null,
    connectedAccounts: user.accounts.map((account) => ({
      provider: account.provider.toLowerCase(),
      email: account.email,
      name: account.name,
      pictureUrl: account.pictureUrl,
      connectedAt: account.createdAt.toISOString(),
      lastLoginAt: account.lastLoginAt.toISOString(),
    })),
    createdAt: user.createdAt.toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

/**
 * Profile reads and writes. Every method takes the *authenticated* user's ID; callers never
 * pass an ID from the request without an ownership check.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly avatars: AvatarService,
    private readonly audit: AuditService,
  ) {}

  async getProfile(userId: string): Promise<ProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: profileInclude,
    });
    if (!user) {
      throw new NotFoundException('Profile not found');
    }
    return toProfileDto(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<ProfileDto> {
    const { name, ...details } = input;
    // `undefined` fields are left unchanged by Prisma; `null` clears them.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(name === undefined ? {} : { name }),
        profile: { upsert: { create: details, update: details } },
      },
    });
    // Which fields changed, never their values (personal data).
    await this.audit.record({
      event: 'profile.updated',
      userId,
      details: { fields: Object.keys(input).sort() },
    });
    return this.getProfile(userId);
  }

  async setAvatar(userId: string, upload: Buffer | undefined): Promise<ProfileDto> {
    const { data, mimeType } = await this.avatars.process(upload);
    const record = { data: new Uint8Array(data), mimeType, sizeBytes: data.length };
    await this.prisma.userAvatar.upsert({
      where: { userId },
      create: { userId, ...record },
      update: record,
    });
    await this.audit.record({
      event: 'profile.avatar_changed',
      userId,
      details: { action: 'uploaded' },
    });
    return this.getProfile(userId);
  }

  async removeAvatar(userId: string): Promise<ProfileDto> {
    await this.prisma.userAvatar.deleteMany({ where: { userId } });
    await this.audit.record({
      event: 'profile.avatar_changed',
      userId,
      details: { action: 'removed' },
    });
    return this.getProfile(userId);
  }

  async getAvatar(userId: string): Promise<{ data: Buffer; mimeType: string }> {
    const avatar = await this.prisma.userAvatar.findUnique({ where: { userId } });
    if (!avatar) {
      throw new NotFoundException({ code: 'AVATAR_NOT_FOUND', message: 'No profile picture.' });
    }
    return { data: Buffer.from(avatar.data), mimeType: avatar.mimeType };
  }
}
