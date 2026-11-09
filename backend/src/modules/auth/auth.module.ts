import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import type { Env } from '../../config/env.schema.js';
import { MailModule } from '../mail/mail.module.js';
import { UsersModule } from '../users/users.module.js';
import { JWT_AUDIENCE, JWT_ISSUER } from './auth.constants.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthCookieService } from './cookies/auth-cookie.service.js';
import { CsrfService } from './csrf/csrf.service.js';
import { GOOGLE_OAUTH_CLIENT, GoogleIdTokenVerifier } from './google/google-id-token.verifier.js';
import { PasswordResetService } from './password-reset/password-reset.service.js';
import { PasswordService } from './password/password.service.js';
import { TokenService } from './tokens/token.service.js';

@Module({
  imports: [
    MailModule,
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          expiresIn: config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
        },
        verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordResetService,
    PasswordService,
    TokenService,
    CsrfService,
    AuthCookieService,
    GoogleIdTokenVerifier,
    // Google's official client; caches Google's public signing certificates.
    { provide: GOOGLE_OAUTH_CLIENT, useFactory: () => new OAuth2Client() },
  ],
  exports: [TokenService, CsrfService],
})
export class AuthModule {}
