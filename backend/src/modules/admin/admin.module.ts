import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminInsightsController,
  AdminSecurityController,
  AdminUsersController,
} from './admin.controllers.js';
import { AdminAuthController } from './auth/admin-auth.controller.js';
import { AdminAuthService } from './auth/admin-auth.service.js';
import { AdminIpGuard, AdminSessionGuard } from './auth/admin.guards.js';
import { AdminInsightsService } from './insights/admin-insights.service.js';
import { AdminSecurityService } from './security/admin-security.service.js';
import { AdminUsersService } from './users/admin-users.service.js';

/**
 * Admin panel API (/admin/*): administrators are separate accounts with their own sign-in
 * (unique username, password, optional TOTP), session cookie, lockout and IP allow-list.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    AdminAuthController,
    AdminInsightsController,
    AdminUsersController,
    AdminSecurityController,
  ],
  providers: [
    AdminAuthService,
    AdminInsightsService,
    AdminUsersService,
    AdminSecurityService,
    AdminIpGuard,
    AdminSessionGuard,
  ],
  exports: [AdminAuthService],
})
export class AdminModule {}
