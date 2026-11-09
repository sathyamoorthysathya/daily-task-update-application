import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { UserProfileDto } from './dto/user-profile.dto.js';

export const userWithAccounts = {
  accounts: { select: { provider: true, pictureUrl: true }, orderBy: { createdAt: 'asc' } },
  avatar: { select: { updatedAt: true } },
} satisfies Prisma.UserInclude;

export type UserWithAccounts = Prisma.UserGetPayload<{ include: typeof userWithAccounts }>;

/** Session user summary returned by the auth endpoints (see ProfileDto for the full profile). */
export function toUserProfile(user: UserWithAccounts): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    hasPassword: user.passwordHash !== null,
    providers: user.accounts.map((account) => account.provider.toLowerCase()),
    avatarVersion: user.avatar ? user.avatar.updatedAt.getTime() : null,
    providerPictureUrl: user.accounts.find((account) => account.pictureUrl)?.pictureUrl ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccountSummary(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userWithAccounts,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toUserProfile(user);
  }
}
