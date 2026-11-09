import { Module } from '@nestjs/common';
import { AvatarService } from './profile/avatar.service.js';
import { ProfileController } from './profile/profile.controller.js';
import { ProfileService } from './profile/profile.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController, ProfileController],
  providers: [UsersService, ProfileService, AvatarService],
  exports: [UsersService],
})
export class UsersModule {}
