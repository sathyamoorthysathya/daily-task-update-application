import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { ApiZodBody } from '../../../common/validation/zod-openapi.js';
import type { AuthUser } from '../../auth/auth.types.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AVATAR_MAX_UPLOAD_BYTES } from './avatar.service.js';
import { IndustriesDto, ProfileDto } from './dto/profile.dto.js';
import { INDUSTRIES } from './industries.js';
import { type UpdateProfileInput, updateProfileSchema } from './profile.schemas.js';
import { ProfileService } from './profile.service.js';

/** Minimal shape of a multer in-memory upload. */
interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/**
 * The signed-in user's own profile. The user ID always comes from the access token, so
 * these routes cannot address another user's data.
 */
@ApiTags('Profile')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto, description: 'Not signed in' })
@Controller('profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get my profile' })
  @ApiOkResponse({ type: ProfileDto })
  get(@CurrentUser() user: AuthUser): Promise<ProfileDto> {
    return this.profiles.getProfile(user.id);
  }

  @Patch()
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Partial update: omitted fields are unchanged, `null` or "" clears optional fields. ' +
      'The email address cannot be changed here.',
  })
  @ApiZodBody(updateProfileSchema)
  @ApiOkResponse({ type: ProfileDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Validation failed' })
  update(
    @CurrentUser() user: AuthUser,
    @Body({ schema: updateProfileSchema }) body: UpdateProfileInput,
  ): Promise<ProfileDto> {
    return this.profiles.updateProfile(user.id, body);
  }

  @Get('industries')
  @ApiOperation({ summary: 'List the allowed industry values' })
  @ApiOkResponse({ type: IndustriesDto })
  industries(): IndustriesDto {
    return { industries: [...INDUSTRIES] };
  }

  @Get('avatar')
  @ApiOperation({ summary: 'Get my profile picture (WebP)' })
  @ApiProduces('image/webp')
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'No picture uploaded' })
  async getAvatar(@CurrentUser() user: AuthUser, @Res() res: Response): Promise<void> {
    const avatar = await this.profiles.getAvatar(user.id);
    res.set({
      'Content-Type': avatar.mimeType,
      'Content-Length': String(avatar.data.length),
      // URLs carry ?v=<version>, so a new upload gets a new URL.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.send(avatar.data);
  }

  @Put('avatar')
  @ApiSecurity('csrf')
  @UseInterceptors(
    FileInterceptor('avatar', {
      // One file part and nothing else: no extra fields that would be buffered in memory.
      limits: { fileSize: AVATAR_MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1, headerPairs: 20 },
    }),
  )
  @ApiOperation({
    summary: 'Upload my profile picture',
    description: 'JPEG, PNG or WebP up to 2 MB. Stored as a 256x256 WebP with metadata removed.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['avatar'],
      properties: { avatar: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: ProfileDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Not a supported image' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorResponseDto, description: 'Larger than 2 MB' })
  uploadAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<ProfileDto> {
    return this.profiles.setAvatar(user.id, file?.buffer);
  }

  @Delete('avatar')
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Remove my profile picture' })
  @ApiOkResponse({ type: ProfileDto })
  removeAvatar(@CurrentUser() user: AuthUser): Promise<ProfileDto> {
    return this.profiles.removeAvatar(user.id);
  }
}
