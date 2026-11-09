import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { OwnerOnly } from '../../common/authorization/ownership.js';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import { ApiZodBody } from '../../common/validation/zod-openapi.js';
import { ProfileDto } from './profile/dto/profile.dto.js';
import { type UpdateProfileInput, updateProfileSchema } from './profile/profile.schemas.js';
import { ProfileService } from './profile/profile.service.js';
import { userIdParamSchema } from './users.schemas.js';

/** ID-addressed access to profiles. Owner only: another user's ID returns 403. */
@ApiTags('Users')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto, description: 'Not signed in' })
@ApiForbiddenResponse({ type: ApiErrorResponseDto, description: 'Not the owner of this user' })
@Controller('users')
export class UsersController {
  constructor(private readonly profiles: ProfileService) {}

  @Get(':id')
  @OwnerOnly('id')
  @ApiOperation({ summary: 'Get a user profile (owner only)' })
  @ApiOkResponse({ type: ProfileDto })
  get(@Param('id', { schema: userIdParamSchema }) id: string): Promise<ProfileDto> {
    return this.profiles.getProfile(id);
  }

  @Patch(':id')
  @OwnerOnly('id')
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Update a user profile (owner only)' })
  @ApiZodBody(updateProfileSchema)
  @ApiOkResponse({ type: ProfileDto })
  update(
    @Param('id', { schema: userIdParamSchema }) id: string,
    @Body({ schema: updateProfileSchema }) body: UpdateProfileInput,
  ): Promise<ProfileDto> {
    return this.profiles.updateProfile(id, body);
  }
}
