import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import { ApiZodBody } from '../../common/validation/zod-openapi.js';
import { ACCESS_TOKEN_COOKIE } from '../auth/auth.constants.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { TokenService } from '../auth/tokens/token.service.js';
import { AnalyticsService } from './analytics.service.js';
import { PAGE_PATH_MAX_LENGTH } from './page-path.js';

export const pageViewSchema = z.object({
  /** Path of the page opened in the web app, e.g. "/tasks/0190...". IDs are removed. */
  path: z
    .string()
    .trim()
    .min(1)
    .max(PAGE_PATH_MAX_LENGTH * 2),
  /** Random ID the browser keeps for this site (counts unique visitors). */
  visitorId: z.uuid('Invalid visitor ID'),
});

@ApiTags('Analytics')
@ApiSecurity('csrf')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly tokens: TokenService,
  ) {}

  /** Public: signed-out pages (sign-in, registration) count too; a signed-in user is attached. */
  @Public()
  @Post('page-views')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Record a page visit',
    description:
      'Sent by the web app when a page is opened. Stores the route (IDs replaced), the signed-in user if any, and the device/browser family. No IP address or query string is stored.',
  })
  @ApiZodBody(pageViewSchema)
  @ApiNoContentResponse()
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto, description: 'Validation failed' })
  async recordPageView(
    @Body({ schema: pageViewSchema }) body: z.infer<typeof pageViewSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.analytics.recordPageView({
      path: body.path,
      visitorId: body.visitorId,
      userAgent: req.get('user-agent'),
      userId: await this.signedInUser(req),
    });
  }

  private async signedInUser(req: Request): Promise<string | undefined> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[ACCESS_TOKEN_COOKIE];
    if (!token) {
      return undefined;
    }
    try {
      return (await this.tokens.verifyAccessToken(token)).sub;
    } catch {
      return undefined;
    }
  }
}
