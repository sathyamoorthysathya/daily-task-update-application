import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import { ApiZodBody } from '../../common/validation/zod-openapi.js';
import { UserProfileDto } from '../users/dto/user-profile.dto.js';
import { UsersService } from '../users/users.service.js';
import {
  ACCESS_TOKEN_COOKIE,
  AuthErrorCode,
  CSRF_COOKIE,
  GOOGLE_NONCE_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './auth.constants.js';
import {
  type ChangePasswordInput,
  changePasswordSchema,
  type ForgotPasswordInput,
  forgotPasswordSchema,
  type GoogleLoginInput,
  googleLoginSchema,
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
  type ResetPasswordInput,
  resetPasswordSchema,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import type { AuthUser, ClientInfo } from './auth.types.js';
import { AuthCookieService } from './cookies/auth-cookie.service.js';
import { generateOpaqueToken } from './crypto/token-crypto.js';
import { CsrfService } from './csrf/csrf.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { AuthRateLimit, LoginRateLimit } from './decorators/rate-limit.decorator.js';
import {
  AuthProvidersDto,
  AuthResponseDto,
  CsrfTokenDto,
  GoogleNonceDto,
  MessageDto,
} from './dto/auth-response.dto.js';
import { GoogleIdTokenVerifier } from './google/google-id-token.verifier.js';
import { PasswordResetService } from './password-reset/password-reset.service.js';
import { TokenService } from './tokens/token.service.js';

function cookiesOf(req: Request): Record<string, string | undefined> {
  return (req.cookies ?? {}) as Record<string, string | undefined>;
}

function clientInfo(req: Request): ClientInfo {
  return { userAgent: req.get('user-agent'), ipAddress: req.ip };
}

@ApiTags('Auth')
@ApiSecurity('csrf')
@ApiForbiddenResponse({ type: ApiErrorResponseDto, description: 'Missing/invalid CSRF token' })
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto, description: 'Rate limit exceeded' })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly users: UsersService,
    private readonly cookies: AuthCookieService,
    private readonly csrf: CsrfService,
    private readonly google: GoogleIdTokenVerifier,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Get('csrf')
  @ApiOperation({
    summary: 'Get a CSRF token',
    description:
      'Sets the csrf_token cookie. Echo the value in X-CSRF-Token on POST/PUT/PATCH/DELETE.',
  })
  @ApiOkResponse({ type: CsrfTokenDto })
  getCsrfToken(@Req() req: Request, @Res({ passthrough: true }) res: Response): CsrfTokenDto {
    const existing = cookiesOf(req)[CSRF_COOKIE];
    const csrfToken = this.csrf.isWellFormed(existing) ? existing : this.csrf.generate();
    this.cookies.setCsrfCookie(res, csrfToken);
    return { csrfToken };
  }

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'List enabled sign-in providers' })
  @ApiOkResponse({ type: AuthProvidersDto })
  getProviders(): AuthProvidersDto {
    return {
      google: { enabled: this.google.enabled, clientId: this.google.publicClientId },
    };
  }

  @Public()
  @AuthRateLimit()
  @Post('register')
  @ApiOperation({ summary: 'Create an account with email and password (signs the user in)' })
  @ApiZodBody(registerSchema)
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Email already registered' })
  async register(
    @Body({ schema: registerSchema }) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const { user, tokens } = await this.auth.register(body, clientInfo(req));
    this.cookies.setSessionCookies(res, tokens);
    return { user };
  }

  @Public()
  @AuthRateLimit()
  @LoginRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiZodBody(loginSchema)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto, description: 'Invalid email or password' })
  async login(
    @Body({ schema: loginSchema }) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const { user, tokens } = await this.auth.login(body, clientInfo(req));
    this.cookies.setSessionCookies(res, tokens);
    return { user };
  }

  @Public()
  @AuthRateLimit()
  @Get('google/nonce')
  @ApiOperation({
    summary: 'Start Google sign-in',
    description:
      'Returns a single-use nonce (also stored in an HttpOnly cookie) for Google Identity Services.',
  })
  @ApiOkResponse({ type: GoogleNonceDto })
  getGoogleNonce(@Res({ passthrough: true }) res: Response): GoogleNonceDto {
    const nonce = generateOpaqueToken();
    this.cookies.setGoogleNonceCookie(res, nonce);
    return { nonce };
  }

  @Public()
  @AuthRateLimit()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with Google',
    description:
      'Exchanges a Google ID token (credential from Google Identity Services) for a session.',
  })
  @ApiZodBody(googleLoginSchema)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto, description: 'Invalid Google token' })
  async loginWithGoogle(
    @Body({ schema: googleLoginSchema }) body: GoogleLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const nonce = cookiesOf(req)[GOOGLE_NONCE_COOKIE];
    this.cookies.clearGoogleNonceCookie(res); // single use, whatever the outcome
    const identity = await this.google.verify(body.credential, nonce);
    const { user, tokens } = await this.auth.loginWithGoogle(identity, clientInfo(req));
    this.cookies.setSessionCookies(res, tokens);
    return { user };
  }

  @Public()
  // Not in the per-IP auth bucket: many users behind one NAT refresh every 15 minutes, and
  // refresh tokens are 256-bit random values (the default per-IP limit still applies).
  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Rotate the session tokens',
    description: 'Uses the refresh_token cookie; issues new access and refresh tokens.',
  })
  @ApiNoContentResponse({ description: 'New cookies set' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto, description: 'Session expired/revoked' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refreshToken = cookiesOf(req)[REFRESH_TOKEN_COOKIE];
    try {
      if (!refreshToken) {
        throw new UnauthorizedException({
          code: AuthErrorCode.RefreshTokenMissing,
          message: 'Your session has expired. Please sign in again.',
        });
      }
      const tokens = await this.auth.refresh(refreshToken, clientInfo(req));
      this.cookies.setSessionCookies(res, tokens);
    } catch (error) {
      this.cookies.clearSessionCookies(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out of this device', description: 'Revokes the current session.' })
  @ApiNoContentResponse()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookies = cookiesOf(req);
    const session = await this.sessionFrom(cookies[ACCESS_TOKEN_COOKIE]);
    await this.auth.logout(cookies[REFRESH_TOKEN_COOKIE], session);
    this.cookies.clearSessionCookies(res);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Sign out of all devices', description: 'Revokes every session.' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user.id);
    this.cookies.clearSessionCookies(res);
  }

  @Get('me')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Get the signed-in user' })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  me(@CurrentUser() user: AuthUser): Promise<UserProfileDto> {
    return this.users.getAccountSummary(user.id);
  }

  @AuthRateLimit()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Change my password',
    description:
      'Requires the current password. Signs out all other sessions; this session stays signed in.',
  })
  @ApiZodBody(changePasswordSchema)
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    type: ApiErrorResponseDto,
    description: 'Validation failed, wrong current password, or the account has no password',
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body({ schema: changePasswordSchema }) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(user, body);
  }

  @Public()
  @AuthRateLimit()
  @LoginRateLimit()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a password reset email',
    description: 'Always returns 202, whether or not the email is registered.',
  })
  @ApiZodBody(forgotPasswordSchema)
  @ApiAcceptedResponse({ type: MessageDto })
  async forgotPassword(
    @Body({ schema: forgotPasswordSchema }) body: ForgotPasswordInput,
  ): Promise<MessageDto> {
    await this.passwordReset.request(body.email);
    return {
      message: 'If an account exists for that email, we have sent a link to reset the password.',
    };
  }

  @Public()
  @AuthRateLimit()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password with a reset token',
    description: 'Signs the user out everywhere; they must sign in with the new password.',
  })
  @ApiZodBody(resetPasswordSchema)
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Invalid/expired token' })
  async resetPassword(
    @Body({ schema: resetPasswordSchema }) body: ResetPasswordInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.passwordReset.reset(body.token, body.password);
    this.cookies.clearSessionCookies(res);
  }

  private async sessionFrom(
    accessToken: string | undefined,
  ): Promise<{ sid: string; sub: string } | undefined> {
    if (!accessToken) {
      return undefined;
    }
    try {
      return await this.tokens.verifyAccessToken(accessToken);
    } catch {
      return undefined;
    }
  }
}
